import { useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Globe2,
  Highlighter,
  Info,
  LayoutGrid,
  Library,
  List,
  RotateCcw,
  Search,
  Shuffle,
  SlidersHorizontal,
  UsersRound,
  X,
} from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL || '/';
const DEFAULT_LAYOUT = { width: 1800, height: 1200 };
const RECENT_REFERENCE_COUNT = 6;
const ALL_COLLECTIONS_ID = 'all';
const VIEW_MODES = new Set(['atlas', 'list']);
const LIST_SORTS = new Set(['recent', 'citations', 'title', 'author', 'year']);
const FEATURE_FILTERS = new Set(['annotations', 'shared']);
const REFERENCE_HASH_SUFFIX_PATTERN = /--([^#/?]+)$/u;
const IMAGE_PREVIEW_KINDS = new Set(['open-graph', 'archive', 'screenshot', 'pdf-screenshot', 'oembed']);
const catalogCache = new Map();

const FALLBACK_PALETTES = [
  ['#f3d2c1', '#18212f', '#c4533d'],
  ['#cde7df', '#162622', '#267c69'],
  ['#e8d8fb', '#20162f', '#7447a8'],
  ['#f5e6a7', '#282211', '#b3821d'],
  ['#c9ddff', '#111e33', '#3867b8'],
  ['#f0d8d8', '#2f1717', '#a74747'],
  ['#d6e8bd', '#182412', '#5a7e28'],
];

function assetUrl(src = '') {
  if (!src) return '';
  if (/^https?:\/\//iu.test(src)) return src;
  return `${BASE_URL}${src.replace(/^\/+/u, '')}`;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .trim();
}

function formatUpdated(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function formatPhysicalSize(size) {
  if (!size?.widthMm || !size?.heightMm) return '';
  const values = [size.widthMm, size.heightMm, size.depthMm].filter(Boolean);
  return `${values.join(' × ')} mm`;
}

function hashPathAndParams(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/u, '');
  const queryIndex = raw.indexOf('?');
  const rawPath = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? '' : raw.slice(queryIndex + 1);
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // Invalid hand-edited hashes are handled as unknown references/state.
  }
  return {
    path,
    params: new URLSearchParams(rawQuery),
  };
}

function readViewParams() {
  const { params } = hashPathAndParams();
  const value = (key) => (params.has(key) ? params.get(key) : '');
  const collection = value('collection');
  const view = value('view');
  const sort = value('sort');
  const features = new Set(
    String(value('features') || '')
      .split(',')
      .map((feature) => feature.trim())
      .filter((feature) => FEATURE_FILTERS.has(feature)),
  );
  return {
    view: VIEW_MODES.has(view) ? view : 'atlas',
    sort: LIST_SORTS.has(sort) ? sort : 'recent',
    root: value('root') || '',
    collection,
    query: value('q') || '',
    type: value('type') || '',
    pubYear: value('pub') || '',
    featureFilters: features,
  };
}

function slugifyHashPart(value, fallback = 'reference') {
  return normalize(value || fallback)
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72)
    .replace(/-+$/gu, '') || fallback;
}

function referenceTitleSlug(reference) {
  return slugifyHashPart(reference?.title, 'reference');
}

function referenceCitekeySlug(reference) {
  return slugifyHashPart(reference?.citationKey || reference?.key, String(reference?.key || 'reference').toLowerCase());
}

function referenceHashPath(reference) {
  if (!reference?.key) return '';
  return `${referenceTitleSlug(reference)}--${referenceCitekeySlug(reference)}`;
}

function referenceTokenFromHash(hash = window.location.hash) {
  const { path } = hashPathAndParams(hash);
  return slugifyHashPart(path.match(REFERENCE_HASH_SUFFIX_PATTERN)?.[1] || '', '');
}

function referenceMatchesToken(reference, token) {
  if (!reference || !token) return false;
  return token === referenceCitekeySlug(reference) || token === slugifyHashPart(reference.key, '');
}

function findReferenceByHashToken(references, token) {
  if (!token) return null;
  return references.find((reference) => referenceMatchesToken(reference, token)) || null;
}

function catalogEntries(index) {
  return index?.collections || [];
}

function defaultRootId(index) {
  return index?.defaultRoot || catalogEntries(index)[0]?.id || ALL_COLLECTIONS_ID;
}

function indexedRootsForHashToken(index, token) {
  if (!token) return [];
  const keys = [
    token,
    token.toLowerCase(),
    token.toUpperCase(),
  ];
  for (const key of keys) {
    const roots = index?.referenceCollections?.[key];
    if (Array.isArray(roots) && roots.length) return roots;
  }
  return [];
}

function appHash(reference, state = {}, defaultRoot = '') {
  const params = new URLSearchParams();
  if (state.root && state.root !== defaultRoot) params.set('root', state.root);
  if (state.view === 'list') params.set('view', 'list');
  if (state.sort && state.sort !== 'recent') params.set('sort', state.sort);
  if (state.collection) params.set('collection', state.collection);
  if (state.query?.trim()) params.set('q', state.query.trim());
  if (state.type) params.set('type', state.type);
  if (state.pubYear) params.set('pub', state.pubYear);
  const features = Array.from(state.featureFilters || [])
    .filter((feature) => FEATURE_FILTERS.has(feature))
    .sort();
  if (features.length) params.set('features', features.join(','));
  const path = referenceHashPath(reference);
  const query = params.toString().replace(/%3A/giu, ':');
  if (!path && !query) return '';
  return `#${path}${query ? `?${query}` : ''}`;
}

function writeAppUrl({ reference = null, state = {}, defaultRoot = '', historyMode = 'replace', detailEntry = false }) {
  const url = new URL(window.location.href);
  ['view', 'sort', 'root', 'collection', 'q', 'type', 'pub', 'features', 'year', 'memoir'].forEach((key) => {
    url.searchParams.delete(key);
  });
  url.hash = appHash(reference, state, defaultRoot);
  window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](
    {
      ...(window.history.state || {}),
      zotscapeDetailEntry: Boolean(reference && detailEntry),
    },
    '',
    url,
  );
}

function getSearchBlob(reference) {
  return normalize([
    reference.title,
    reference.shortTitle,
    reference.creatorsLabel,
    reference.year,
    reference.publisher,
    reference.publicationTitle,
    reference.bookTitle,
    reference.abstract,
    ...(reference.tags || []),
    ...(reference.memoirNames || []),
  ].filter(Boolean).join(' '));
}

function typeOptions(references) {
  return Array.from(new Map(references.map((reference) => [
    reference.itemType,
    displayTypeLabel(reference),
  ])).entries())
    .sort((left, right) => left[1].localeCompare(right[1], 'fr'));
}

function yearOptions(references) {
  return Array.from(new Set(references.map((reference) => reference.year).filter(Boolean)))
    .sort((left, right) => Number(right) - Number(left));
}

function toggleSet(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function referenceMatchesFeature(reference, feature) {
  if (feature === 'annotations') return reference.annotations?.count > 0 || reference.notes?.length > 0;
  if (feature === 'shared') return reference.memoirKeys?.length > 1;
  return true;
}

function activeToolCount({ activeCollection, query, typeFilter, yearFilter, featureFilters }) {
  return [
    activeCollection,
    query,
    typeFilter,
    yearFilter,
    featureFilters.size,
  ].filter(Boolean).length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashValue(value = '') {
  return Array.from(String(value)).reduce((hash, char) => (
    ((hash << 5) - hash + char.charCodeAt(0)) >>> 0
  ), 2166136261);
}

function parseTransformState(value, fallback) {
  const text = String(value || '');
  const translateScale = text.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)\s*scale\((-?\d+(?:\.\d+)?)\)/u);
  if (translateScale) {
    return {
      positionX: Number(translateScale[1]),
      positionY: Number(translateScale[2]),
      scale: Number(translateScale[3]),
    };
  }
  const matrix = text.match(/matrix\((-?\d+(?:\.\d+)?),\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/u);
  if (matrix) {
    return {
      scale: Number(matrix[1]),
      positionX: Number(matrix[3]),
      positionY: Number(matrix[4]),
    };
  }
  return fallback;
}

function supportType(reference) {
  if (reference.itemType === 'book') return 'book';
  if (reference.itemType === 'bookSection') return 'chapter';
  if (reference.itemType === 'film' || reference.itemType === 'videoRecording' || reference.itemType === 'tvBroadcast') return 'film';
  if (reference.itemType === 'webpage' || reference.itemType === 'blogPost' || reference.itemType === 'encyclopediaArticle') return 'web';
  if (reference.itemType === 'journalArticle' || reference.itemType === 'newspaperArticle') return 'article';
  if (reference.itemType === 'thesis') return 'thesis';
  return 'document';
}

function displayTypeLabel(reference) {
  const type = supportType(reference);
  if (type === 'thesis') return 'Document / thèse';
  if (type === 'chapter') return 'Chapitre';
  if (type === 'web') return 'Page web';
  if (type === 'film') return 'Film';
  if (reference.itemType === 'document') return 'Document';
  return reference.typeLabel || reference.itemType;
}

function atlasCaptionWidth(reference, layout) {
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  if (!layout?.width || !layout?.mediaHeight || assetKind === 'fallback') return layout?.width || 0;
  const ratio = Number(reference.asset?.ratio || (
    reference.asset?.width && reference.asset?.height
      ? reference.asset.width / reference.asset.height
      : 0
  ));
  if (!Number.isFinite(ratio) || ratio <= 0) return layout.width;
  if (type === 'web') return layout.width;
  if (type === 'film') {
    return Math.min(layout.width, Math.max(72, (layout.mediaHeight - 28) * ratio + 40));
  }
  return Math.min(layout.width, Math.max(56, layout.mediaHeight * ratio));
}

function collectionDisplay(name = '') {
  const [person, ...topicParts] = String(name || '').trim().split(/\s+—\s+/u);
  const topic = topicParts.join(' — ').trim();
  if (topic) return { primary: topic, secondary: `Collection de ${person}` };
  return { primary: String(person || '').trim() || 'Collection', secondary: '' };
}

function collectionReaderLabel(name = '') {
  const display = collectionDisplay(name);
  return display.secondary
    ? `${display.primary} · ${display.secondary}`
    : display.primary;
}

function physicalScaleFactor(reference, enabled) {
  if (!enabled || !reference.physicalSize || !['book', 'chapter', 'thesis'].includes(supportType(reference))) return 1;
  const height = Number(reference.physicalSize.heightMm || 0);
  if (!Number.isFinite(height) || height <= 0) return 1;
  return clamp(height / 240, 0.72, 1.28);
}

function objectDimensions(reference, featured = false, measuredRatios = new Map(), physicalScale = false) {
  const type = supportType(reference);
  const assetKind = reference.asset?.kind || 'fallback';
  const seed = hashValue(reference.key || reference.title);
  const scale = ([0.96, 1, 1.04][seed % 3])
    * (featured ? 1.02 : 0.9)
    * physicalScaleFactor(reference, physicalScale);
  const captionHeight = featured ? 98 : 86;
  const gap = 10;
  if (assetKind === 'cover' && ['book', 'chapter', 'thesis'].includes(type)) {
    const rawRatio = Number(reference.asset?.ratio || 0.66);
    if (rawRatio > 1.08) {
      const ratio = clamp(rawRatio, 1.08, 1.92);
      const widthBase = {
        book: 380,
        chapter: 360,
        thesis: 372,
      }[type];
      const width = Math.round(widthBase * scale);
      const mediaHeight = Math.round(clamp(width / ratio, 156, 248));
      return {
        width,
        height: mediaHeight + gap + captionHeight,
        mediaHeight,
        captionHeight,
      };
    }
    const ratio = clamp(rawRatio, 0.42, 0.9);
    const mediaHeightBase = {
      book: 346,
      chapter: 312,
      thesis: 344,
    }[type];
    const mediaHeight = Math.round(mediaHeightBase * scale);
    const width = Math.round(clamp(mediaHeight * ratio, type === 'chapter' ? 176 : 190, type === 'thesis' ? 276 : 286));
    return {
      width,
      height: mediaHeight + gap + captionHeight,
      mediaHeight,
      captionHeight,
    };
  }
  if (IMAGE_PREVIEW_KINDS.has(assetKind) && ['article', 'document', 'web'].includes(type)) {
    const measuredRatio = Number(measuredRatios.get(reference.key) || 0);
    const fallbackRatio = assetKind === 'archive' || assetKind === 'screenshot' ? 1.86 : 1.58;
    const ratio = clamp(Number(reference.asset?.ratio || measuredRatio || fallbackRatio), 0.5, 3);
    const widthBase = type === 'article' ? 330 : 340;
    const width = Math.round(widthBase * scale);
    const chromeHeight = type === 'web' ? 34 : 0;
    const mediaHeight = Math.round(clamp((width - (type === 'web' ? 16 : 0)) / ratio + chromeHeight, 112 * scale, 292 * scale));
    return {
      width,
      height: mediaHeight + gap + captionHeight,
      mediaHeight,
      captionHeight,
    };
  }
  const dimensions = {
    article: { width: 286, mediaHeight: 332 },
    book: { width: 226, mediaHeight: 324 },
    chapter: { width: 214, mediaHeight: 286 },
    document: { width: 276, mediaHeight: 318 },
    film: { width: 392, mediaHeight: 224 },
    thesis: { width: 248, mediaHeight: 332 },
    web: { width: 356, mediaHeight: 238 },
  }[type] || { width: 276, mediaHeight: 318 };
  const width = Math.round(dimensions.width * scale);
  const mediaHeight = Math.round(dimensions.mediaHeight * scale);
  return {
    width,
    height: mediaHeight + gap + captionHeight,
    mediaHeight,
    captionHeight,
  };
}

function addedTimestamp(reference) {
  const timestamp = Date.parse(reference.dateAdded || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortByRecent(left, right) {
  return addedTimestamp(right) - addedTimestamp(left)
    || left.title.localeCompare(right.title, 'fr')
    || left.key.localeCompare(right.key);
}

function sortListReferences(references, sort) {
  return [...references].sort((left, right) => {
    if (sort === 'citations') {
      const leftCount = left.memoirKeys?.length || 0;
      const rightCount = right.memoirKeys?.length || 0;
      if (leftCount !== rightCount) return rightCount - leftCount;
      return sortByRecent(left, right);
    }
    if (sort === 'title') {
      return left.title.localeCompare(right.title, 'fr')
        || left.creatorsLabel.localeCompare(right.creatorsLabel, 'fr')
        || left.key.localeCompare(right.key);
    }
    if (sort === 'author') {
      return left.creatorsLabel.localeCompare(right.creatorsLabel, 'fr')
        || left.title.localeCompare(right.title, 'fr')
        || left.key.localeCompare(right.key);
    }
    if (sort === 'year') {
      const leftYear = Number.parseInt(left.year, 10);
      const rightYear = Number.parseInt(right.year, 10);
      const leftHasYear = Number.isFinite(leftYear);
      const rightHasYear = Number.isFinite(rightYear);
      if (leftHasYear !== rightHasYear) return leftHasYear ? -1 : 1;
      if (leftHasYear && rightHasYear && leftYear !== rightYear) return rightYear - leftYear;
      return left.title.localeCompare(right.title, 'fr') || left.key.localeCompare(right.key);
    }
    return sortByRecent(left, right);
  });
}

function itemBounds(items) {
  if (!items.length) return null;
  const left = Math.min(...items.map(({ layout }) => layout.x));
  const top = Math.min(...items.map(({ layout }) => layout.y));
  const right = Math.max(...items.map(({ layout }) => layout.x + layout.width));
  const bottom = Math.max(...items.map(({ layout }) => layout.y + layout.height));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  };
}

function headerHeight(viewport) {
  return viewport.width < 760 ? 74 : 78;
}

function transformForPoint(point, viewport, scale) {
  const chromeHeight = headerHeight(viewport);
  return {
    x: viewport.width / 2 - point.x * scale,
    y: chromeHeight + (viewport.height - chromeHeight) / 2 - point.y * scale,
  };
}

function sharedMemoirCount(left, right) {
  return (left.memoirKeys || []).filter((key) => (right.memoirKeys || []).includes(key)).length;
}

function relatedReferences(reference, references) {
  if (!reference) return [];
  return references
    .filter((candidate) => candidate.key !== reference.key && sharesMemoir(reference, candidate))
    .sort((left, right) => (
      sharedMemoirCount(reference, right) - sharedMemoirCount(reference, left)
      || Number(right.itemType === reference.itemType) - Number(left.itemType === reference.itemType)
      || sortByRecent(left, right)
      || left.title.localeCompare(right.title, 'fr')
    ))
    .slice(0, 3);
}

function sourceActionLabel(reference) {
  const type = supportType(reference);
  if (type === 'film') return 'Regarder le film';
  if (type === 'web') return 'Voir le site';
  if (type === 'article') return 'Lire l’article';
  if (type === 'thesis') return 'Consulter le document';
  if (type === 'book' || type === 'chapter') return 'Consulter le livre';
  return 'Consulter la ressource';
}

function packReferences(references, viewport, recentKeys, sharedKeys, sharedOnly, measuredRatios = new Map(), physicalScale = false) {
  const compact = viewport.width < 760;
  const margin = compact ? 64 : 104;
  const tableWidth = clamp(
    viewport.width * (compact ? 3.45 : 2),
    compact ? 1320 : 2550,
    compact ? 1660 : 3000,
  );
  const placedLayouts = [];
  const orderedReferences = [...references].sort((left, right) => {
    const recentDifference = Number(recentKeys.has(right.key)) - Number(recentKeys.has(left.key));
    if (recentDifference) return recentDifference;
    return sortByRecent(left, right);
  });
  if (!orderedReferences.length) {
    return { items: [], layout: { width: tableWidth, height: viewport.height + 320 } };
  }
  const visibleRecent = orderedReferences.filter((reference) => recentKeys.has(reference.key));
  const featuredReferences = sharedOnly
    ? orderedReferences
    : (visibleRecent.length ? visibleRecent : orderedReferences.slice(0, RECENT_REFERENCE_COUNT));
  const featuredKeys = new Set(featuredReferences.map((reference) => reference.key));
  const layoutsByKey = new Map();
  const collisionGap = compact ? 20 : 22;
  const firstCollision = (layout) => placedLayouts.find((placed) => (
    layout.x < placed.x + placed.width + collisionGap
    && layout.x + layout.width + collisionGap > placed.x
    && layout.y < placed.y + placed.height + collisionGap
    && layout.y + layout.height + collisionGap > placed.y
  ));
  const settleLayout = (layout) => {
    let guard = 0;
    let conflict = firstCollision(layout);
    while (conflict && guard < 180) {
      layout.y = conflict.y + conflict.height + collisionGap;
      conflict = firstCollision(layout);
      guard += 1;
    }
  };

  const columns = Math.min(3, Math.max(1, featuredReferences.length));
  const horizontalGap = compact ? 34 : 42;
  const verticalGap = compact ? 28 : 34;
  let featuredY = compact ? 138 : 122;
  for (let rowStart = 0; rowStart < featuredReferences.length; rowStart += columns) {
    const row = featuredReferences.slice(rowStart, rowStart + columns).map((reference) => ({
      reference,
      size: objectDimensions(reference, true, measuredRatios, physicalScale),
    }));
    const rowWidth = row.reduce((sum, item) => sum + item.size.width, 0) + horizontalGap * (row.length - 1);
    const rowHeight = Math.max(...row.map((item) => item.size.height));
    let featuredX = Math.round((tableWidth - rowWidth) / 2);
    row.forEach(({ reference, size }, rowIndex) => {
      const seed = hashValue(`${reference.key}:${rowStart + rowIndex}`);
      const layout = {
        index: rowStart + rowIndex + 1,
        x: featuredX,
        y: featuredY + Math.round((((seed >> 8) % 100) / 100 - 0.5) * 24),
        width: size.width,
        height: size.height,
        mediaHeight: size.mediaHeight,
        captionHeight: size.captionHeight,
        rotation: 0,
        layer: 4,
        featured: true,
      };
      placedLayouts.push(layout);
      layoutsByKey.set(reference.key, layout);
      featuredX += size.width + horizontalGap;
    });
    featuredY += rowHeight + verticalGap;
  }

  const meetingReferences = sharedOnly ? [] : orderedReferences.filter((reference) => (
    sharedKeys.has(reference.key) && !featuredKeys.has(reference.key)
  ));
  const meetingKeys = new Set(meetingReferences.map((reference) => reference.key));

  const regularReferences = orderedReferences.filter((reference) => (
    !featuredKeys.has(reference.key) && !meetingKeys.has(reference.key)
  ));

  const contentWidth = tableWidth - margin * 2;
  const columnGap = compact ? 28 : 34;
  const columnCount = compact
    ? clamp(Math.floor(contentWidth / 330), 3, 4)
    : clamp(Math.floor(contentWidth / 330), 5, 7);
  const columnWidth = (contentWidth - columnGap * (columnCount - 1)) / columnCount;
  const laneTops = Array(columnCount).fill(compact ? 142 : 128);
  const laneGapY = compact ? 22 : 26;

  const placeInLanes = (reference, index, meeting = false) => {
    const size = objectDimensions(reference, false, measuredRatios, physicalScale);
    const seed = hashValue(`${meeting ? 'meeting' : 'regular'}:${reference.key}:${index}`);
    const span = size.width <= columnWidth + columnGap * 0.45
      ? 1
      : Math.min(columnCount, Math.ceil((size.width + columnGap) / (columnWidth + columnGap)));
    let bestStart = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let start = 0; start <= columnCount - span; start += 1) {
      const laneY = Math.max(...laneTops.slice(start, start + span));
      const tieBreak = ((hashValue(`${reference.key}:${start}`) % 19) - 9) / 10;
      const score = laneY + tieBreak;
      if (score < bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }
    const slotLeft = margin + bestStart * (columnWidth + columnGap);
    const slotWidth = columnWidth * span + columnGap * (span - 1);
    const spareX = Math.max(0, slotWidth - size.width);
    const jitterLimit = Math.min(spareX / 2, compact ? 16 : 24);
    const jitterX = Math.round(((((seed >> 16) % 100) / 100) - 0.5) * jitterLimit * 2);
    const jitterY = Math.round((((seed >> 8) % 100) / 100) * (compact ? 10 : 14));
    const layout = {
      index: featuredReferences.length + index + 1,
      x: clamp(
        Math.round(slotLeft + (slotWidth - size.width) / 2 + jitterX),
        margin,
        Math.max(margin, tableWidth - margin - size.width),
      ),
      y: Math.max(margin, Math.round(Math.max(...laneTops.slice(bestStart, bestStart + span)) + jitterY)),
      width: size.width,
      height: size.height,
      mediaHeight: size.mediaHeight,
      captionHeight: size.captionHeight,
      rotation: 0,
      layer: meeting || reference.memoirKeys?.length > 1 ? 3 : 1,
      featured: false,
      meeting,
    };
    settleLayout(layout);
    const nextLaneTop = layout.y + layout.height + laneGapY;
    for (let lane = bestStart; lane < bestStart + span; lane += 1) {
      laneTops[lane] = Math.max(laneTops[lane], nextLaneTop);
    }
    placedLayouts.push(layout);
    layoutsByKey.set(reference.key, layout);
  };

  meetingReferences.forEach((reference, index) => {
    placeInLanes(reference, index, true);
  });
  const regularPlacementOrder = [...regularReferences].sort((left, right) => {
    const leftSize = objectDimensions(left, false, measuredRatios, physicalScale);
    const rightSize = objectDimensions(right, false, measuredRatios, physicalScale);
    return (rightSize.width * rightSize.height) - (leftSize.width * leftSize.height)
      || rightSize.width - leftSize.width
      || sortByRecent(left, right);
  });
  regularPlacementOrder.forEach((reference, index) => {
    placeInLanes(reference, meetingReferences.length + index, false);
  });
  const items = orderedReferences.map((reference) => ({ reference, layout: layoutsByKey.get(reference.key) }));
  const tableHeight = Math.max(...placedLayouts.map((layout) => layout.y + layout.height), viewport.height + 320) + margin;
  return {
    items,
    layout: {
      width: tableWidth,
      height: tableHeight,
    },
  };
}

function sharesMemoir(left, right) {
  return (left.memoirKeys || []).some((key) => (right.memoirKeys || []).includes(key));
}


function sourceHref(reference) {
  return reference.url || reference.doiUrl || '';
}

function openExternalHref(event, href) {
  if (!href || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.open(href, '_blank', 'noopener,noreferrer');
}

function ExternalLink({ href, children, onClick, ...props }) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        onClick?.(event);
        openExternalHref(event, href);
      }}
    >
      {children}
    </a>
  );
}

function fallbackPalette(reference) {
  const [paper, ink, accent] = FALLBACK_PALETTES[hashValue(reference.key || reference.title) % FALLBACK_PALETTES.length];
  return {
    '--fallback-paper': paper,
    '--fallback-ink': ink,
    '--fallback-accent': accent,
  };
}

function ReferenceStickers({ recent = false, shared = false, className = '' }) {
  if (!recent && !shared) return null;
  return (
    <span className={`object-stickers${className ? ` ${className}` : ''}`} aria-hidden="true">
      {recent && <span className="object-sticker object-sticker--new">Nouv.</span>}
      {shared && <span className="object-sticker object-sticker--shared">🔥</span>}
    </span>
  );
}

function ReferenceVisual({ reference, detail = false, overlay = null, onImageRatio = null }) {
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  const assetRatio = Number(reference.asset?.ratio || (
    reference.asset?.width && reference.asset?.height
      ? reference.asset.width / reference.asset.height
      : 0
  ));
  const orientation = assetRatio > 0
    ? (assetRatio > 1.08 ? 'landscape' : assetRatio < 0.88 ? 'portrait' : 'square')
    : 'unknown';
  if (assetKind === 'fallback') {
    const showKicker = !(type === 'web' && !detail);
    return (
      <span
        className={`dom-fallback dom-fallback--${type}${detail ? ' dom-fallback--detail' : ''}`}
        style={fallbackPalette(reference)}
      >
        {showKicker && <span className="dom-fallback-kicker">{displayTypeLabel(reference)}</span>}
        <strong>{reference.title}</strong>
        {reference.creatorsLabel && <span className="dom-fallback-authors">{reference.creatorsLabel}</span>}
        <em>{reference.year || 's. d.'}</em>
        {overlay}
      </span>
    );
  }
  if (!reference.asset?.src) return null;
  const image = (
    <img
      src={assetUrl(reference.asset.src)}
      alt=""
      loading={detail ? 'eager' : 'lazy'}
      onLoad={onImageRatio ? (event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) onImageRatio(naturalWidth / naturalHeight);
      } : undefined}
    />
  );
  const previewClass = IMAGE_PREVIEW_KINDS.has(assetKind) ? ' object-visual-shell--preview' : '';
  const shellClassName = `object-visual-shell object-visual-shell--${assetKind} object-visual-shell--${type} object-visual-shell--${orientation}${previewClass}${detail ? ' object-visual-shell--detail' : ''}`;
  const shellStyle = assetRatio > 0 ? { '--asset-ratio': assetRatio } : undefined;
  if (detail) {
    return (
      <span className={shellClassName} style={shellStyle}>
        {image}
      </span>
    );
  }
  return (
    <span
      className={shellClassName}
      style={shellStyle}
    >
      {image}
      {overlay}
    </span>
  );
}

function MiniMapVisual({ reference }) {
  if (reference.asset?.kind === 'fallback') {
    return <span className="mini-map-fallback" style={fallbackPalette(reference)} />;
  }
  if (!reference.asset?.src) return null;
  return <img src={assetUrl(reference.asset.src)} alt="" />;
}

function FeatureToggle({ active, icon: Icon, label, onClick }) {
  return (
    <button className={`tool-chip${active ? ' is-active' : ''}`} type="button" onClick={onClick} aria-pressed={active}>
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function ViewSwitcher({ value, onChange }) {
  return (
    <div className="view-switcher" role="group" aria-label="Mode d’affichage">
      <button
        type="button"
        aria-pressed={value === 'atlas'}
        aria-label="Vue atlas"
        title="Vue atlas"
        onClick={() => onChange('atlas')}
      >
        <LayoutGrid size={17} aria-hidden="true" />
        <span>Atlas</span>
      </button>
      <button
        type="button"
        aria-pressed={value === 'list'}
        aria-label="Vue liste"
        title="Vue liste"
        onClick={() => onChange('list')}
      >
        <List size={18} aria-hidden="true" />
        <span>Liste</span>
      </button>
    </div>
  );
}

function CollectionSelector({ activeCollection, collections, onChange }) {
  const [open, setOpen] = useState(false);
  const selectorRef = useRef(null);
  const current = collections.find((collection) => collection.id === activeCollection) || collections[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === 'Escape' || !selectorRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [open]);

  return (
    <div className="collection-selector" ref={selectorRef}>
      <h1>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span>{current?.label || 'Corpus'}</span>
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </h1>
      {open && (
        <div className="collection-selector-menu" role="menu">
          {collections.map((collection) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={collection.id === activeCollection}
              key={collection.id}
              onClick={() => {
                setOpen(false);
                onChange(collection.id);
              }}
            >
              <span>{collection.label}</span>
              <small>
                {collection.groupLabel ? `${collection.groupLabel} · ` : ''}
                {collection.stats?.referenceCount || 0} références
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ListVisual({ reference, overlay = null }) {
  return <ReferenceVisual reference={reference} overlay={overlay} />;
}

function ReferenceListRow({ reference, active, recent, shared, onSelect }) {
  const annotationCount = reference.annotations?.count || 0;
  const noteCount = reference.notes?.length || 0;
  const context = [
    displayTypeLabel(reference),
    reference.year,
    ...(reference.memoirNames || []).map(collectionReaderLabel),
    annotationCount > 0 ? `${annotationCount} surligne${annotationCount > 1 ? 's' : ''}` : '',
    noteCount > 0 ? `${noteCount} note${noteCount > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return (
    <li id={`reference-${reference.key}`} className={`reference-list-item${active ? ' is-active' : ''}`}>
      <button
        className="reference-list-row"
        type="button"
        onClick={() => onSelect(reference)}
        aria-label={`${reference.title}, ${reference.creatorsLabel}`}
      >
        <span className={`reference-list-visual reference-list-visual--${supportType(reference)}`}>
          <ListVisual
            reference={reference}
            overlay={<ReferenceStickers recent={recent} shared={shared} className="reference-list-stickers" />}
          />
        </span>
        <span className="reference-list-copy">
          <span className="reference-list-heading">
            <strong>{reference.title}</strong>
          </span>
          <span className="reference-list-author">{reference.creatorsLabel}</span>
          <span className="reference-list-meta">
            {context.map((item) => <span key={item}>{item}</span>)}
          </span>
        </span>
      </button>
    </li>
  );
}

function ReferenceList({ references, sort, onSortChange, recentKeys, sharedKeys, selectedReference, onSelect, onDiscover }) {
  const recentReferences = sort === 'recent'
    ? references.filter((reference) => recentKeys.has(reference.key))
    : [];
  const collectionReferences = sort === 'recent'
    ? references.filter((reference) => !recentKeys.has(reference.key))
    : references;
  const groups = sort === 'recent'
    ? [
      { label: 'Derniers ajouts', references: recentReferences },
      { label: 'La collection', references: collectionReferences },
    ].filter((group) => group.references.length)
    : [{ label: '', references: collectionReferences }];

  return (
    <section className="reference-list-view" aria-label="Liste des références">
      <div className="reference-list-toolbar">
        <p>{references.length} référence{references.length > 1 ? 's' : ''}</p>
        <div className="reference-list-commands">
          <button className="list-discover" type="button" onClick={onDiscover}>
            <Shuffle size={16} aria-hidden="true" />
            <span>Découvrir</span>
          </button>
          <label>
            <span>Trier par</span>
            <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
              <option value="recent">Ajouts récents</option>
              <option value="citations">Citations</option>
              <option value="title">Titre</option>
              <option value="author">Auteur</option>
              <option value="year">Année</option>
            </select>
          </label>
        </div>
      </div>
      {groups.map((group) => (
        <section className="reference-list-group" key={group.label || sort}>
          {group.label && <h2>{group.label}</h2>}
          <ol className="reference-list">
            {group.references.map((reference) => (
              <ReferenceListRow
                key={reference.key}
                reference={reference}
                active={selectedReference?.key === reference.key}
                recent={recentKeys.has(reference.key)}
                shared={sharedKeys.has(reference.key)}
                onSelect={onSelect}
              />
            ))}
          </ol>
        </section>
      ))}
    </section>
  );
}

function ToolPanel({
  open,
  memoirs,
  activeCollection,
  setActiveCollection,
  query,
  setQuery,
  typeFilter,
  setTypeFilter,
  yearFilter,
  setYearFilter,
  featureFilters,
  setFeatureFilters,
  allTypeOptions,
  allYearOptions,
  referenceCount,
  searchFocusToken,
  onClose,
  onOpenAbout,
  onReset,
}) {
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open || !searchFocusToken) return undefined;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, searchFocusToken]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, open]);

  return (
    <>
      <div className={`panel-scrim${open ? ' is-open' : ''}`} role="presentation" onMouseDown={onClose} />
      <aside id="filter-panel" className={`tool-panel${open ? ' is-open' : ''}`} role="dialog" aria-modal="false" aria-hidden={!open} aria-label="Filtres">
        <div className="panel-head">
          <h2>Filtres</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>
        </div>

        <div className="tool-field tool-field--search">
          <label htmlFor="reference-search"><Search size={16} aria-hidden="true" />Recherche</label>
          <span className="search-control">
            <input id="reference-search" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titre, auteur, sujet..." />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche">
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>

        <fieldset className="memoir-filter">
          <legend>Collections</legend>
          <div className="memoir-filter-list">
            <button className={!activeCollection ? 'is-active' : ''} type="button" onClick={() => setActiveCollection('')} aria-pressed={!activeCollection}>
              <span><strong>Toutes les références</strong><small>Collection complète</small></span>
              <em>{referenceCount}</em>
            </button>
            {memoirs.map((memoir) => {
              const display = collectionDisplay(memoir.name);
              return (
                <button
                  className={activeCollection === memoir.key ? 'is-active' : ''}
                  key={memoir.key}
                  type="button"
                  onClick={() => setActiveCollection(memoir.key)}
                  aria-pressed={activeCollection === memoir.key}
                >
                  <span><strong>{display.primary}</strong><small>{display.secondary}</small></span>
                  <em>{memoir.referenceCount}</em>
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="tool-field">
          <span>Type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">Tous</option>
            {allTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <div className="tool-cluster" aria-label="Filtres lecteurs">
          <FeatureToggle active={featureFilters.has('annotations')} icon={Highlighter} label="Avec surlignes" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'annotations'))} />
          <FeatureToggle active={featureFilters.has('shared')} icon={UsersRound} label="Références partagées" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'shared'))} />
        </div>

        <details className="secondary-filters" open={Boolean(yearFilter)}>
          <summary>Plus de filtres</summary>
          <label className="tool-field">
            <span>Année</span>
            <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
              <option value="">Toutes</option>
              {allYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
        </details>

        <button className="reset-button" type="button" onClick={onReset}>
          <RotateCcw size={16} aria-hidden="true" />
          <span>Réinitialiser</span>
        </button>
        <button className="about-mobile-button" type="button" onClick={onOpenAbout}>
          <Info size={16} aria-hidden="true" />
          <span>À propos</span>
        </button>
      </aside>
    </>
  );
}

function AboutPanel({ open, catalog, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, open]);

  return (
    <>
      <div className={`panel-scrim about-scrim${open ? ' is-open' : ''}`} role="presentation" onMouseDown={onClose} />
      <aside id="about-panel" className={`about-panel${open ? ' is-open' : ''}`} role="dialog" aria-modal="false" aria-hidden={!open} aria-label="À propos">
        <div className="panel-head">
          <h2>À propos</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>
        </div>
        <div className="about-intro">
          <p>Cette table rassemble les livres, films, articles et sites qui composent un corpus de recherche à l’Ensad Nancy.</p>
          <p>Elle ne cherche pas à figer une bibliographie. Elle montre une collection en train de se faire : des références arrivent, circulent entre les projets, se couvrent de notes et dessinent des proximités.</p>
        </div>
        <dl className="about-stats">
          <div><dt>Références</dt><dd>{catalog.stats.referenceCount}</dd></div>
          <div><dt>Collections</dt><dd>{catalog.stats.memoirCount}</dd></div>
          <div><dt>Références partagées</dt><dd>{catalog.stats.sharedReferenceCount || 0}</dd></div>
          <div><dt>Surlignes</dt><dd>{catalog.stats.annotationCount || 0}</dd></div>
        </dl>
        <p className="about-updated">Mis à jour le {formatUpdated(catalog.generatedAt)}</p>
        <div className="about-links">
          <ExternalLink href={catalog.source.groupUrl}>
            <Library size={16} aria-hidden="true" /> Groupe Zotero
          </ExternalLink>
          <ExternalLink href={catalog.source.rootCollectionUrl}>
            <ArrowUpRight size={16} aria-hidden="true" /> Collection Zotero
          </ExternalLink>
        </div>
      </aside>
    </>
  );
}

function AtlasObject({ reference, layout, active, related, recent, shared, onSelect, onImageRatio }) {
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  const landscapeCover = assetKind === 'cover' && Number(reference.asset?.ratio || 0) > 1.08;
  const stickers = <ReferenceStickers recent={recent} shared={shared} />;
  const captionWidth = atlasCaptionWidth(reference, layout);

  return (
    <article
      className={`atlas-object atlas-object--${assetKind} atlas-object--${type}${active ? ' is-active' : ''}${related ? ' is-related' : ''}${recent ? ' is-recent' : ''}${shared ? ' is-shared' : ''}${landscapeCover ? ' is-landscape-cover' : ''}`}
      style={{
        width: layout.width,
        height: layout.height,
        '--media-height': `${layout.mediaHeight}px`,
        '--caption-height': `${layout.captionHeight}px`,
        '--caption-width': `${captionWidth}px`,
        '--atlas-x': `${layout.x}px`,
        '--atlas-y': `${layout.y}px`,
        zIndex: active ? 24 : related ? 16 : shared ? 14 : recent ? 10 : layout.layer || 1,
      }}
    >
      <button
        className="atlas-object-main"
        type="button"
        onClick={() => onSelect(reference)}
        aria-label={`${reference.title}, ${reference.creatorsLabel}`}
      >
        <span className="object-media">
          <ReferenceVisual
            reference={reference}
            overlay={stickers}
            onImageRatio={(ratio) => onImageRatio(reference.key, ratio)}
          />
        </span>
      </button>
      <div className="object-caption">
        <p>{reference.title}</p>
        <span>{reference.creatorsLabel}</span>
      </div>
    </article>
  );
}

function AtlasViewport({ focalItems, focusItem, viewport, scale, setTransform, children }) {
  const bounds = useMemo(() => itemBounds(focalItems), [focalItems]);
  const focalSignature = focalItems.map(({ reference, layout }) => (
    `${reference.key}:${layout.x}:${layout.y}:${layout.width}:${layout.height}`
  )).join('|');
  const target = useMemo(() => {
    if (!bounds) return null;
    return transformForPoint({ x: bounds.centerX, y: bounds.centerY }, viewport, scale);
  }, [bounds, scale, viewport]);

  useEffect(() => {
    if (!target) return undefined;
    const frame = window.requestAnimationFrame(() => setTransform(target.x, target.y, scale, 0));
    return () => window.cancelAnimationFrame(frame);
  }, [focalSignature, scale, target?.x, target?.y]);

  useEffect(() => {
    if (!focusItem) return undefined;
    const point = {
      x: focusItem.layout.x + focusItem.layout.width / 2,
      y: focusItem.layout.y + focusItem.layout.height / 2,
    };
    const next = transformForPoint(point, viewport, scale);
    const frame = window.requestAnimationFrame(() => setTransform(next.x, next.y, scale, 260, 'easeOut'));
    return () => window.cancelAnimationFrame(frame);
  }, [focusItem?.reference.key, scale, setTransform, viewport]);

  const navigate = (x, y) => {
    const next = transformForPoint({ x, y }, viewport, scale);
    setTransform(next.x, next.y, scale, 220, 'easeOut');
  };

  return children({ navigate });
}

function MiniMap({ items, layout, activeKey, transformState, viewport, onNavigate }) {
  const compact = viewport.width < 760;
  const maxWidth = compact ? 96 : 150;
  const maxHeight = compact ? 112 : 150;
  const layoutRatio = layout.width / Math.max(1, layout.height);
  const availableRatio = maxWidth / maxHeight;
  const width = Math.round(availableRatio > layoutRatio ? maxHeight * layoutRatio : maxWidth);
  const height = Math.round(availableRatio > layoutRatio ? maxHeight : maxWidth / layoutRatio);
  const scaleX = width / layout.width;
  const scaleY = height / layout.height;
  const chromeHeight = headerHeight(viewport);
  const rawView = transformState?.scale
    ? {
      x: (-transformState.positionX / transformState.scale) * scaleX,
      y: ((chromeHeight - transformState.positionY) / transformState.scale) * scaleY,
      width: (viewport.width / transformState.scale) * scaleX,
      height: ((viewport.height - chromeHeight) / transformState.scale) * scaleY,
    }
    : null;
  const view = rawView && {
    x: clamp(rawView.x, 0, Math.max(0, width - Math.min(width, rawView.width))),
    y: clamp(rawView.y, 0, Math.max(0, height - Math.min(height, rawView.height))),
    width: Math.min(width, rawView.width),
    height: Math.min(height, rawView.height),
  };

  const navigate = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1) * layout.width;
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1) * layout.height;
    onNavigate(x, y);
  };

  return (
    <aside className="mini-map" aria-label="Plan de la table">
      <button className="mini-map-board" type="button" style={{ width, height }} onClick={navigate} aria-label="Déplacer la table avec le mini-plan">
        {items.map(({ reference, layout: item }) => (
          <span
            key={reference.key}
            className={`mini-map-item${reference.key === activeKey ? ' is-active' : ''}`}
            style={{
              left: item.x * scaleX,
              top: item.y * scaleY,
              width: Math.max(3, item.width * scaleX),
              height: Math.max(3, item.height * scaleY),
            }}
          >
            <MiniMapVisual reference={reference} />
          </span>
        ))}
        {view && <span className="mini-map-viewport" style={{ left: view.x, top: view.y, width: view.width, height: view.height }} />}
      </button>
    </aside>
  );
}

function DetailPanel({ reference, suggestions, onSelect, onCollectionSelect, onClose, suspended }) {
  useEffect(() => {
    if (!reference || suspended) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, reference, suspended]);

  if (!reference) return null;
  const href = sourceHref(reference);
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  const embedSrc = reference.embed?.src || (type === 'web' && href ? href : '');
  const embedHtml = embedSrc ? '' : reference.embed?.html || '';
  const physicalSize = formatPhysicalSize(reference.physicalSize);
  const prefersCover = assetKind === 'cover' && ['book', 'chapter', 'thesis'].includes(type);
  const canEmbed = !prefersCover && Boolean(embedSrc || embedHtml);
  const siteEmbed = canEmbed && type === 'web';
  const showMedia = canEmbed || (assetKind !== 'fallback' && reference.asset?.src);

  return (
    <aside className={`detail-panel${showMedia ? '' : ' detail-panel--no-media'}`} role="dialog" aria-modal="false" aria-label={reference.title}>
      <div className="detail-panel-head">
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

      {showMedia && (
        <div className={`detail-media detail-media--${assetKind} detail-media--${type}${canEmbed ? ' detail-media--embed' : ''}`}>
          {canEmbed ? (
            <div className={`embed-stage${siteEmbed ? ' embed-stage--site' : ''}`}>
              <iframe
                title={reference.embed?.title || reference.title}
                src={embedSrc || undefined}
                srcDoc={embedSrc ? undefined : embedHtml}
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : (
            <ReferenceVisual reference={reference} detail />
          )}
        </div>
      )}

      <div className="detail-body">
        <h2>{reference.title}</h2>
        <p className="detail-authors">{reference.creatorsLabel}</p>

        {reference.abstract && <p className="detail-abstract">{reference.abstract}</p>}

        {(reference.memoirNames || []).length > 0 && (
          <section className="detail-collections">
            <p>Présent dans</p>
            <div className="detail-rubrics">
              {(reference.memoirNames || []).map((name, index) => {
                const memoirKey = reference.memoirKeys?.[index] || '';
                return (
                  <button
                    key={`${memoirKey || name}-${index}`}
                    type="button"
                    onClick={() => memoirKey && onCollectionSelect?.(memoirKey)}
                    disabled={!memoirKey}
                  >
                    {collectionReaderLabel(name)}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {(reference.annotations?.count > 0 || reference.notes?.length > 0) && (
          <section className="annotation-section">
            <div className="annotation-head">
              <Highlighter size={18} aria-hidden="true" />
              <h3>Notes et surlignes</h3>
              <span>{reference.annotations?.count || 0}</span>
            </div>
            {(reference.annotations?.samples || []).map((sample, index) => (
              <blockquote key={`${sample.page}-${index}`} className="annotation-card" style={{ '--annotation-color': sample.color || '#f0d44d' }}>
                <p>{sample.text || sample.comment}</p>
                {sample.page && <cite>p. {sample.page}</cite>}
              </blockquote>
            ))}
            {(reference.notes || []).map((note, index) => (
              <blockquote key={`note-${index}`} className="annotation-card" style={{ '--annotation-color': '#f0d44d' }}>
                <p>{note.text}</p>
              </blockquote>
            ))}
          </section>
        )}

        <div className="detail-actions">
          {href && (
            <ExternalLink href={href}>
              <ArrowUpRight size={16} />
              <span>{sourceActionLabel(reference)}</span>
            </ExternalLink>
          )}
          {reference.zoteroUrl && (
            <ExternalLink href={reference.zoteroUrl}>
              <Library size={16} />
              <span>Zotero</span>
            </ExternalLink>
          )}
          {reference.archive?.url && (
            <ExternalLink href={reference.archive.url}>
              <Globe2 size={16} />
              <span>Archive web</span>
            </ExternalLink>
          )}
        </div>

        {suggestions.length > 0 && (
          <section className="detail-suggestions">
            <h3>Dans la même collection</h3>
            <div>
              {suggestions.map((suggestion) => (
                <button type="button" key={suggestion.key} onClick={() => onSelect(suggestion)}>
                  <span className={`suggestion-visual suggestion-visual--${supportType(suggestion)}`}>
                    <ListVisual reference={suggestion} />
                  </span>
                  <span className="suggestion-copy">
                    <strong>{suggestion.title}</strong>
                    <small>{suggestion.creatorsLabel}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <details className="detail-bibliography">
          <summary>Informations bibliographiques</summary>
          <dl className="detail-meta">
            <dt>Type</dt><dd>{displayTypeLabel(reference)}</dd>
            {reference.year && <><dt>Année</dt><dd>{reference.year}</dd></>}
            {reference.publisher && <><dt>Édition</dt><dd>{reference.publisher}</dd></>}
            {reference.publicationTitle && <><dt>Revue</dt><dd>{reference.publicationTitle}</dd></>}
            {reference.bookTitle && <><dt>Dans</dt><dd>{reference.bookTitle}</dd></>}
            {reference.isbn && <><dt>ISBN</dt><dd>{reference.isbn}</dd></>}
            {physicalSize && <><dt>Format</dt><dd>{physicalSize}</dd></>}
            {reference.doi && <><dt>DOI</dt><dd>{reference.doi}</dd></>}
            {reference.cover?.attribution && (
              <>
                <dt>Couverture</dt>
                <dd className="cover-credit">
                  {reference.cover.sourceUrl ? (
                    <ExternalLink href={reference.cover.sourceUrl}>
                      {reference.cover.attribution}
                    </ExternalLink>
                  ) : reference.cover.attribution}
                  {reference.cover.retrievedAt && <small> · {reference.cover.retrievedAt}</small>}
                </dd>
              </>
            )}
          </dl>
        </details>
      </div>
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <BookOpen size={30} aria-hidden="true" />
      <p>Aucun objet dans cette sélection.</p>
    </div>
  );
}

function normalizeCatalogIndexLabels(index) {
  return {
    ...index,
    collections: catalogEntries(index).map((collection) => ({
      ...collection,
      label: collection.label || collection.id || 'Collection',
    })),
  };
}

function collectionOptions(index) {
  const collections = catalogEntries(index)
    .filter((collection) => (collection.stats?.referenceCount || 0) > 0);
  const summedStats = collections.reduce((stats, collection) => ({
    referenceCount: stats.referenceCount + (collection.stats?.referenceCount || 0),
  }), { referenceCount: 0 });
  const indexedReferenceCount = Number(index?.stats?.referenceCount);
  const allStats = {
    ...summedStats,
    referenceCount: Number.isFinite(indexedReferenceCount) && indexedReferenceCount > 0
      ? indexedReferenceCount
      : summedStats.referenceCount,
  };
  return [
    {
      id: ALL_COLLECTIONS_ID,
      label: 'Toutes les collections',
      stats: allStats,
    },
    ...collections,
  ];
}

async function loadCatalogEntry(entry) {
  const cacheKey = entry.catalog;
  if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
  const response = await fetch(assetUrl(entry.catalog));
  if (!response.ok) throw new Error(`${entry.catalog} ${response.status}`);
  const payload = await response.json();
  catalogCache.set(cacheKey, payload);
  return payload;
}

async function findRootForHashToken(index, token) {
  if (!token) return '';
  const entries = catalogEntries(index);
  const availableRoots = new Set(entries.map((entry) => entry.id));
  const indexedRoot = indexedRootsForHashToken(index, token)
    .find((root) => availableRoots.has(root));
  if (indexedRoot) return indexedRoot;
  for (const entry of entries) {
    const catalog = await loadCatalogEntry(entry);
    if (findReferenceByHashToken(catalog.references || [], token)) return entry.id;
  }
  return '';
}

function mergeMemoirMemberships(existing, incoming) {
  const pairs = new Map();
  const addPair = (key, name) => {
    if (!key) return;
    pairs.set(key, name || existing.memoirNames?.[existing.memoirKeys?.indexOf(key)] || key);
  };
  (existing.memoirKeys || []).forEach((key, index) => addPair(key, existing.memoirNames?.[index]));
  (incoming.memoirKeys || []).forEach((key, index) => addPair(key, incoming.memoirNames?.[index]));
  return {
    memoirKeys: Array.from(pairs.keys()),
    memoirNames: Array.from(pairs.values()),
  };
}

function aggregateCatalogs(index, catalogs) {
  const referencesByKey = new Map();
  catalogs.forEach((catalog) => {
    (catalog.references || []).forEach((reference) => {
      const previous = referencesByKey.get(reference.key);
      if (!previous) {
        referencesByKey.set(reference.key, { ...reference });
        return;
      }
      const membership = mergeMemoirMemberships(previous, reference);
      referencesByKey.set(reference.key, {
        ...previous,
        tags: Array.from(new Set([...(previous.tags || []), ...(reference.tags || [])])),
        ...membership,
        collectionKeys: membership.memoirKeys,
        collectionNames: membership.memoirNames,
      });
    });
  });

  const references = Array.from(referencesByKey.values());
  const memoirsByKey = new Map();
  catalogs.forEach((catalog) => {
    (catalog.collections || catalog.memoirs || []).forEach((memoir) => {
      if (!memoirsByKey.has(memoir.key)) memoirsByKey.set(memoir.key, { ...memoir });
    });
  });
  const memoirs = Array.from(memoirsByKey.values())
    .map((memoir) => ({
      ...memoir,
      referenceCount: references.filter((reference) => reference.memoirKeys?.includes(memoir.key)).length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'fr'));
  const coverSources = {};
  catalogs.forEach((catalog) => {
    Object.entries(catalog.stats?.coverCoverage?.bySource || {}).forEach(([source, count]) => {
      coverSources[source] = (coverSources[source] || 0) + count;
    });
  });
  const generatedAt = catalogs
    .map((catalog) => catalog.generatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const sharedReferences = references
    .filter((reference) => (reference.memoirKeys || []).length > 1)
    .sort((left, right) => (
      (right.memoirKeys || []).length - (left.memoirKeys || []).length
      || left.title.localeCompare(right.title, 'fr')
    ))
    .map((reference) => ({
      key: reference.key,
      title: reference.title,
      creatorsLabel: reference.creatorsLabel,
      year: reference.year,
      memoirKeys: reference.memoirKeys || [],
      memoirNames: reference.memoirNames || [],
      collectionKeys: reference.collectionKeys || reference.memoirKeys || [],
      collectionNames: reference.collectionNames || reference.memoirNames || [],
      count: (reference.memoirKeys || []).length,
    }));
  const first = catalogs[0] || {};
  return {
    generatedAt,
    source: {
      ...(first.source || {}),
      rootCollectionKey: ALL_COLLECTIONS_ID,
      rootCollectionName: 'Toutes les collections',
      rootCollectionUrl: first.source?.groupUrl,
      rootId: ALL_COLLECTIONS_ID,
    },
    physicalScale: Boolean(index?.physicalScale),
    stats: {
      referenceCount: references.length,
      memoirCount: memoirs.length,
      collectionCount: memoirs.length,
      sharedReferenceCount: sharedReferences.length,
      annotationCount: references.reduce((sum, reference) => sum + (reference.annotations?.count || 0), 0),
      noteCount: references.reduce((sum, reference) => sum + (reference.notes?.length || 0), 0),
      attachmentCount: references.reduce((sum, reference) => sum + (reference.attachments?.count || 0), 0),
      coverCoverage: {
        bySource: coverSources,
      },
    },
    layout: DEFAULT_LAYOUT,
    memoirs,
    collections: memoirs,
    references,
    sharedReferences,
  };
}

async function loadCatalogForRoot(index, rootIdValue) {
  if (rootIdValue === ALL_COLLECTIONS_ID) {
    const entries = catalogEntries(index);
    const cacheKey = `${ALL_COLLECTIONS_ID}:${entries.map((entry) => entry.catalog).join('|')}`;
    if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
    const catalogs = await Promise.all(entries.map(loadCatalogEntry));
    const payload = aggregateCatalogs(index, catalogs);
    catalogCache.set(cacheKey, payload);
    return payload;
  }
  const entry = catalogEntries(index).find((collection) => collection.id === rootIdValue);
  if (!entry) throw new Error(`Collection inconnue : ${rootIdValue}`);
  return loadCatalogEntry(entry);
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [catalogIndex, setCatalogIndex] = useState(null);
  const [activeRoot, setActiveRoot] = useState('');
  const [error, setError] = useState('');
  const [activeCollection, setActiveCollection] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [featureFilters, setFeatureFilters] = useState(new Set());
  const [toolsOpen, setToolsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [selectedReference, setSelectedReference] = useState(null);
  const [viewMode, setViewMode] = useState(() => readViewParams().view);
  const [listSort, setListSort] = useState(() => readViewParams().sort);
  const [focusReferenceKey, setFocusReferenceKey] = useState('');
  const [transformState, setTransformState] = useState({ scale: 1, positionX: 0, positionY: 0 });
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [measuredAssetRatios, setMeasuredAssetRatios] = useState(() => new Map());
  const activeRootRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    async function loadIndex() {
      try {
        const response = await fetch(`${BASE_URL}data/catalog-index.json`);
        if (!response.ok) throw new Error(`catalog-index.json ${response.status}`);
        const payload = await response.json();
        if (!cancelled) setCatalogIndex(normalizeCatalogIndexLabels(payload));
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Chargement impossible');
      }
    }
    loadIndex();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    if (!catalogIndex) return undefined;
    let cancelled = false;
    let requestId = 0;

    const syncLocation = async () => {
      const currentRequest = ++requestId;
      const next = readViewParams();
      const hashToken = referenceTokenFromHash();
      const availableRoots = new Set([ALL_COLLECTIONS_ID, ...catalogEntries(catalogIndex).map((collection) => collection.id)]);
      const requestedRoot = availableRoots.has(next.root) ? next.root : '';

      try {
        const targetRoot = requestedRoot
          || await findRootForHashToken(catalogIndex, hashToken)
          || defaultRootId(catalogIndex);
        const payload = await loadCatalogForRoot(catalogIndex, targetRoot);
        if (cancelled || currentRequest !== requestId) return;
        activeRootRef.current = targetRoot;
        setActiveRoot(targetRoot);
        setCatalog(payload);
        setError('');
        setToolsOpen(false);
        setAboutOpen(false);
        setFocusReferenceKey('');
        setViewMode(next.view);
        setListSort(next.sort);
        setActiveCollection(next.collection);
        setQuery(next.query);
        setTypeFilter(next.type);
        setYearFilter(next.pubYear);
        setFeatureFilters(next.featureFilters);

        const reference = findReferenceByHashToken(payload.references || [], hashToken);
        setSelectedReference(reference || null);
        writeAppUrl({
          reference,
          state: {
            view: next.view,
            sort: next.sort,
            root: targetRoot,
            collection: next.collection,
            query: next.query,
            type: next.type,
            pubYear: next.pubYear,
            featureFilters: next.featureFilters,
          },
          defaultRoot: defaultRootId(catalogIndex),
          historyMode: 'replace',
          detailEntry: Boolean(reference && window.history.state?.zotscapeDetailEntry),
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Chargement impossible');
      }
    };

    syncLocation();
    window.addEventListener('popstate', syncLocation);
    window.addEventListener('hashchange', syncLocation);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('hashchange', syncLocation);
    };
  }, [catalogIndex]);

  const references = catalog?.references || [];
  const memoirs = catalog?.memoirs || [];
  const rootCollections = useMemo(() => collectionOptions(catalogIndex), [catalogIndex]);

  useEffect(() => {
    if (!catalog) return;
    const hashToken = referenceTokenFromHash();
    if (!hashToken) return;
    const reference = findReferenceByHashToken(references, hashToken);
    if (reference) setSelectedReference(reference);
  }, [catalog, references]);

  const filteredReferences = useMemo(() => {
    const search = normalize(query);
    return references.filter((reference) => {
      if (activeCollection && !reference.memoirKeys?.includes(activeCollection)) return false;
      if (typeFilter && reference.itemType !== typeFilter) return false;
      if (yearFilter && reference.year !== yearFilter) return false;
      if (search && !getSearchBlob(reference).includes(search)) return false;
      for (const feature of featureFilters) {
        if (!referenceMatchesFeature(reference, feature)) return false;
      }
      return true;
    });
  }, [activeCollection, featureFilters, query, references, typeFilter, yearFilter]);

  const recentKeys = useMemo(() => new Set(
    [...references]
      .sort(sortByRecent)
      .slice(0, RECENT_REFERENCE_COUNT)
      .map((reference) => reference.key),
  ), [references]);
  const sharedKeys = useMemo(() => new Set(
    references.filter((reference) => reference.memoirKeys?.length > 1).map((reference) => reference.key),
  ), [references]);
  const sharedOnly = featureFilters.has('shared');
  const physicalScale = Boolean(catalog?.physicalScale ?? catalogIndex?.physicalScale);
  const sortedListReferences = useMemo(
    () => sortListReferences(filteredReferences, listSort),
    [filteredReferences, listSort],
  );
  const packed = useMemo(
    () => packReferences(filteredReferences, viewport, recentKeys, sharedKeys, sharedOnly, measuredAssetRatios, physicalScale),
    [filteredReferences, measuredAssetRatios, physicalScale, recentKeys, sharedKeys, sharedOnly, viewport],
  );
  const visibleItems = packed.items;
  const layout = packed.layout || catalog?.layout || DEFAULT_LAYOUT;
  const visibleRecentItems = useMemo(
    () => visibleItems.filter(({ reference }) => recentKeys.has(reference.key)),
    [recentKeys, visibleItems],
  );
  const visibleSharedItems = useMemo(
    () => visibleItems.filter(({ reference }) => sharedKeys.has(reference.key)),
    [sharedKeys, visibleItems],
  );
  const focalItems = useMemo(
    () => sharedOnly
      ? visibleSharedItems
      : (visibleRecentItems.length ? visibleRecentItems : visibleItems.slice(0, RECENT_REFERENCE_COUNT)),
    [sharedOnly, visibleItems, visibleRecentItems, visibleSharedItems],
  );
  const focalBounds = useMemo(() => itemBounds(focalItems), [focalItems]);
  const fixedScale = useMemo(() => {
    const compact = viewport.width < 760;
    const preferredScale = compact ? 0.68 : 0.9;
    if (!focalBounds) return preferredScale;
    const availableWidth = viewport.width - (compact ? 36 : 96);
    const availableHeight = viewport.height - headerHeight(viewport) - (compact ? 40 : 72);
    const fitScale = Math.min(
      availableWidth / Math.max(1, focalBounds.width),
      availableHeight / Math.max(1, focalBounds.height),
    );
    return clamp(
      Math.min(preferredScale, fitScale),
      compact ? 0.28 : 0.5,
      preferredScale,
    );
  }, [focalBounds, viewport]);

  const activeReference = selectedReference || null;
  const relatedKeys = useMemo(() => {
    if (!activeReference) return new Set();
    return new Set(
      filteredReferences
        .filter((reference) => reference.key !== activeReference.key && sharesMemoir(activeReference, reference))
        .map((reference) => reference.key),
    );
  }, [activeReference, filteredReferences]);
  const allTypeOptions = useMemo(() => typeOptions(references), [references]);
  const allYearOptions = useMemo(() => yearOptions(references), [references]);
  const suggestions = useMemo(
    () => relatedReferences(selectedReference, references),
    [references, selectedReference],
  );
  const activeSubcollection = useMemo(
    () => memoirs.find((memoir) => memoir.key === activeCollection) || null,
    [activeCollection, memoirs],
  );
  const activeSubcollectionLabel = activeSubcollection ? collectionReaderLabel(activeSubcollection.name) : '';
  const toolCount = activeToolCount({ activeCollection, query, typeFilter, yearFilter, featureFilters });
  const focusItem = useMemo(
    () => visibleItems.find(({ reference }) => reference.key === focusReferenceKey) || null,
    [focusReferenceKey, visibleItems],
  );

  const currentUrlState = () => ({
    view: viewMode,
    sort: listSort,
    root: activeRoot,
    collection: activeCollection,
    query,
    type: typeFilter,
    pubYear: yearFilter,
    featureFilters,
  });

  useEffect(() => {
    if (!catalog || !catalogIndex || !activeRoot) return;
    writeAppUrl({
      reference: selectedReference,
      state: currentUrlState(),
      defaultRoot: defaultRootId(catalogIndex),
      historyMode: 'replace',
      detailEntry: Boolean(selectedReference && window.history.state?.zotscapeDetailEntry),
    });
  }, [activeCollection, activeRoot, catalog, catalogIndex, featureFilters, listSort, query, selectedReference, typeFilter, viewMode, yearFilter]);

  useEffect(() => {
    setTransformState((current) => ({ ...current, scale: fixedScale }));
  }, [fixedScale]);

  useEffect(() => {
    if (selectedReference && !filteredReferences.some((reference) => reference.key === selectedReference.key)) {
      setSelectedReference(null);
      writeAppUrl({
        reference: null,
        state: currentUrlState(),
        defaultRoot: defaultRootId(catalogIndex),
        historyMode: 'replace',
        detailEntry: false,
      });
    }
  }, [activeRoot, catalogIndex, filteredReferences, selectedReference]);

  useEffect(() => {
    if (viewMode !== 'atlas') return undefined;
    let frame = 0;
    let observer = null;
    const syncTransform = () => {
      const element = document.querySelector('.atlas-content');
      if (!element) return;
      const next = parseTransformState(element.style.transform || window.getComputedStyle(element).transform, transformState);
      setTransformState((current) => (
        current.scale === next.scale
        && current.positionX === next.positionX
        && current.positionY === next.positionY
          ? current
          : next
      ));
    };
    const attach = () => {
      const element = document.querySelector('.atlas-content');
      if (!element) {
        frame = window.requestAnimationFrame(attach);
        return;
      }
      syncTransform();
      observer = new MutationObserver(syncTransform);
      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    };
    frame = window.requestAnimationFrame(attach);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fixedScale, layout.height, layout.width, viewMode, visibleItems.length]);

  function resetTools() {
    setActiveCollection('');
    setQuery('');
    setTypeFilter('');
    setYearFilter('');
    setFeatureFilters(new Set());
  }

  function selectCollectionFilter(memoirKey) {
    if (!memoirKey) return;
    setActiveCollection(memoirKey);
    setToolsOpen(false);
    setAboutOpen(false);
    writeAppUrl({
      reference: selectedReference,
      state: { ...currentUrlState(), collection: memoirKey },
      defaultRoot: defaultRootId(catalogIndex),
      historyMode: 'replace',
      detailEntry: Boolean(selectedReference && window.history.state?.zotscapeDetailEntry),
    });
  }

  function recordAssetRatio(referenceKey, ratio) {
    if (!referenceKey || !Number.isFinite(ratio) || ratio <= 0) return;
    setMeasuredAssetRatios((current) => {
      const previous = Number(current.get(referenceKey) || 0);
      if (Math.abs(previous - ratio) < 0.01) return current;
      const next = new Map(current);
      next.set(referenceKey, ratio);
      return next;
    });
  }

  function changeViewMode(nextView) {
    if (!VIEW_MODES.has(nextView) || nextView === viewMode) return;
    setViewMode(nextView);
    writeAppUrl({
      reference: selectedReference,
      state: { ...currentUrlState(), view: nextView },
      defaultRoot: defaultRootId(catalogIndex),
      historyMode: selectedReference ? 'replace' : 'push',
      detailEntry: Boolean(selectedReference && window.history.state?.zotscapeDetailEntry),
    });
  }

  function changeListSort(nextSort) {
    if (!LIST_SORTS.has(nextSort) || nextSort === listSort) return;
    setListSort(nextSort);
    writeAppUrl({
      reference: selectedReference,
      state: { ...currentUrlState(), sort: nextSort },
      defaultRoot: defaultRootId(catalogIndex),
      historyMode: 'replace',
      detailEntry: Boolean(selectedReference && window.history.state?.zotscapeDetailEntry),
    });
  }

  async function changeCatalogRoot(nextRoot) {
    if (!catalogIndex || nextRoot === activeRoot) return;
    try {
      const payload = await loadCatalogForRoot(catalogIndex, nextRoot);
      resetTools();
      setCatalog(payload);
      setActiveRoot(nextRoot);
      activeRootRef.current = nextRoot;
      setSelectedReference(null);
      setFocusReferenceKey('');
      setToolsOpen(false);
      setAboutOpen(false);
      writeAppUrl({
        reference: null,
        state: {
          view: viewMode,
          sort: listSort,
          root: nextRoot,
          collection: '',
          query: '',
          type: '',
          pubYear: '',
          featureFilters: new Set(),
        },
        defaultRoot: defaultRootId(catalogIndex),
        historyMode: 'push',
        detailEntry: false,
      });
    } catch (loadError) {
      setError(loadError.message || 'Chargement impossible');
    }
  }

  function openReference(reference) {
    const replacing = Boolean(selectedReference);
    setSelectedReference(reference);
    writeAppUrl({
      reference,
      state: currentUrlState(),
      defaultRoot: defaultRootId(catalogIndex),
      historyMode: replacing ? 'replace' : 'push',
      detailEntry: replacing ? Boolean(window.history.state?.zotscapeDetailEntry) : true,
    });
  }

  function closeReference() {
    if (!selectedReference) return;
    setSelectedReference(null);
    if (window.history.state?.zotscapeDetailEntry) {
      window.history.back();
      return;
    }
    writeAppUrl({
      reference: null,
      state: currentUrlState(),
      defaultRoot: defaultRootId(catalogIndex),
      historyMode: 'replace',
      detailEntry: false,
    });
  }

  function openSearch() {
    setAboutOpen(false);
    setToolsOpen(true);
    setSearchFocusToken((value) => value + 1);
  }

  function openAbout() {
    setToolsOpen(false);
    setAboutOpen(true);
  }

  function discoverReference() {
    const candidates = filteredReferences.filter((reference) => reference.key !== selectedReference?.key);
    const pool = candidates.length ? candidates : filteredReferences;
    if (!pool.length) return;
    const reference = pool[Math.floor(Math.random() * pool.length)];
    setFocusReferenceKey(reference.key);
    openReference(reference);
    if (viewMode === 'list') {
      window.requestAnimationFrame(() => {
        document.getElementById(`reference-${reference.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  if (error) {
    return (
      <main className="app-shell app-shell--empty">
        <div className="empty-state">
          <Library size={30} aria-hidden="true" />
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!catalog || !catalogIndex) {
    return (
      <main className="app-shell app-shell--empty">
        <div className="empty-state">
          <Library size={30} aria-hidden="true" />
          <p>Chargement du catalogue...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="atlas-header">
        <div className="atlas-heading">
          <a className="brand-link" href={BASE_URL} aria-label="EnsadNancy">
            <Library size={17} aria-hidden="true" />
          </a>
          <div className="atlas-title">
            <CollectionSelector activeCollection={activeRoot} collections={rootCollections} onChange={changeCatalogRoot} />
            {activeSubcollectionLabel && (
              <p className="atlas-subtitle">Sous-collection · {activeSubcollectionLabel}</p>
            )}
            <p className="atlas-meta">
              {filteredReferences.length === catalog.stats.referenceCount
                ? `${catalog.stats.referenceCount} références`
                : `${filteredReferences.length} sur ${catalog.stats.referenceCount} références`}
              {' · '}{catalog.stats.memoirCount} collections
              {' · '}mis à jour le {formatUpdated(catalog.generatedAt)}
            </p>
          </div>
        </div>
        <div className="atlas-actions">
          <ViewSwitcher value={viewMode} onChange={changeViewMode} />
          <button className="header-icon-action" type="button" onClick={openSearch} aria-label="Rechercher" title="Rechercher">
            <Search size={18} aria-hidden="true" />
          </button>
          <button className="header-icon-action about-desktop-button" type="button" onClick={openAbout} aria-label="À propos" title="À propos">
            <Info size={18} aria-hidden="true" />
          </button>
          <button
            className="tools-toggle"
            type="button"
            onClick={() => {
              setAboutOpen(false);
              setToolsOpen((open) => !open);
            }}
            aria-label={toolsOpen ? 'Fermer les filtres' : 'Ouvrir les filtres'}
            aria-expanded={toolsOpen}
            aria-controls="filter-panel"
            title="Filtres"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span>Filtres</span>
            {toolCount > 0 && <em>{toolCount}</em>}
          </button>
        </div>
      </header>

      {filteredReferences.length ? (
        viewMode === 'atlas' ? (
          <TransformWrapper
            key={`${activeRoot}-${Math.round(fixedScale * 100)}-${layout.width}-${layout.height}-${filteredReferences.map((reference) => reference.key).join('-')}`}
            initialScale={fixedScale}
            minScale={fixedScale}
            maxScale={fixedScale}
            limitToBounds={false}
            wheel={{ disabled: true }}
            pinch={{ disabled: true }}
            doubleClick={{ disabled: true }}
            onTransformed={(_, state) => setTransformState(state)}
          >
            {({ setTransform }) => (
              <AtlasViewport focalItems={focalItems} focusItem={focusItem} viewport={viewport} scale={fixedScale} setTransform={setTransform}>
                {({ navigate }) => (
                  <>
                    <MiniMap
                      items={visibleItems}
                      layout={layout}
                      activeKey={activeReference?.key || ''}
                      transformState={transformState}
                      viewport={viewport}
                      onNavigate={navigate}
                    />
                    <TransformComponent wrapperClass="atlas-wrapper" contentClass="atlas-content">
                      <section className="atlas-surface" style={{ width: layout.width, height: layout.height }} aria-label="Table de références">
                        {visibleItems.map(({ reference, layout: itemLayout }) => (
                          <AtlasObject
                            key={reference.key}
                            reference={reference}
                            layout={itemLayout}
                            active={activeReference?.key === reference.key}
                            related={relatedKeys.has(reference.key)}
                            recent={recentKeys.has(reference.key)}
                            shared={sharedKeys.has(reference.key)}
                            onSelect={openReference}
                            onImageRatio={recordAssetRatio}
                          />
                        ))}
                      </section>
                    </TransformComponent>
                  </>
                )}
              </AtlasViewport>
            )}
          </TransformWrapper>
        ) : (
          <ReferenceList
            references={sortedListReferences}
            sort={listSort}
            onSortChange={changeListSort}
            recentKeys={recentKeys}
            sharedKeys={sharedKeys}
            selectedReference={selectedReference}
            onSelect={openReference}
            onDiscover={discoverReference}
          />
        )
      ) : (
        <EmptyState />
      )}

      <ToolPanel
        open={toolsOpen}
        memoirs={memoirs}
        activeCollection={activeCollection}
        setActiveCollection={setActiveCollection}
        query={query}
        setQuery={setQuery}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        yearFilter={yearFilter}
        setYearFilter={setYearFilter}
        featureFilters={featureFilters}
        setFeatureFilters={setFeatureFilters}
        allTypeOptions={allTypeOptions}
        allYearOptions={allYearOptions}
        referenceCount={references.length}
        searchFocusToken={searchFocusToken}
        onClose={() => setToolsOpen(false)}
        onOpenAbout={openAbout}
        onReset={resetTools}
      />

      <AboutPanel open={aboutOpen} catalog={catalog} onClose={() => setAboutOpen(false)} />

      <DetailPanel
        reference={selectedReference}
        suggestions={suggestions}
        onSelect={openReference}
        onCollectionSelect={selectCollectionFilter}
        onClose={closeReference}
        suspended={toolsOpen || aboutOpen}
      />
    </main>
  );
}
