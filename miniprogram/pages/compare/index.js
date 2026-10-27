const { call, failure, navigate } = require('../../utils/api');
const { minutes, labelDate, money } = require('../../utils/format');
const VIEWS = [
  { key: 'balanced', label: '综合折中', explanation: '先排除已知硬性冲突，再比较最长个人往返、平均往返、意向。未知路线保留提示。' },
  { key: 'interest', label: '大家意向优先', explanation: '先检查硬性冲突，再看“很想去/比较想去”人数；还没看过和未评价不计作接受。' },
  { key: 'total', label: '往返总时间较少', explanation: '先检查硬性冲突，再按已知成员平均往返时间排序。' },
  { key: 'farthest', label: '照顾最远成员', explanation: '先检查硬性冲突，再减少最长个人往返时间。' },
  { key: 'return', label: '回程优先', explanation: '先检查硬性冲突，再减少最长回程及平均回程时间。' },
  { key: 'fair', label: '成员路程更均衡', explanation: '先检查硬性冲突，再减少最长与最短个人往返时间的差距。' }
];
function score(candidate, key) {
  const s = candidate.routeSummary || {};
  const d = candidate.distribution;
  const hard = s.hardConflictCount == null ? Infinity : s.hardConflictCount;
  const unknown = s.hardUnknownCount == null ? Infinity : s.hardUnknownCount;
  const value = n => n == null ? Infinity : n;
  const common = [hard, unknown];
  if (key === 'interest') return [...common, -(d.love + d.like), d.cannot, d.dislike, value(s.roundtripAverage)];
  if (key === 'total') return [...common, value(s.roundtripAverage), value(s.longestRoundtrip), -(d.love + d.like)];
  if (key === 'farthest') return [...common, value(s.longestRoundtrip), value(s.roundtripAverage), -(d.love + d.like)];
  if (key === 'return') return [...common, value(s.longestReturn), value(s.returnAverage), -(d.love + d.like)];
  if (key === 'fair') return [...common, value(s.roundtripGap), value(s.roundtripAverage), -(d.love + d.like)];
  return [...common, value(s.longestRoundtrip), value(s.roundtripAverage), -(d.love + d.like)];
}
function compare(a, b, key) {
  const left = score(a, key), right = score(b, key);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return a.name.localeCompare(b.name, 'zh-CN');
}
Page({
  data: { id: '', candidates: [], viewIndex: 0, views: VIEWS, explanation: VIEWS[0].explanation,
    routesConfigured: false, refreshingId: '', meeting: null },
  onLoad(options) { this.setData({ id: options.id || '' }); },
  onShow() { if (this.data.id) this.load(); },
  load() {
    call('getMeeting', { meetingId: this.data.id }).then(data => {
      if (!data.isOrganizer) throw new Error('比较台仅组织者可查看');
      this.setData({ meeting: data.meeting, routesConfigured: data.routesConfigured,
        candidates: this.decorate(data.candidates.filter(c => c.active)) });
    }).catch(failure);
  },
  decorate(candidates) {
    const key = VIEWS[this.data.viewIndex].key;
    return candidates.slice().sort((a, b) => compare(a, b, key)).map(c => {
      const s = c.routeSummary;
      return { ...c, priceLabel: money(c.priceMin, c.priceMax),
        interested: c.distribution.love + c.distribution.like,
        outboundLabel: s && s.privacyThresholdMet ? minutes(s.outboundAverage) : '未知 / 人数不足',
        returnLabel: s && s.privacyThresholdMet ? minutes(s.returnAverage) : '未知 / 人数不足',
        roundtripLabel: s && s.privacyThresholdMet ? minutes(s.roundtripAverage) : '未知 / 人数不足',
        medianLabel: s && s.privacyThresholdMet ? minutes(s.roundtripMedian) : '未知 / 人数不足',
        longestLabel: s && s.privacyThresholdMet ? minutes(s.longestRoundtrip) : '未知 / 人数不足',
        longestReturnLabel: s && s.privacyThresholdMet ? minutes(s.longestReturn) : '未知 / 人数不足',
        gapLabel: s && s.privacyThresholdMet ? minutes(s.roundtripGap) : '未知 / 人数不足',
        updatedLabel: s ? labelDate(s.updatedAt) : '尚未计算' };
    });
  },
  changeView(event) {
    const viewIndex = Number(event.detail.value);
    this.setData({ viewIndex, explanation: VIEWS[viewIndex].explanation }, () =>
      this.setData({ candidates: this.decorate(this.data.candidates) }));
  },
  refresh(event) {
    if (this.data.refreshingId) return;
    const candidateId = event.currentTarget.dataset.id;
    this.setData({ refreshingId: candidateId });
    call('refreshRoutes', { meetingId: this.data.id, candidateId }).then(() => this.load())
      .catch(failure).finally(() => this.setData({ refreshingId: '' }));
  },
  select(event) { navigate('decision', { id: this.data.id, candidateId: event.currentTarget.dataset.id }); }
});
