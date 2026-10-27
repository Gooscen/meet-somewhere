const { call, failure } = require('../../utils/api');
const { localDate, localTime, toIso } = require('../../utils/format');
function dateParts(value) { return { date: localDate(value), time: localTime(value) || '21:30' }; }
Page({
  data: {
    id: '', step: 0, saving: false, displayName: '', available: 'unknown', alternativeAvailability: 'unknown', availableTimeNote: '', alternativeTime: '',
    earliestArrivalDate: '', earliestArrivalTime: '18:30', mustLeaveAtDate: '', mustLeaveAtTime: '21:30',
    maxReturnByDate: '', maxReturnByTime: '22:30', departure: null, returnTo: null,
    departureVisibility: 'route_only', returnVisibility: 'route_only', outboundMode: 'transit', returnMode: 'transit',
    budgetMin: '', budgetMax: '', hardBudgetMax: '', hardRestriction: '', preference: ''
  },
  onLoad(options) {
    this.setData({ id: options.id || '' });
    call('getMeeting', { meetingId: options.id }).then(data => {
      const p = data.ownProfile;
      if (!p) throw new Error('请先加入聚会');
      const earliest = dateParts(p.earliestArrival), leave = dateParts(p.mustLeaveAt), returnBy = dateParts(p.maxReturnBy);
      this.setData({ displayName: p.displayName, available: p.available, alternativeAvailability: p.alternativeAvailability || 'unknown',
        availableTimeNote: p.availableTimeNote || '', alternativeTime: data.meeting.alternativeTime || '', departure: p.departure, returnTo: p.returnTo,
        departureVisibility: p.departureVisibility || 'route_only', returnVisibility: p.returnVisibility || 'route_only',
        outboundMode: p.outboundMode || 'transit', returnMode: p.returnMode || 'transit',
        budgetMin: p.budgetMin == null ? '' : String(p.budgetMin), budgetMax: p.budgetMax == null ? '' : String(p.budgetMax),
        hardBudgetMax: p.hardBudgetMax == null ? '' : String(p.hardBudgetMax),
        hardRestriction: p.hardRestriction || '', preference: p.preference || '',
        earliestArrivalDate: earliest.date, earliestArrivalTime: earliest.time,
        mustLeaveAtDate: leave.date, mustLeaveAtTime: leave.time,
        maxReturnByDate: returnBy.date, maxReturnByTime: returnBy.time });
    }).catch(failure);
  },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  select(event) { this.setData({ [event.currentTarget.dataset.field]: event.currentTarget.dataset.value }); },
  next() { this.setData({ step: Math.min(3, this.data.step + 1) }); },
  back() { this.setData({ step: Math.max(0, this.data.step - 1) }); },
  choose(event) {
    const field = event.currentTarget.dataset.field;
    wx.chooseLocation({ success: point => this.setData({ [field]: {
      name: point.name || point.address || '地图选点', address: point.address || '',
      latitude: point.latitude, longitude: point.longitude
    } }), fail: error => { if (!/cancel/i.test(error.errMsg || '')) failure(new Error('无法打开地图选点，请检查位置权限')); } });
  },
  clearLocation(event) { this.setData({ [event.currentTarget.dataset.field]: null }); },
  clearDate(event) { this.setData({ [event.currentTarget.dataset.field]: '' }); },
  save() {
    if (this.data.saving) return;
    const d = this.data;
    const input = {
      displayName: d.displayName, available: d.available, alternativeAvailability: d.alternativeAvailability,
      availableTimeNote: d.availableTimeNote,
      earliestArrival: toIso(d.earliestArrivalDate, d.earliestArrivalTime),
      mustLeaveAt: toIso(d.mustLeaveAtDate, d.mustLeaveAtTime),
      maxReturnBy: toIso(d.maxReturnByDate, d.maxReturnByTime),
      departure: d.departure, returnTo: d.returnTo, departureVisibility: d.departureVisibility,
      returnVisibility: d.returnVisibility, outboundMode: d.outboundMode, returnMode: d.returnMode,
      budgetMin: d.budgetMin, budgetMax: d.budgetMax, hardBudgetMax: d.hardBudgetMax,
      hardRestriction: d.hardRestriction, preference: d.preference
    };
    this.setData({ saving: true });
    call('saveProfile', { meetingId: d.id, input }).then(() => { wx.showToast({ title: '已保存', icon: 'success' }); wx.navigateBack(); })
      .catch(failure).finally(() => this.setData({ saving: false }));
  }
});
