const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function allFor(collection, meetingId) {
  const result = [];
  while (true) {
    const page = (await db.collection(collection).where({ meetingId }).skip(result.length).limit(100).get()).data;
    result.push(...page);
    if (page.length < 100) return result;
  }
}

exports.main = async () => {
  const now = new Date().toISOString();
  let closed = 0;
  while (true) {
    const meetings = (await db.collection('meetings').where({ endsAt: _.lte(now), status: _.neq('closed') }).limit(20).get()).data;
    if (!meetings.length) break;
    for (const meeting of meetings) {
      const [profiles, summaries] = await Promise.all([
        allFor('profiles', meeting._id), allFor('routeSummaries', meeting._id)
      ]);
      await Promise.all(profiles.map(profile => db.collection('profiles').doc(profile._id).update({ data: {
        departure: null, returnTo: null, hardRestriction: '', preference: '', availableTimeNote: '',
        budgetMin: null, budgetMax: null, hardBudgetMax: null,
        earliestArrival: null, mustLeaveAt: null, maxReturnBy: null, updatedAt: now
      } })));
      await Promise.all(summaries.map(summary => db.collection('routeSummaries').doc(summary._id).remove()));
      await db.collection('meetings').doc(meeting._id).update({ data: { status: 'closed', updatedAt: now } });
      closed++;
    }
  }
  return { closed };
};
