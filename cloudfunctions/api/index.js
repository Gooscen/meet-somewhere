const cloud = require('wx-server-sdk');
const { validPoint, signature, summarize } = require('./routes');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const MAX_MEMBERS = 20;
const MAX_CANDIDATES = 20;

function cleanText(value, max = 120) { return String(value || '').trim().slice(0, max); }
function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000) throw new Error('金额格式有误');
  return number;
}
function dateTime(value, required = false) {
  if (!value) { if (required) throw new Error('请填写日期和时间'); return null; }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('日期格式有误');
  return date.toISOString();
}
function location(value) {
  if (!value) return null;
  if (!validPoint(value)) throw new Error('请选择地图位置');
  return { name: cleanText(value.name, 80), address: cleanText(value.address, 160), latitude: Number(value.latitude), longitude: Number(value.longitude) };
}
function visibility(value) { return ['route_only', 'organizer', 'members'].includes(value) ? value : 'route_only'; }
function mode(value) { return ['transit', 'driving', 'walking', 'fastest'].includes(value) ? value : 'transit'; }
function pick(value, choices, fallback) { return choices.includes(value) ? value : fallback; }
function id(value) { if (typeof value !== 'string' || !/^[\w-]{1,64}$/.test(value)) throw new Error('无效的聚会或地点'); return value; }
function requireText(value, label, max) { const result = cleanText(value, max); if (!result) throw new Error(`请填写${label}`); return result; }
async function getDoc(collection, docId) {
  try { return (await db.collection(collection).doc(docId).get()).data; } catch (_) { return null; }
}
async function list(collection, meetingId) {
  const all = [];
  while (true) {
    const page = (await db.collection(collection).where({ meetingId }).skip(all.length).limit(100).get()).data;
    all.push(...page);
    if (page.length < 100) return all;
  }
}
async function purgeMeeting(meeting) {
  const [profiles, summaries] = await Promise.all([list('profiles', meeting._id), list('routeSummaries', meeting._id)]);
  await Promise.all(profiles.map(p => db.collection('profiles').doc(p._id).update({ data: {
    departure: null, returnTo: null, hardRestriction: '', preference: '', availableTimeNote: '',
    budgetMin: null, budgetMax: null, hardBudgetMax: null,
    earliestArrival: null, mustLeaveAt: null, maxReturnBy: null, updatedAt: new Date().toISOString()
  } })));
  await Promise.all(summaries.map(s => db.collection('routeSummaries').doc(s._id).remove()));
  await db.collection('meetings').doc(meeting._id).update({ data: { status: 'closed', updatedAt: new Date().toISOString() } });
  meeting.status = 'closed';
}
async function contextFor(meetingId, ownerId, requireJoined = true) {
  const meeting = await getDoc('meetings', id(meetingId));
  if (!meeting) throw new Error('聚会不存在');
  if (meeting.status !== 'closed' && new Date(meeting.endsAt).getTime() <= Date.now()) await purgeMeeting(meeting);
  const ownProfile = await getDoc('profiles', `${meetingId}_${ownerId}`);
  if (requireJoined && !ownProfile) throw new Error('请先加入聚会');
  return { meeting, ownProfile, isOrganizer: meeting.organizerId === ownerId };
}
function assertOpen(meeting) { if (meeting.status === 'closed') throw new Error('聚会已结束'); }
function assertOrganizer(context) { if (!context.isOrganizer) throw new Error('仅组织者可操作'); }
function requireMember(context) { if (!context.ownProfile) throw new Error('请先加入聚会'); }

async function listMeetings(ownerId) {
  const profiles = (await db.collection('profiles').where({ ownerId }).limit(100).get()).data;
  const meetings = await Promise.all(profiles.map(profile => getDoc('meetings', profile.meetingId)));
  for (const meeting of meetings.filter(Boolean)) {
    if (meeting.status !== 'closed' && new Date(meeting.endsAt).getTime() <= Date.now()) await purgeMeeting(meeting);
  }
  return meetings.filter(Boolean).map(meeting => ({
    _id: meeting._id, title: meeting.title, startsAt: meeting.startsAt, endsAt: meeting.endsAt,
    status: meeting.status, selectedCandidateId: meeting.selectedCandidateId,
    isOrganizer: meeting.organizerId === ownerId
  })).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

async function createMeeting(input, ownerId) {
  const startsAt = dateTime(input.startsAt, true);
  const endsAt = dateTime(input.endsAt, true);
  const responseDeadline = dateTime(input.responseDeadline);
  if (endsAt <= startsAt) throw new Error('散场时间应晚于开始时间');
  if (endsAt <= new Date().toISOString()) throw new Error('散场时间应晚于当前时间');
  if (responseDeadline && responseDeadline > startsAt) throw new Error('回应截止时间应早于聚会开始');
  const budgetMin = optionalNumber(input.budgetMin);
  const budgetMax = optionalNumber(input.budgetMax);
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) throw new Error('预算范围有误');
  const now = new Date().toISOString();
  const meeting = {
    title: requireText(input.title, '聚会名称', 60), startsAt, endsAt, responseDeadline,
    alternativeTime: cleanText(input.alternativeTime, 100), budgetMin, budgetMax,
    organizerId: ownerId, status: 'collecting', selectedCandidateId: null, decisionNote: '',
    createdAt: now, updatedAt: now
  };
  const result = await db.collection('meetings').add({ data: meeting });
  await db.collection('profiles').doc(`${result._id}_${ownerId}`).set({ data: {
    meetingId: result._id, ownerId, displayName: '组织者', available: 'unknown', alternativeAvailability: 'unknown', availableTimeNote: '',
    departure: null, returnTo: null, departureVisibility: 'route_only', returnVisibility: 'route_only',
    outboundMode: 'transit', returnMode: 'transit', budgetMin: null, budgetMax: null, hardBudgetMax: null,
    earliestArrival: null, mustLeaveAt: null, maxReturnBy: null, hardRestriction: '', preference: '',
    finalAttendance: 'unanswered', updatedAt: now
  } });
  return { meetingId: result._id };
}

async function joinMeeting(meetingId, ownerId, displayName) {
  const context = await contextFor(meetingId, ownerId, false);
  assertOpen(context.meeting);
  if (context.ownProfile) return { meetingId };
  const profiles = await list('profiles', meetingId);
  if (profiles.length >= MAX_MEMBERS) throw new Error('本次聚会最多支持 20 人');
  const now = new Date().toISOString();
  await db.collection('profiles').doc(`${meetingId}_${ownerId}`).set({ data: {
    meetingId, ownerId, displayName: requireText(displayName, '称呼', 24), available: 'unknown', alternativeAvailability: 'unknown', availableTimeNote: '',
    departure: null, returnTo: null, departureVisibility: 'route_only', returnVisibility: 'route_only',
    outboundMode: 'transit', returnMode: 'transit', budgetMin: null, budgetMax: null, hardBudgetMax: null,
    earliestArrival: null, mustLeaveAt: null, maxReturnBy: null, hardRestriction: '', preference: '',
    finalAttendance: 'unanswered', updatedAt: now
  } });
  return { meetingId };
}

async function saveProfile(meetingId, ownerId, input) {
  const context = await contextFor(meetingId, ownerId);
  assertOpen(context.meeting);
  const budgetMin = optionalNumber(input.budgetMin);
  const budgetMax = optionalNumber(input.budgetMax);
  const hardBudgetMax = optionalNumber(input.hardBudgetMax);
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) throw new Error('预算范围有误');
  const data = {
    displayName: requireText(input.displayName, '称呼', 24),
    available: pick(input.available, ['yes', 'no', 'unknown'], 'unknown'),
    alternativeAvailability: pick(input.alternativeAvailability, ['yes', 'no', 'unknown'], 'unknown'),
    availableTimeNote: cleanText(input.availableTimeNote, 100),
    earliestArrival: dateTime(input.earliestArrival), mustLeaveAt: dateTime(input.mustLeaveAt),
    maxReturnBy: dateTime(input.maxReturnBy),
    departure: location(input.departure), returnTo: location(input.returnTo),
    departureVisibility: visibility(input.departureVisibility), returnVisibility: visibility(input.returnVisibility),
    outboundMode: mode(input.outboundMode), returnMode: mode(input.returnMode),
    budgetMin, budgetMax, hardBudgetMax,
    hardRestriction: cleanText(input.hardRestriction, 240), preference: cleanText(input.preference, 240),
    updatedAt: new Date().toISOString()
  };
  // Replace the profile so changing a location between null and an object is atomic.
  const { _id, ...previous } = context.ownProfile;
  await db.collection('profiles').doc(_id).set({ data: { ...previous, ...data } });
  return { saved: true };
}

async function addCandidate(meetingId, ownerId, input) {
  const context = await contextFor(meetingId, ownerId);
  assertOpen(context.meeting);
  if (context.meeting.selectedCandidateId) throw new Error('地点已确定');
  const candidates = await list('candidates', meetingId);
  if (candidates.length >= MAX_CANDIDATES) throw new Error('本次聚会最多支持 20 个候选地点');
  const place = location(input.location);
  if (!place) throw new Error('请在地图上选择地点');
  const priceMin = optionalNumber(input.priceMin);
  const priceMax = optionalNumber(input.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) throw new Error('人均价格范围有误');
  const now = new Date().toISOString();
  const result = await db.collection('candidates').add({ data: {
    meetingId, creatorId: ownerId, name: requireText(input.name, '地点名称', 80),
    location: place, priceMin, priceMax, cuisine: cleanText(input.cuisine, 60),
    note: cleanText(input.note, 240), sourceUrl: cleanText(input.sourceUrl, 240),
    infoStatus: pick(input.infoStatus, ['verified', 'pending', 'missing'], 'pending'),
    active: true, createdAt: now, updatedAt: now
  } });
  return { candidateId: result._id };
}

async function setCandidateActive(meetingId, ownerId, candidateId, active) {
  const context = await contextFor(meetingId, ownerId);
  assertOrganizer(context); assertOpen(context.meeting);
  if (context.meeting.selectedCandidateId) throw new Error('地点已确定');
  const candidate = await getDoc('candidates', id(candidateId));
  if (!candidate || candidate.meetingId !== meetingId) throw new Error('候选地点不存在');
  await db.collection('candidates').doc(candidateId).update({ data: { active: Boolean(active), updatedAt: new Date().toISOString() } });
  return { saved: true };
}

async function rateCandidate(meetingId, ownerId, candidateId, input) {
  const context = await contextFor(meetingId, ownerId);
  assertOpen(context.meeting);
  if (context.meeting.selectedCandidateId) throw new Error('地点已确定');
  const candidate = await getDoc('candidates', id(candidateId));
  if (!candidate || candidate.meetingId !== meetingId || !candidate.active) throw new Error('候选地点不存在');
  const rating = pick(input.rating, ['love', 'like', 'okay', 'dislike', 'cannot', 'unseen'], null);
  if (!rating) throw new Error('请选择评价');
  const reason = ['dislike', 'cannot'].includes(rating) ? pick(input.reason, ['budget', 'distance', 'time', 'taste', 'other', ''], '') : '';
  await db.collection('ratings').doc(`${candidateId}_${ownerId}`).set({ data: {
    meetingId, candidateId, ownerId, rating, reason, updatedAt: new Date().toISOString()
  } });
  return { saved: true };
}

async function getMeeting(meetingId, ownerId) {
  const context = await contextFor(meetingId, ownerId, false);
  if (!context.ownProfile) return { invite: { _id: meetingId, title: context.meeting.title, startsAt: context.meeting.startsAt, status: context.meeting.status } };
  const [profiles, candidates, ratings, routeSummaries] = await Promise.all([
    list('profiles', meetingId), list('candidates', meetingId), list('ratings', meetingId), list('routeSummaries', meetingId)
  ]);
  const counts = { members: profiles.length, completed: profiles.filter(p => p.available !== 'unknown').length,
    unanswered: profiles.filter(p => p.available === 'unknown').length };
  const publicCandidates = candidates.map(candidate => {
    const candidateRatings = ratings.filter(r => r.candidateId === candidate._id);
    const distribution = { love: 0, like: 0, okay: 0, dislike: 0, cannot: 0, unseen: 0, unrated: profiles.length - candidateRatings.length };
    candidateRatings.forEach(r => { distribution[r.rating]++; });
    const stored = routeSummaries.find(s => s.candidateId === candidate._id);
    const valid = stored && stored.signature === signature(context.meeting, candidate, profiles);
    return {
      _id: candidate._id, name: candidate.name, location: candidate.location,
      priceMin: candidate.priceMin, priceMax: candidate.priceMax, cuisine: candidate.cuisine,
      note: candidate.note, sourceUrl: candidate.sourceUrl, infoStatus: candidate.infoStatus,
      active: candidate.active, distribution,
      myRating: (candidateRatings.find(r => r.ownerId === ownerId) || {}).rating || null,
      myReason: (candidateRatings.find(r => r.ownerId === ownerId) || {}).reason || '',
      routeSummary: valid ? stored.summary : null, routeStale: !valid
    };
  });
  const members = profiles.map(p => ({
    displayName: p.displayName, informationComplete: p.available !== 'unknown', finalAttendance: p.finalAttendance,
    alternativeAvailability: p.alternativeAvailability || 'unknown',
    availableTimeNote: context.isOrganizer || p.ownerId === ownerId ? p.availableTimeNote || '' : '',
    departureName: p.departure && (p.ownerId === ownerId || p.departureVisibility === 'members' ||
      (context.isOrganizer && p.departureVisibility === 'organizer')) ? p.departure.name : '',
    returnName: p.returnTo && (p.ownerId === ownerId || p.returnVisibility === 'members' ||
      (context.isOrganizer && p.returnVisibility === 'organizer')) ? p.returnTo.name : ''
  }));
  return {
    meeting: { _id: context.meeting._id, title: context.meeting.title, startsAt: context.meeting.startsAt,
      endsAt: context.meeting.endsAt, alternativeTime: context.meeting.alternativeTime,
      responseDeadline: context.meeting.responseDeadline, budgetMin: context.meeting.budgetMin,
      budgetMax: context.meeting.budgetMax, status: context.meeting.status,
      selectedCandidateId: context.meeting.selectedCandidateId, decisionNote: context.meeting.decisionNote },
    isOrganizer: context.isOrganizer, ownProfile: context.ownProfile, counts, members, candidates: publicCandidates,
    routesConfigured: Boolean(process.env.TENCENT_MAP_KEY)
  };
}

async function refreshRoutes(meetingId, ownerId, candidateId) {
  const context = await contextFor(meetingId, ownerId);
  assertOrganizer(context); assertOpen(context.meeting);
  const candidate = await getDoc('candidates', id(candidateId));
  if (!candidate || candidate.meetingId !== meetingId || !candidate.active) throw new Error('候选地点不存在');
  const profiles = await list('profiles', meetingId);
  const marker = signature(context.meeting, candidate, profiles);
  const summary = await summarize(context.meeting, candidate, profiles);
  await db.collection('routeSummaries').doc(`${meetingId}_${candidateId}`).set({ data: {
    meetingId, candidateId, signature: marker, summary
  } });
  return { summary };
}

async function editMeeting(meetingId, ownerId, input) {
  const context = await contextFor(meetingId, ownerId);
  assertOrganizer(context); assertOpen(context.meeting);
  if (context.meeting.selectedCandidateId) throw new Error('地点已确定');
  const startsAt = dateTime(input.startsAt, true);
  const endsAt = dateTime(input.endsAt, true);
  if (endsAt <= startsAt) throw new Error('散场时间应晚于开始时间');
  if (endsAt <= new Date().toISOString()) throw new Error('散场时间应晚于当前时间');
  const responseDeadline = dateTime(input.responseDeadline);
  if (responseDeadline && responseDeadline > startsAt) throw new Error('回应截止时间应早于聚会开始');
  const budgetMin = optionalNumber(input.budgetMin);
  const budgetMax = optionalNumber(input.budgetMax);
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) throw new Error('预算范围有误');
  await db.collection('meetings').doc(meetingId).update({ data: {
    title: requireText(input.title, '聚会名称', 60), startsAt, endsAt, responseDeadline,
    alternativeTime: cleanText(input.alternativeTime, 100), budgetMin, budgetMax,
    updatedAt: new Date().toISOString()
  } });
  return { saved: true };
}

async function finalize(meetingId, ownerId, candidateId, note) {
  const context = await contextFor(meetingId, ownerId);
  assertOrganizer(context); assertOpen(context.meeting);
  if (context.meeting.selectedCandidateId) throw new Error('地点已经确定');
  const candidate = await getDoc('candidates', id(candidateId));
  if (!candidate || candidate.meetingId !== meetingId || !candidate.active) throw new Error('请选择有效候选地点');
  await db.collection('meetings').doc(meetingId).update({ data: {
    selectedCandidateId: candidateId, decisionNote: cleanText(note, 240), status: 'confirming',
    updatedAt: new Date().toISOString()
  } });
  return { saved: true };
}

async function confirm(meetingId, ownerId, answer) {
  const context = await contextFor(meetingId, ownerId);
  assertOpen(context.meeting);
  if (!context.meeting.selectedCandidateId) throw new Error('地点尚未确定');
  const finalAttendance = pick(answer, ['yes', 'no', 'maybe'], null);
  if (!finalAttendance) throw new Error('请选择参加状态');
  await db.collection('profiles').doc(`${meetingId}_${ownerId}`).update({ data: { finalAttendance, updatedAt: new Date().toISOString() } });
  return { saved: true };
}

async function closeMeeting(meetingId, ownerId) {
  const context = await contextFor(meetingId, ownerId);
  assertOrganizer(context); assertOpen(context.meeting);
  await purgeMeeting(context.meeting);
  return { saved: true };
}

// Explicit developer-console action. Test members have synthetic identities and cannot log in.
async function seedTestData(ownerId) {
  const start = new Date(Date.now() + 48 * 3600000);
  const end = new Date(start.getTime() + 2 * 3600000);
  const { meetingId } = await createMeeting({
    title: '【测试】周末朋友聚餐', startsAt: start.toISOString(), endsAt: end.toISOString(),
    budgetMin: 80, budgetMax: 150, alternativeTime: '下周同一时间'
  }, ownerId);
  const now = new Date().toISOString();
  const base = await getDoc('profiles', `${meetingId}_${ownerId}`);
  const { _id, ...template } = base;
  const members = [
    { displayName: '小林（测试）', available: 'yes', budgetMax: 120, finalAttendance: 'unanswered' },
    { displayName: '小陈（测试）', available: 'no', budgetMax: 100, hardBudgetMax: 120 },
    { displayName: '小周（测试）', available: 'unknown', budgetMax: null },
    { displayName: '小王（测试）', available: 'yes', budgetMax: 180, hardRestriction: '测试：饮食限制待确认' }
  ];
  for (let i = 0; i < members.length; i++) {
    const testOwnerId = `test_member_${i + 1}`;
    await db.collection('profiles').doc(`${meetingId}_${testOwnerId}`).set({ data: {
      ...template, ...members[i], ownerId: testOwnerId, updatedAt: now
    } });
  }
  const places = [
    { name: '测试餐厅 A · 预算友好', priceMin: 80, priceMax: 100 },
    { name: '测试餐厅 B · 中等预算', priceMin: 120, priceMax: 150 },
    { name: '测试餐厅 C · 高预算', priceMin: 180, priceMax: 220 }
  ];
  for (let i = 0; i < places.length; i++) {
    const { candidateId } = await addCandidate(meetingId, ownerId, {
      ...places[i], cuisine: '测试菜系', infoStatus: 'pending',
      note: '虚构餐厅，仅供测试；地图位置为示例坐标，不代表真实商户。',
      location: { name: '上海人民广场附近（示例）', address: '测试坐标', latitude: 31.2304 + i * 0.005, longitude: 121.4737 }
    });
    const ratings = ['love', 'cannot', 'unseen', 'okay'];
    for (let j = 0; j < members.length; j++) {
      await rateCandidate(meetingId, `test_member_${j + 1}`, candidateId, {
        rating: ratings[(j + i) % ratings.length], reason: 'budget'
      });
    }
  }
  return { meetingId, message: '已创建测试聚会：5 位成员（含你）、3 个候选餐厅；尚未定案。' };
}

exports.main = async event => {
  try {
    const ownerId = cloud.getWXContext().OPENID;
    if (!ownerId) throw new Error('请在微信中登录');
    let data;
    switch (event.action) {
      case 'seedTestData': data = await seedTestData(ownerId); break;
      case 'listMeetings': data = await listMeetings(ownerId); break;
      case 'createMeeting': data = await createMeeting(event.input || {}, ownerId); break;
      case 'joinMeeting': data = await joinMeeting(id(event.meetingId), ownerId, event.displayName); break;
      case 'getMeeting': data = await getMeeting(id(event.meetingId), ownerId); break;
      case 'saveProfile': data = await saveProfile(id(event.meetingId), ownerId, event.input || {}); break;
      case 'addCandidate': data = await addCandidate(id(event.meetingId), ownerId, event.input || {}); break;
      case 'setCandidateActive': data = await setCandidateActive(id(event.meetingId), ownerId, id(event.candidateId), event.active); break;
      case 'rateCandidate': data = await rateCandidate(id(event.meetingId), ownerId, id(event.candidateId), event.input || {}); break;
      case 'refreshRoutes': data = await refreshRoutes(id(event.meetingId), ownerId, id(event.candidateId)); break;
      case 'editMeeting': data = await editMeeting(id(event.meetingId), ownerId, event.input || {}); break;
      case 'finalize': data = await finalize(id(event.meetingId), ownerId, id(event.candidateId), event.note); break;
      case 'confirm': data = await confirm(id(event.meetingId), ownerId, event.answer); break;
      case 'closeMeeting': data = await closeMeeting(id(event.meetingId), ownerId); break;
      default: throw new Error('未知操作');
    }
    return { ok: true, data };
  } catch (error) {
    console.error('API action failed', event.action, error);
    return { ok: false, error: error.message || '操作失败', code: error.errCode || error.code || '' };
  }
};
