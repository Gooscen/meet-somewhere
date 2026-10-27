function call(action, data = {}) {
  const app = getApp();
  if (!app.globalData.cloudEnvId) return Promise.reject(new Error('请先配置云环境 ID，参见 README.md'));
  return wx.cloud.callFunction({
    name: 'api',
    config: { env: app.globalData.cloudEnvId },
    data: { action, ...data }
  }).then(({ result }) => {
    if (!result || !result.ok) throw new Error((result && result.error) || '服务暂时不可用');
    return result.data;
  });
}

function failure(error) {
  const message = `${error.errCode || ''} ${error.errMsg || ''} ${error.message || ''}`;
  if (/DATABASE_COLLECTION_NOT_EXIST|database collection not exist|Db or Table not exist/i.test(message)) {
    wx.showModal({
      title: '云数据库集合未创建',
      content: `请在云环境 ${getApp().globalData.cloudEnvId} 的“云开发 → 数据库”中新建 meetings、profiles、candidates、ratings、routeSummaries 五个集合，并将每个集合权限设为“仅管理端可读写”。`,
      showCancel: false
    });
    return;
  }
  if (/FUNCTIONS?_NOT_FOUND|FunctionName.*could not be found|-501000|-501005/i.test(message)) {
    wx.showModal({
      title: '云函数 api 未找到',
      content: `请先在微信开发者工具中右键 cloudfunctions 根目录，选择“当前环境”（或“选择目标环境”），选中 ${getApp().globalData.cloudEnvId}；再右键 api 文件夹，选择“上传并部署：云端安装依赖”。`,
      showCancel: false
    });
    return;
  }
  wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 2600 });
}

function navigate(page, params = {}) {
  const query = Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
  wx.navigateTo({ url: `/pages/${page}/index${query ? '?' + query : ''}` });
}

module.exports = { call, failure, navigate };
