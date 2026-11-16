const { call, failure } = require('../../utils/api');
const { labelDate, money } = require('../../utils/format');
Page({
  data: { id: '', candidateId: '', candidate: null, meeting: null, isOrganizer: false,
    changing: false, note: '', attendance: 'unanswered', saving: false },
  onLoad(options) { this.setData({ id: options.id || '', candidateId: options.candidateId || '' }); },
  onShow() { if (this.data.id) this.load(); },
  load() {
    call('getMeeting', { meetingId: this.data.id }).then(data => {
      const requested = this.data.candidateId;
      const changing = Boolean(data.isOrganizer && requested && data.meeting.selectedCandidateId && requested !== data.meeting.selectedCandidateId);
      const selectedId = changing ? requested : (data.meeting.selectedCandidateId || requested);
      const candidate = data.candidates.find(c => c._id === selectedId);
      this.setData({ meeting: { ...data.meeting, startsLabel: labelDate(data.meeting.startsAt) },
        candidate: candidate ? { ...candidate, priceLabel: money(candidate.priceMin, candidate.priceMax) } : null,
        isOrganizer: data.isOrganizer, changing, candidateId: selectedId,
        note: changing ? '' : data.meeting.decisionNote || '', attendance: data.ownProfile.finalAttendance || 'unanswered' });
    }).catch(failure);
  },
  input(event) { this.setData({ note: event.detail.value }); },
  async finalize() {
    if (this.data.saving) return;
    if (this.data.changing && !this.data.note.trim()) { wx.showToast({ title: '请填写更换地点的说明', icon: 'none' }); return; }
    this.setData({ saving: true });
    try {
      const current = await call('getMeeting', { meetingId: this.data.id });
      const candidate = current.candidates.find(c => c._id === this.data.candidateId && c.active);
      if (!candidate) throw new Error('候选地点已不可用，请返回比较台');
      if (current.meeting.selectedCandidateId !== this.data.meeting.selectedCandidateId || current.meeting.decisionRevision !== this.data.meeting.decisionRevision) throw new Error('聚会决定已变更，请返回后重新选择');
      const warnings = [];
      if (!candidate.routeSummary) warnings.push(candidate.routeStale ? '信息已变化，路线与可行性需要更新' : '尚未计算路线与可行性');
      else {
        const s = candidate.routeSummary;
        if (s.hardConflictCount) warnings.push(`${s.hardConflictCount} 位成员有已知硬性冲突`);
        if (s.hardUnknownCount) warnings.push(`${s.hardUnknownCount} 位成员的硬性条件待确认`);
        if (s.routeUnknownCount) warnings.push(`${s.routeUnknownCount} 位成员的往返路线未知`);
      }
      if (current.counts.unanswered) warnings.push(`${current.counts.unanswered} 人尚未回复时间`);
      if (candidate.distribution.unrated || candidate.distribution.unseen) warnings.push(`${candidate.distribution.unrated + candidate.distribution.unseen} 人未完成这家店的评价`);
      const content = `${warnings.length ? warnings.join('；') + '。\n' : ''}${this.data.changing ? '更换后所有成员需要重新确认参加情况。' : '确定后成员将单独确认参加情况。'}`;
      wx.showModal({ title: this.data.changing ? '更换这个地点？' : '确定这个地点？', content,
        success: result => {
          if (!result.confirm) { this.setData({ saving: false }); return; }
          call('finalize', { meetingId: this.data.id, candidateId: this.data.candidateId, note: this.data.note,
            decisionRevision: current.meeting.decisionRevision }).then(() => {
              this.setData({ changing: false }); wx.showToast({ title: '地点已确定', icon: 'success' }); this.load();
            }).catch(failure).finally(() => this.setData({ saving: false }));
        }, fail: () => this.setData({ saving: false }) });
    } catch (error) { this.setData({ saving: false }); failure(error); }
  },
  confirm(event) {
    const answer = event.currentTarget.dataset.value;
    call('confirm', { meetingId: this.data.id, answer, decisionRevision: this.data.meeting.decisionRevision }).then(() => { wx.showToast({ title: '已记录', icon: 'success' }); this.load(); }).catch(failure);
  },
  onShareAppMessage() {
    const m = this.data.meeting || {};
    const place = this.data.candidate ? this.data.candidate.name : '餐厅';
    return { title: `${m.title || '聚会'}：${m.startsLabel || ''}，地点 ${place}，请确认参加`, path: `/pages/meeting/index?id=${this.data.id}` };
  }
});
