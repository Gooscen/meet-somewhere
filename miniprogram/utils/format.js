function localDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function localTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function labelDate(iso) { return iso ? `${localDate(iso)} ${localTime(iso)}` : '未填写'; }
function toIso(date, time) { return date && time ? new Date(`${date}T${time}:00`).toISOString() : null; }
function money(min, max) {
  if (min == null && max == null) return '未提供';
  if (min == null) return `不超过 ${max} 元`;
  if (max == null) return `${min} 元起`;
  return `${min}–${max} 元`;
}
function minutes(value) { return value == null ? '未知' : `约 ${Math.round(value)} 分钟`; }
module.exports = { localDate, localTime, labelDate, toIso, money, minutes };
