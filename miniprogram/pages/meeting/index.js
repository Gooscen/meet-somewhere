const { call, failure, navigate } = require('../../utils/api');
const { labelDate, money } = require('../../utils/format');
Page({
  data: { id: '', loading: true, data: null, invite: null, joinName: '', selectedName: '', progressPercent: 0 },
  onLoad(options) { this.setData({ id: options.id || '' }); },
  onShow() { if (this.data.id) this.load(); },
  load() {
    call('getMeeting', { meetingId: this.data.id }).then(data => {
      if (data.invite) { this.setData({ invite: { ...data.invite, dateLabel: labelDate(data.invite.startsAt) }, data: null, loading: false }); return; }
      const meeting = data.meeting;
      const selected = data.candidates.find(c => c._id === meeting.selectedCandidateId);
      const stageLabel = meeting.status === 'closed' ? '已结束' : meeting.status === 'confirming' ? '等待最终参加确认' :
        !data.candidates.some(c => c.active) ? '收集信息' :
        data.candidates.filter(c => c.active).every(c => c.distribution.unrated === 0 && c.distribution.unseen === 0) ?
          '待组织者确定地点' : '地点评价中';
      this.setData({ data: { ...data, meeting: {
        ...meeting, startsLabel: labelDate(meeting.startsAt), endsLabel: labelDate(meeting.endsAt),
        deadlineLabel: labelDate(meeting.responseDeadline), budgetLabel: money(meeting.budgetMin, meeting.budgetMax),
        stageLabel
      } }, invite: null, selectedName: selected ? selected.name : '',
        progressPercent: data.counts.members ? Math.round(data.counts.completed / data.counts.members * 100) : 0,
        loading: false });
    }).catch(error => { this.setData({ loading: false }); failure(error); });
  },
  inputName(event) { this.setData({ joinName: event.detail.value }); },
  join() { call('joinMeeting', { meetingId: this.data.id, displayName: this.data.joinName }).then(() => this.load()).catch(failure); },
  profile() { navigate('profile', { id: this.data.id }); },
  candidates() { navigate('candidates', { id: this.data.id }); },
  compare() { navigate('compare', { id: this.data.id }); },
  decision() { navigate('decision', { id: this.data.id }); },
  edit() { navigate('create', { id: this.data.id }); },
  close() {
    wx.showModal({ title: '结束本次聚会？', content: '结束后会清除本次保存的精确起终点、个人限制和路线摘要。',
      success: result => { if (result.confirm) call('closeMeeting', { meetingId: this.data.id }).then(() => this.load()).catch(failure); } });
  },
  onShareAppMessage() {
    const title = this.data.data ? this.data.data.meeting.title : this.data.invite ? this.data.invite.title : '哪儿见';
    return { title: `一起商量去哪儿见：${title}`, path: `/pages/meeting/index?id=${this.data.id}` };
  }
});
