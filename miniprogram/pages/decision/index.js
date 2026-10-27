const { call, failure } = require('../../utils/api');
const { labelDate, money } = require('../../utils/format');
Page({
  data: { id: '', candidateId: '', candidate: null, meeting: null, isOrganizer: false,
    note: '', attendance: 'unanswered', saving: false },
  onLoad(options) { this.setData({ id: options.id || '', candidateId: options.candidateId || '' }); },
  onShow() { if (this.data.id) this.load(); },
  load() {
    call('getMeeting', { meetingId: this.data.id }).then(data => {
      const selectedId = data.meeting.selectedCandidateId || this.data.candidateId;
      const candidate = data.candidates.find(c => c._id === selectedId);
      this.setData({ meeting: { ...data.meeting, startsLabel: labelDate(data.meeting.startsAt) },
        candidate: candidate ? { ...candidate, priceLabel: money(candidate.priceMin, candidate.priceMax) } : null,
        isOrganizer: data.isOrganizer, candidateId: selectedId, note: data.meeting.decisionNote || '',
        attendance: data.ownProfile.finalAttendance || 'unanswered' });
    }).catch(failure);
  },
  input(event) { this.setData({ note: event.detail.value }); },
  finalize() {
    if (this.data.saving) return;
    wx.showModal({ title: '确定这个地点？', content: '确定后成员将单独确认参加情况。',
      success: result => { if (!result.confirm) return;
        this.setData({ saving: true });
        call('finalize', { meetingId: this.data.id, candidateId: this.data.candidateId, note: this.data.note })
          .then(() => { wx.showToast({ title: '地点已确定', icon: 'success' }); this.load(); })
          .catch(failure).finally(() => this.setData({ saving: false }));
      } });
  },
  confirm(event) {
    const answer = event.currentTarget.dataset.value;
    call('confirm', { meetingId: this.data.id, answer }).then(() => { wx.showToast({ title: '已记录', icon: 'success' }); this.load(); }).catch(failure);
  }
});
