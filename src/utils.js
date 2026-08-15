'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function stripDifficulty(value) {
  let text = String(value ?? '').normalize('NFKC').trim();
  const labels = '(?:SP\\s*)?(?:BEGINNER|NORMAL|HYPER|ANOTHER|HARD|EASY|LIGHT|INSANE|EX|MX|HD|7K|14K|LN|BEGIN|BASIC|ADVANCED|EXPERT|HARDCORE|PRO)';
  const patterns = [
    new RegExp(`\\s*[\\[\\(（【]\\s*${labels}(?:\\s*\\d+)?\\s*[\\]\\)）】]\\s*$`, 'i'),
    new RegExp(`\\s*[-_～~]\\s*${labels}(?:\\s*\\d+)?\\s*[-_～~]?\\s*$`, 'i'),
    new RegExp(`\\s+${labels}(?:\\s*\\d+)?\\s*$`, 'i')
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    for (const pattern of patterns) text = text.replace(pattern, '').trim();
    if (text === before) break;
  }
  return text || String(value ?? '').trim();
}

function archiveStem(url, baseUrl = 'https://example.invalid/') {
  if (!url) return '';
  try {
    const parsed = new URL(url, baseUrl);
    let last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    last = last.replace(/\.(?:zip|rar|7z|lzh|tar|gz)$/i, '').trim();
    if (/^[A-Za-z0-9_-]{5,16}$/.test(last) && /(?:cncncloud|drive\.google)/i.test(parsed.hostname)) return '';
    return last;
  } catch {
    return '';
  }
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const trimmed = String(value ?? '').trim();
    const key = normalize(trimmed);
    if (!trimmed || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function levelSort(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function fileKey(type, id, providerId = 'bms-library') {
  return `${String(providerId)}:${String(type)}:${String(id)}`;
}

function formatLocalDate(value, locale, unknownText) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return unknownText;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function formatRemaining(ms, translator) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [];
  if (hours > 0) parts.push(translator.t('time.hours', { count: hours }));
  if (minutes > 0 || hours > 0) parts.push(translator.t('time.minutes', { count: minutes }));
  parts.push(translator.t('time.seconds', { count: seconds }));
  return parts.join(' ');
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function createCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

function downloadTextFile(content, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob(['\uFEFF', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

module.exports = {
  sleep,
  escapeHtml,
  normalize,
  stripDifficulty,
  archiveStem,
  unique,
  levelSort,
  fileKey,
  formatLocalDate,
  formatRemaining,
  createCsv,
  downloadTextFile
};
