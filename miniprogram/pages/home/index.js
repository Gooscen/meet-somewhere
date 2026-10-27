const { call, failure, navigate } = require('../../utils/api');
const { labelDate } = require('../../utils/format');
Page({
  data: { meetings: [], loading: true, configured: true, activeCount: 0, confirmingCount: 0 },
  onShow() {
    if (!getApp().globalData.cloudEnvId) {
      this.setData({ configured: false, loading: false }); return;
    }
    call('listMeetings').then(meetings => this.setData({ meetings: meetings.map(item => ({
      ...item, dateLabel: labelDate(item.startsAt), statusLabel: ({ collecting: '协商中', confirming: '待确认', closed: '已结束' })[item.status],
      statusClass: item.status === 'collecting' ? 'orange' : item.status === 'closed' ? 'gray' : ''
    })), activeCount: meetings.filter(item => item.status !== 'closed').length,
    confirmingCount: meetings.filter(item => item.status === 'confirming').length, loading: false }))
      .catch(error => { this.setData({ loading: false }); failure(error); });
  },
  create() { navigate('create'); },
  open(event) { navigate('meeting', { id: event.currentTarget.dataset.id }); }
});
