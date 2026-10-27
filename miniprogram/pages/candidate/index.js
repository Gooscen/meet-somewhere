const { call, failure } = require('../../utils/api');
const { money, minutes } = require('../../utils/format');
Page({
  data: { id: '', candidateId: '', candidate: null, meeting: null, isOrganizer: false,
    rating: '', reason: '', saving: false },
  onLoad(options) { this.setData({ id: options.id || '', candidateId: options.candidateId || '' }); },
  onShow() { if (this.data.id && this.data.candidateId) this.load(); },
  load() {
    call('getMeeting', { meetingId: this.data.id }).then(data => {
      const c = data.candidates.find(item => item._id === this.data.candidateId);
      if (!c) throw new Error('地点不存在');
      this.setData({ meeting: data.meeting, isOrganizer: data.isOrganizer, candidate: {
        ...c, priceLabel: money(c.priceMin, c.priceMax),
        routeLabel: !c.routeSummary ? '路线未计算或已过期' : c.routeSummary.privacyThresholdMet ?
          `去程 ${minutes(c.routeSummary.outboundAverage)} · 回程 ${minutes(c.routeSummary.returnAverage)}` : '路线人数不足，时长不公开'
      }, rating: c.myRating || '', reason: c.myReason || '' });
    }).catch(failure);
  },
  select(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ rating: value, reason: ['dislike', 'cannot'].includes(value) ? this.data.reason : '' });
  },
  reason(event) { this.setData({ reason: event.currentTarget.dataset.value }); },
  save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    call('rateCandidate', { meetingId: this.data.id, candidateId: this.data.candidateId,
      input: { rating: this.data.rating, reason: this.data.reason } }).then(() => {
      wx.showToast({ title: '评价已保存', icon: 'success' }); this.load();
    }).catch(failure).finally(() => this.setData({ saving: false }));
  },
  toggleActive() {
    wx.showModal({ title: this.data.candidate.active ? '标记为不再考虑？' : '恢复候选？',
      success: result => { if (result.confirm) call('setCandidateActive', { meetingId: this.data.id,
        candidateId: this.data.candidateId, active: !this.data.candidate.active }).then(() => this.load()).catch(failure); } });
  }
});
