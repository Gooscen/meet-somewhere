const { call, failure, navigate } = require('../../utils/api');
const { money, minutes } = require('../../utils/format');
Page({
  data: { id: '', candidates: [], meeting: null, adding: false, saving: false,
    name: '', location: null, priceMin: '', priceMax: '', cuisine: '', note: '', sourceUrl: '', infoStatus: 'pending' },
  onLoad(options) { this.setData({ id: options.id || '' }); },
  onShow() { if (this.data.id) this.load(); },
  load() {
    call('getMeeting', { meetingId: this.data.id }).then(data => {
      this.setData({ meeting: data.meeting, candidates: data.candidates.map(c => ({ ...c,
        priceLabel: money(c.priceMin, c.priceMax),
        wantCount: c.distribution.love + c.distribution.like,
        routeLabel: !c.routeSummary ? '路线未计算或已过期' :
          c.routeSummary.privacyThresholdMet ? `去程 ${minutes(c.routeSummary.outboundAverage)} · 回程 ${minutes(c.routeSummary.returnAverage)}` : '路线人数不足，暂不显示时长'
      })) });
    }).catch(failure);
  },
  toggleAdd() { this.setData({ adding: !this.data.adding }); },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  select(event) { this.setData({ infoStatus: event.currentTarget.dataset.value }); },
  choose() { wx.chooseLocation({ success: point => this.setData({ location: {
    name: point.name || point.address || '地图选点', address: point.address || '', latitude: point.latitude, longitude: point.longitude
  } }), fail: error => { if (!/cancel/i.test(error.errMsg || '')) failure(new Error('无法打开地图选点，请检查位置权限')); } }); },
  save() {
    if (this.data.saving) return;
    const d = this.data;
    this.setData({ saving: true });
    call('addCandidate', { meetingId: d.id, input: { name: d.name, location: d.location,
      priceMin: d.priceMin, priceMax: d.priceMax, cuisine: d.cuisine, note: d.note, sourceUrl: d.sourceUrl,
      infoStatus: d.infoStatus } }).then(() => {
      this.setData({ adding: false, name: '', location: null, priceMin: '', priceMax: '', cuisine: '', note: '', sourceUrl: '' });
      this.load(); wx.showToast({ title: '已添加', icon: 'success' });
    }).catch(failure).finally(() => this.setData({ saving: false }));
  },
  open(event) { navigate('candidate', { id: this.data.id, candidateId: event.currentTarget.dataset.id }); }
});
