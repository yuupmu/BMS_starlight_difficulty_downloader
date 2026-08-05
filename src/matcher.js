'use strict';

const { CONFIG, DIRECT_FALLBACKS } = require('./config');
const {
  normalize,
  stripDifficulty,
  archiveStem,
  unique,
  sleep,
  fileKey
} = require('./utils');

function buildQueries(chart) {
  const fullTitle = [chart.title, chart.subtitle].filter(Boolean).join(' ').trim();
  const stripped = stripDifficulty(chart.title);
  const stem = archiveStem(chart.url);
  const stemDiff = archiveStem(chart.url_diff);
  const artist = String(chart.artist || '').replace(/\s*(?:feat\.|vs\.|\/).*$/i, '').trim();
  const titleBeforeBracket = String(chart.title || '').split(/[\[【（(]/)[0].trim();
  const values = [stem, fullTitle, chart.title, stripped, titleBeforeBracket, stemDiff];
  if (normalize(stripped).length <= 2 && artist) values.push(`${stripped} ${artist}`);
  return unique(values).slice(0, 5);
}

function itemDisplay(item) {
  const title = item?.title ? `${item.title}${item.subtitle ? ` ${item.subtitle}` : ''}` : '';
  return title || item?.name || item?.path || '(unnamed)';
}

function itemText(item) {
  return [item?.title, item?.subtitle, item?.name, item?.path, item?.artist].filter(Boolean).join(' ');
}

function scoreItem(item, chart, query) {
  const target = normalize(itemText(item));
  const display = normalize(itemDisplay(item));
  const q = normalize(query);
  const fullTitle = normalize([chart.title, chart.subtitle].filter(Boolean).join(' '));
  const title = normalize(chart.title);
  const stripped = normalize(stripDifficulty(chart.title));
  const stem = normalize(archiveStem(chart.url));
  const artist = normalize(chart.artist);
  let score = 0;

  if (q && display === q) score += 120;
  else if (q && target.includes(q)) score += 70;
  else if (q && q.includes(display) && display.length >= 4) score += 50;

  if (stem && target.includes(stem)) score += 100;
  if (fullTitle && target.includes(fullTitle)) score += 80;
  if (title && target.includes(title)) score += 70;
  if (stripped && stripped.length >= 3 && target.includes(stripped)) score += 55;
  if (artist && target.includes(artist)) score += 12;

  const chartTokens = new Set((stripped || title).match(/[\p{L}\p{N}]{2,}/gu) || []);
  const itemTokens = new Set(target.match(/[\p{L}\p{N}]{2,}/gu) || []);
  let overlap = 0;
  for (const token of chartTokens) if (itemTokens.has(token)) overlap += 1;
  score += Math.min(20, overlap * 5);

  return score;
}

function classify(score) {
  if (score >= 120) return { key: 'matched', className: 'ok', labelKey: 'classification.matched' };
  if (score >= 75) return { key: 'review', className: 'warn', labelKey: 'classification.review' };
  return { key: 'missing', className: 'bad', labelKey: 'classification.missing' };
}

function getFallbacks(chart) {
  if (chart?.tableId && chart.tableId !== 'starlight') return [];
  const title = normalize(stripDifficulty(chart.title));
  return DIRECT_FALLBACKS.filter((entry) => {
    const key = normalize(entry.title);
    return title === key || normalize(chart.title) === key;
  });
}

function bestAvailable(result) {
  const candidates = [];
  if (result?.song?.matches?.[0]) candidates.push({ type: 'song', ...result.song.matches[0] });
  if (result?.sabun?.matches?.[0]) candidates.push({ type: 'sabun', ...result.sabun.matches[0] });
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function scoreForResult(result) {
  const songScore = Number(result?.song?.matches?.[0]?.score) || 0;
  const sabunScore = Number(result?.sabun?.matches?.[0]?.score) || 0;
  return result?.chart?.url_diff
    ? Math.min(songScore, sabunScore)
    : Math.max(songScore, sabunScore);
}

function selectionItemsForResult(result) {
  const selections = [];
  const topSong = result?.song?.matches?.[0];
  const topSabun = result?.sabun?.matches?.[0];
  const chart = result?.chart || {};
  const metadata = {
    level: String(chart.level ?? ''),
    levelLabel: String(chart.levelSymbol || 'sr') + String(chart.level ?? ''),
    levelSymbol: String(chart.levelSymbol || 'sr'),
    tableId: String(chart.tableId || 'starlight'),
    tableName: String(chart.tableName || 'Starlight'),
    sha256: String(chart.sha256 || ''),
    md5: String(chart.md5 || '')
  };

  if (chart.url_diff && topSong?.item?.id && topSabun?.item?.id) {
    selections.push({
      type: 'song',
      id: String(topSong.item.id),
      title: String(chart.title || itemDisplay(topSong.item)),
      sourceName: itemDisplay(topSong.item),
      ...metadata
    });
    selections.push({
      type: 'sabun',
      id: String(topSabun.item.id),
      title: String(chart.title || itemDisplay(topSabun.item)),
      sourceName: itemDisplay(topSabun.item),
      ...metadata
    });
    return selections;
  }

  const top = bestAvailable(result);
  if (top?.item?.id) {
    selections.push({
      type: top.type,
      id: String(top.item.id),
      title: String(chart.title || itemDisplay(top.item)),
      sourceName: itemDisplay(top.item),
      ...metadata
    });
  }
  return selections;
}

function downloadCoverage(result, history) {
  const selections = selectionItemsForResult(result);
  const hasRequestedMatch = (type, matches) => (matches || []).some((match) => (
    match?.item?.id && history.has(type, match.item.id)
  ));
  const needsPatch = Boolean(result?.chart?.url_diff);
  const total = needsPatch ? 2 : (selections.length ? 1 : 0);
  const done = needsPatch
    ? Number(hasRequestedMatch('song', result?.song?.matches))
      + Number(hasRequestedMatch('sabun', result?.sabun?.matches))
    : Number(
      hasRequestedMatch('song', result?.song?.matches)
      || hasRequestedMatch('sabun', result?.sabun?.matches)
    );
  return {
    done,
    total,
    all: total > 0 && done === total,
    partial: done > 0 && done < total,
    selections
  };
}

async function findMatches(options) {
  const {
    api,
    chart,
    sourceType,
    maxQueries,
    isCancelled = () => false,
    delayMs = CONFIG.searchDelayMs
  } = options;

  const queries = buildQueries(chart).slice(0, maxQueries);
  const candidates = new Map();
  let lastError = '';

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    if (isCancelled()) break;
    try {
      const items = await api.search(sourceType, query);
      if (isCancelled()) break;
      lastError = '';
      for (const item of items) {
        if (!item?.id) continue;
        const score = scoreItem(item, chart, query);
        const previous = candidates.get(String(item.id));
        if (!previous || score > previous.score) candidates.set(String(item.id), { item, score, query });
      }
      const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
      if (best?.score >= 120) break;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    if (delayMs > 0 && queryIndex < queries.length - 1 && !isCancelled()) await sleep(delayMs);
  }

  return {
    matches: [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFIG.maxCandidatesPerSource),
    error: lastError
  };
}

function candidateHistoryKey(type, match) {
  return match?.item?.id ? fileKey(type, match.item.id) : '';
}

module.exports = {
  buildQueries,
  itemDisplay,
  itemText,
  scoreItem,
  classify,
  getFallbacks,
  bestAvailable,
  scoreForResult,
  selectionItemsForResult,
  downloadCoverage,
  findMatches,
  candidateHistoryKey
};
