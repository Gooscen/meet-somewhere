const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const collections = new Map();
let owner = 'organizer';
let sequence = 0;
function store(name) { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name); }
const copy = value => JSON.parse(JSON.stringify(value));
const db = { collection(name) {
  const records = store(name);
  return {
    doc(id) { return {
      async get() { if (!records.has(id)) throw new Error('not found'); return { data: copy(records.get(id)) }; },
      async set({ data }) { records.set(id, { ...copy(data), _id: id }); },
      async update({ data }) { if (!records.has(id)) throw new Error('not found'); records.set(id, { ...records.get(id), ...copy(data) }); },
      async remove() { records.delete(id); }
    }; },
    async add({ data }) { const id = `item${++sequence}`; records.set(id, { ...copy(data), _id: id }); return { _id: id }; },
    where(query) { let offset = 0; let size = 100; return {
      skip(n) { offset = n; return this; }, limit(n) { size = n; return this; },
      async get() { return { data: [...records.values()].filter(row => Object.entries(query).every(([key, value]) => row[key] === value)).slice(offset, offset + size).map(copy) }; }
    }; }
  };
} };
const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => db, getWXContext: () => ({ OPENID: owner }) };
const original = Module._load;
Module._load = function(request, ...args) { return request === 'wx-server-sdk' ? cloud : original.call(this, request, ...args); };
const api = require('../cloudfunctions/api/index');
Module._load = original;
async function call(action, input = {}, expectedOk = true) {
  const result = await api.main({ action, ...input });
  assert.equal(result.ok, expectedOk, JSON.stringify(result));
  return expectedOk ? result.data : result.error;
}

test('回复、路线摘要、时间修改和更换地点保持一致', async () => {
  collections.clear(); owner = 'organizer';
  const startsAt = new Date(Date.now() + 86400000 * 4).toISOString();
  const endsAt = new Date(Date.now() + 86400000 * 4 + 7200000).toISOString();
  const { meetingId } = await call('createMeeting', { input: { title: '晚餐', startsAt, endsAt, alternativeTime: '周日' } });
  owner = 'friend'; await call('joinMeeting', { meetingId, displayName: '朋友' });
  let info = await call('getMeeting', { meetingId });
  assert.equal(info.counts.unanswered, 2);
  await call('saveProfile', { meetingId, input: { displayName: '朋友', available: 'unknown', timeRevision: '', hardRestriction: '私人限制' } });
  info = await call('getMeeting', { meetingId });
  assert.equal(info.counts.timeUnknown, 1);
  assert.equal(info.counts.unanswered, 1);
  owner = 'organizer';
  const place = n => ({ name: n, location: { name: n, latitude: 31, longitude: 121 }, priceMin: 120, priceMax: 150 });
  const first = (await call('addCandidate', { meetingId, input: place('餐厅A') })).candidateId;
  const second = (await call('addCandidate', { meetingId, input: place('餐厅B') })).candidateId;
  await call('refreshRoutes', { meetingId, candidateId: first });
  info = await call('getMeeting', { meetingId });
  assert.equal(info.candidates.find(c => c._id === first).routeSummary.hardUnknownCount, 2);
  assert.equal(JSON.stringify(info.members).includes('私人限制'), false);
  await call('editMeeting', { meetingId, input: { title: '晚餐', startsAt: new Date(Date.now() + 86400000 * 5).toISOString(), endsAt: new Date(Date.now() + 86400000 * 5 + 7200000).toISOString(), alternativeTime: '周日' } });
  info = await call('getMeeting', { meetingId });
  assert.equal(info.counts.unanswered, 2);
  assert.equal(info.candidates.find(c => c._id === first).routeStale, true);
  owner = 'friend';
  assert.match(await call('saveProfile', { meetingId, input: { displayName: '朋友', available: 'yes', timeRevision: '' } }, false), /时间已更改/);
  info = await call('getMeeting', { meetingId });
  await call('saveProfile', { meetingId, input: { ...info.ownProfile, timeRevision: info.meeting.timeRevision, available: 'yes' } });
  owner = 'organizer';
  await call('finalize', { meetingId, candidateId: first, note: '' });
  info = await call('getMeeting', { meetingId }); const firstRevision = info.meeting.decisionRevision;
  owner = 'friend'; await call('confirm', { meetingId, answer: 'yes', decisionRevision: firstRevision });
  const third = (await call('addCandidate', { meetingId, input: place('餐厅C') })).candidateId;
  await call('rateCandidate', { meetingId, candidateId: third, input: { rating: 'like' } });
  owner = 'organizer';
  assert.match(await call('setCandidateActive', { meetingId, candidateId: first, active: false }, false), /先更换/);
  assert.match(await call('finalize', { meetingId, candidateId: second, decisionRevision: firstRevision, note: '' }, false), /说明/);
  await call('finalize', { meetingId, candidateId: second, decisionRevision: firstRevision, note: '原餐厅已满' });
  info = await call('getMeeting', { meetingId });
  assert.equal(info.members.find(p => p.displayName === '朋友').finalAttendance, 'unanswered');
  assert.equal(info.counts.attendancePending, 2);
  owner = 'friend';
  assert.match(await call('confirm', { meetingId, answer: 'yes', decisionRevision: firstRevision }, false), /地点已更改/);
  await call('confirm', { meetingId, answer: 'maybe', decisionRevision: info.meeting.decisionRevision });
  info = await call('getMeeting', { meetingId });
  assert.equal(info.ownProfile.finalAttendance, 'maybe');
});
