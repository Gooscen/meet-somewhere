const https = require('https');
const crypto = require('crypto');

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('路线服务响应无效')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('路线服务超时')));
    req.on('error', reject);
  });
}

function validPoint(point) {
  return point && point.latitude !== null && point.longitude !== null && point.latitude !== '' && point.longitude !== '' &&
    Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= 90 && Math.abs(Number(point.longitude)) <= 180;
}

async function oneRoute(from, to, mode, departureTime) {
  if (!validPoint(from) || !validPoint(to)) return { status: 'missing' };
  if (!process.env.TENCENT_MAP_KEY) return { status: 'unconfigured' };
  const query = [
    `key=${encodeURIComponent(process.env.TENCENT_MAP_KEY)}`,
    `from=${encodeURIComponent(`${from.latitude},${from.longitude}`)}`,
    `to=${encodeURIComponent(`${to.latitude},${to.longitude}`)}`,
    'output=json'
  ];
  if (departureTime && mode !== 'walking') {
    const epoch = Math.floor(new Date(departureTime).getTime() / 1000);
    if (Number.isFinite(epoch) && epoch > Date.now() / 1000) query.push(`departure_time=${epoch}`);
  }
  const url = `https://apis.map.qq.com/ws/direction/v1/${mode}/?${query.join('&')}`;
  try {
    const result = await requestJson(url);
    const routes = result && result.result && result.result.routes;
    if (result.status !== 0 || !Array.isArray(routes) || !routes.length) return { status: 'unknown' };
    const durations = routes.map(route => Number(route.duration)).filter(n => Number.isFinite(n) && n >= 0);
    return durations.length ? { status: 'ready', minutes: Math.min(...durations), mode } : { status: 'unknown' };
  } catch (_) {
    return { status: 'unknown' };
  }
}

async function estimate(from, to, preference, departureTime) {
  const modes = preference === 'driving' ? ['driving'] : preference === 'walking' ? ['walking'] :
    preference === 'fastest' ? ['transit', 'driving'] : ['transit'];
  const results = await Promise.all(modes.map(mode => oneRoute(from, to, mode, departureTime)));
  const ready = results.filter(item => item.status === 'ready').sort((a, b) => a.minutes - b.minutes);
  return ready[0] || results.find(item => item.status === 'unconfigured') || results.find(item => item.status === 'missing') || { status: 'unknown' };
}

function signature(meeting, candidate, profiles) {
  return crypto.createHash('sha256').update(JSON.stringify([
    meeting.startsAt, meeting.endsAt, candidate.updatedAt, candidate.location,
    profiles.map(profile => [profile._id, profile.departure, profile.returnTo, profile.outboundMode, profile.returnMode,
      profile.available, profile.earliestArrival, profile.mustLeaveAt, profile.maxReturnBy,
      profile.budgetMax, profile.hardBudgetMax, profile.hardRestriction, profile.preference])
      .sort((a, b) => a[0].localeCompare(b[0]))
  ])).digest('hex');
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(numbers) { return numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length) : null; }

async function summarize(meeting, candidate, profiles) {
  const outbound = [];
  const inbound = [];
  const roundtrip = [];
  const routeStates = [];
  let hardConflictCount = 0;
  let hardUnknownCount = 0;
  let budgetFitCount = 0;
  let budgetUnknownCount = 0;
  let budgetConflictCount = 0;
  let preferenceCount = 0;
  const outboundTime = new Date(new Date(meeting.startsAt).getTime() - 60 * 60000).toISOString();
  let next = 0;
  const results = new Array(profiles.length);
  async function worker() {
    while (next < profiles.length) {
      const index = next++;
      const profile = profiles[index];
      const [go, back] = await Promise.all([
        estimate(profile.departure, candidate.location, profile.outboundMode, outboundTime),
        estimate(candidate.location, profile.returnTo, profile.returnMode, meeting.endsAt)
      ]);
      results[index] = { profile, go, back };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, profiles.length) }, () => worker()));
  for (const { profile, go, back } of results) {
    if (profile.preference) preferenceCount++;
    routeStates.push([go.status, back.status]);
    if (go.status === 'ready') outbound.push(go.minutes);
    if (back.status === 'ready') inbound.push(back.minutes);
    if (go.status === 'ready' && back.status === 'ready') roundtrip.push(go.minutes + back.minutes);
    let conflict = profile.available === 'no' ||
      (profile.earliestArrival && profile.earliestArrival > meeting.startsAt) ||
      (profile.mustLeaveAt && profile.mustLeaveAt < meeting.endsAt);
    if (Number.isFinite(profile.hardBudgetMax) && Number.isFinite(candidate.priceMin) && candidate.priceMin > profile.hardBudgetMax) conflict = true;
    if (profile.maxReturnBy && back.status === 'ready' && new Date(meeting.endsAt).getTime() + back.minutes * 60000 > new Date(profile.maxReturnBy).getTime()) conflict = true;
    if (conflict) hardConflictCount++;
    else if (profile.available === 'unknown' || profile.hardRestriction ||
      (profile.hardBudgetMax !== null && profile.hardBudgetMax !== undefined && candidate.priceMin === null) ||
      (profile.maxReturnBy && back.status !== 'ready')) hardUnknownCount++;
    if (!Number.isFinite(profile.budgetMax) || !Number.isFinite(candidate.priceMin)) budgetUnknownCount++;
    else if (candidate.priceMin > profile.budgetMax) budgetConflictCount++;
    else if (Number.isFinite(candidate.priceMax) && candidate.priceMax <= profile.budgetMax) budgetFitCount++;
    else budgetUnknownCount++;
  }
  // 至少三位成员有完整往返路线才展示群体统计，避免从小样本反推个人位置。
  const safe = roundtrip.length >= 3;
  return {
    status: process.env.TENCENT_MAP_KEY ? 'ready' : 'unconfigured',
    updatedAt: new Date().toISOString(),
    totalMembers: profiles.length,
    outboundKnown: outbound.length,
    returnKnown: inbound.length,
    roundtripKnown: roundtrip.length,
    routeUnknownCount: routeStates.filter(pair => pair[0] !== 'ready' || pair[1] !== 'ready').length,
    hardConflictCount, hardUnknownCount, budgetFitCount, budgetConflictCount, budgetUnknownCount, preferenceCount,
    outboundAverage: safe ? average(outbound) : null,
    returnAverage: safe ? average(inbound) : null,
    roundtripAverage: safe ? average(roundtrip) : null,
    roundtripMedian: safe ? median(roundtrip) : null,
    longestRoundtrip: safe ? Math.max(...roundtrip) : null,
    longestReturn: safe ? Math.max(...inbound) : null,
    roundtripGap: safe ? Math.max(...roundtrip) - Math.min(...roundtrip) : null,
    privacyThresholdMet: safe
  };
}

module.exports = { validPoint, signature, summarize };
