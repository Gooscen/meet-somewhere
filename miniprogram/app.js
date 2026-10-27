const config = require('./config');

App({
  onLaunch() {
    if (config.cloudEnvId && wx.cloud) {
      wx.cloud.init({ env: config.cloudEnvId, traceUser: true });
    }
  },
  globalData: { cloudEnvId: config.cloudEnvId }
});
