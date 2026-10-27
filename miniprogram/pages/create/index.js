const { call, failure, navigate } = require('../../utils/api');
const { localDate, localTime, toIso } = require('../../utils/format');
Page({
  data: { title: '', date: '', startTime: '18:30', endTime: '21:30', deadlineDate: '', deadlineTime: '20:00',
    alternativeTime: '', budgetMin: '', budgetMax: '', saving: false, editingId: '' },
  onLoad(options) {
    const date = localDate(new Date(Date.now() + 86400000).toISOString());
    this.setData({ date, deadlineDate: localDate(new Date().toISOString()) });
    if (options.id) {
      this.setData({ editingId: options.id });
      call('getMeeting', { meetingId: options.id }).then(data => {
        if (!data.isOrganizer) throw new Error('仅组织者可编辑');
        const m = data.meeting;
        this.setData({ title: m.title, date: localDate(m.startsAt), startTime: localTime(m.startsAt),
          endTime: localTime(m.endsAt), deadlineDate: localDate(m.responseDeadline),
          deadlineTime: localTime(m.responseDeadline) || '20:00', alternativeTime: m.alternativeTime || '',
          budgetMin: m.budgetMin == null ? '' : String(m.budgetMin), budgetMax: m.budgetMax == null ? '' : String(m.budgetMax) });
      }).catch(failure);
    }
  },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  pick(event) { this.input(event); },
  save() {
    if (this.data.saving) return;
    let endsAt = toIso(this.data.date, this.data.endTime);
    if (endsAt && new Date(endsAt) <= new Date(toIso(this.data.date, this.data.startTime))) {
      const next = new Date(new Date(endsAt).getTime() + 86400000);
      endsAt = next.toISOString();
    }
    const input = { title: this.data.title, startsAt: toIso(this.data.date, this.data.startTime), endsAt,
      responseDeadline: toIso(this.data.deadlineDate, this.data.deadlineTime), alternativeTime: this.data.alternativeTime,
      budgetMin: this.data.budgetMin, budgetMax: this.data.budgetMax };
    this.setData({ saving: true });
    const editing = Boolean(this.data.editingId);
    call(editing ? 'editMeeting' : 'createMeeting', { meetingId: this.data.editingId, input }).then(result => {
      wx.showToast({ title: editing ? '已更新' : '已创建', icon: 'success' });
      if (editing) wx.navigateBack();
      else wx.redirectTo({ url: `/pages/meeting/index?id=${result.meetingId}` });
    }).catch(failure).finally(() => this.setData({ saving: false }));
  }
});
