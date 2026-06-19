import { useEffect, useMemo, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import {
  ArrowUpRight,
  BookOpen,
  Globe2,
  Highlighter,
  LayoutGrid,
  Library,
  List,
  LocateFixed,
  RotateCcw,
  Search,
  SlidersHorizontal,
  UsersRound,
  X,
} from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL || '/';
const DEFAULT_LAYOUT = { width: 1800, height: 1200 };
const RECENT_REFERENCE_COUNT = 6;
const VIEW_MODES = new Set(['atlas', 'list']);
const LIST_SORTS = new Set(['recent', 'title', 'author', 'year']);
const REFERENCE_KEY_PATTERN = /--([a-z0-9]{8})$/iu;

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

function readViewParams() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const sort = params.get('sort');
  return {
    view: VIEW_MODES.has(view) ? view : 'atlas',
    sort: LIST_SORTS.has(sort) ? sort : 'recent',
  };
}

function writeViewParams(view, sort, historyMode = 'replace') {
  const url = new URL(window.location.href);
  if (view === 'list') {
    url.searchParams.set('view', 'list');
    if (sort === 'recent') url.searchParams.delete('sort');
    else url.searchParams.set('sort', sort);
  } else {
    url.searchParams.delete('view');
    url.searchParams.delete('sort');
  }
  window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](
    { ...(window.history.state || {}) },
    '',
    url,
  );
}

function referenceSlug(reference) {
  return normalize(reference?.title || 'reference')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72)
    .replace(/-+$/gu, '') || 'reference';
}

function referenceHash(reference) {
  if (!reference?.key) return '';
  return `#${referenceSlug(reference)}--${String(reference.key).toUpperCase()}`;
}

function referenceKeyFromHash(hash = window.location.hash) {
  let decoded = String(hash || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // An invalid user-edited hash is handled like an unknown reference.
  }
  return decoded.match(REFERENCE_KEY_PATTERN)?.[1]?.toUpperCase() || '';
}

function writeReferenceHash(reference, historyMode = 'replace', detailEntry = false) {
  const url = new URL(window.location.href);
  url.hash = reference ? referenceHash(reference) : '';
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
    reference.typeLabel || reference.itemType,
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

function activeToolCount({ activeMemoir, query, typeFilter, yearFilter, featureFilters }) {
  return [
    activeMemoir,
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
  if (reference.itemType === 'webpage' || reference.itemType === 'blogPost') return 'web';
  if (reference.itemType === 'journalArticle' || reference.itemType === 'newspaperArticle') return 'article';
  if (reference.itemType === 'thesis') return 'thesis';
  return 'document';
}

function memoirDisplay(name = '') {
  const [person, ...topicParts] = String(name).split(/\s+—\s+/u);
  const topic = topicParts.join(' — ').trim();
  if (topic) return { primary: topic, secondary: `Mémoire de ${person}` };
  return { primary: 'Mémoire en cours', secondary: person };
}

function memoirReaderLabel(name = '') {
  const display = memoirDisplay(name);
  return display.primary === 'Mémoire en cours'
    ? `${display.primary} · ${display.secondary}`
    : display.primary;
}

function objectDimensions(reference, featured = false) {
  const type = supportType(reference);
  const assetKind = reference.asset?.kind || 'fallback';
  const shared = reference.memoirKeys?.length > 1;
  const seed = hashValue(reference.key || reference.title);
  const scale = (shared ? 1.04 : 1) * ([0.96, 1, 1.04][seed % 3]) * (featured ? 1.1 : 1);
  const captionHeight = featured ? 98 : 80;
  const gap = 10;
  if (assetKind === 'cover' && ['book', 'chapter', 'thesis'].includes(type)) {
    const ratio = clamp(Number(reference.asset?.ratio || 0.66), 0.42, 0.9);
    const mediaHeightBase = {
      book: shared ? 372 : 346,
      chapter: shared ? 336 : 312,
      thesis: shared ? 370 : 344,
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
  if (type === 'thesis') return 'Consulter le mémoire';
  if (type === 'book' || type === 'chapter') return 'Consulter le livre';
  return 'Consulter la ressource';
}

function packReferences(references, viewport, recentKeys) {
  const compact = viewport.width < 760;
  const margin = compact ? 64 : 104;
  const tableWidth = clamp(
    viewport.width * (compact ? 3.25 : 1.52),
    compact ? 1260 : 1900,
    compact ? 1520 : 2300,
  );
  const tableBaseHeight = compact ? 2580 : 2280;
  const anchors = [
    [0.06, 0.06], [0.22, 0.03], [0.78, 0.05], [0.88, 0.18],
    [0.05, 0.24], [0.19, 0.30], [0.83, 0.35], [0.91, 0.50],
    [0.04, 0.46], [0.18, 0.52], [0.32, 0.59], [0.51, 0.61],
    [0.72, 0.60], [0.86, 0.67], [0.07, 0.68], [0.23, 0.75],
    [0.43, 0.76], [0.63, 0.78], [0.81, 0.82], [0.12, 0.89],
    [0.34, 0.92], [0.57, 0.91], [0.78, 0.94], [0.94, 0.74],
    [0.50, 0.02], [0.02, 0.82], [0.94, 0.31],
  ];
  const placedLayouts = [];
  const orderedReferences = [...references].sort((left, right) => {
    const recentDifference = Number(recentKeys.has(right.key)) - Number(recentKeys.has(left.key));
    if (recentDifference) return recentDifference;
    return sortByRecent(left, right);
  });
  const visibleRecent = orderedReferences.filter((reference) => recentKeys.has(reference.key));
  const featuredReferences = visibleRecent.length
    ? visibleRecent
    : orderedReferences.slice(0, RECENT_REFERENCE_COUNT);
  const featuredKeys = new Set(featuredReferences.map((reference) => reference.key));
  const layoutsByKey = new Map();
  const collides = (layout) => placedLayouts.some((placed) => (
    layout.x < placed.x + placed.width + 42
    && layout.x + layout.width + 42 > placed.x
    && layout.y < placed.y + placed.height + 42
    && layout.y + layout.height + 42 > placed.y
  ));

  const columns = Math.min(3, Math.max(1, featuredReferences.length));
  const horizontalGap = compact ? 54 : 72;
  const verticalGap = compact ? 64 : 76;
  let featuredY = compact ? 260 : 250;
  for (let rowStart = 0; rowStart < featuredReferences.length; rowStart += columns) {
    const row = featuredReferences.slice(rowStart, rowStart + columns).map((reference) => ({
      reference,
      size: objectDimensions(reference, true),
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

  const regularReferences = orderedReferences.filter((reference) => !featuredKeys.has(reference.key));
  regularReferences.forEach((reference, index) => {
    const size = objectDimensions(reference, false);
    const seed = hashValue(`${reference.key}:${index}`);
    const anchor = anchors[index % anchors.length];
    const panel = Math.floor(index / anchors.length);
    const jitterX = Math.round((((seed % 100) / 100) - 0.5) * (compact ? 54 : 82));
    const jitterY = Math.round(((((seed >> 8) % 100) / 100) - 0.5) * (compact ? 48 : 76));
    const panelOffset = panel * tableBaseHeight;
    const layout = {
      index: featuredReferences.length + index + 1,
      x: clamp(
        Math.round(margin + anchor[0] * (tableWidth - margin * 2 - size.width) + jitterX),
        margin,
        Math.max(margin, tableWidth - margin - size.width),
      ),
      y: Math.max(margin, Math.round(margin + panelOffset + anchor[1] * tableBaseHeight + jitterY)),
      width: size.width,
      height: size.height,
      mediaHeight: size.mediaHeight,
      captionHeight: size.captionHeight,
      rotation: 0,
      layer: reference.memoirKeys?.length > 1 ? 3 : 1,
      featured: false,
    };
    let guard = 0;
    const shifts = [
      [0, 0], [54, 34], [-58, 42], [92, 82], [-98, 92], [18, 138],
      [132, 142], [-138, 154], [0, 214], [74, 250], [-80, 268],
    ];
    while (collides(layout) && guard < 120) {
      const shift = shifts[guard % shifts.length];
      const pass = Math.floor(guard / shifts.length);
      layout.x = clamp(
        Math.round(margin + anchor[0] * (tableWidth - margin * 2 - size.width) + jitterX + shift[0]),
        margin,
        Math.max(margin, tableWidth - margin - size.width),
      );
      layout.y = Math.max(margin, Math.round(margin + panelOffset + anchor[1] * tableBaseHeight + jitterY + shift[1] + pass * 96));
      guard += 1;
    }
    if (collides(layout)) {
      layout.y = Math.max(...placedLayouts.map((placed) => placed.y + placed.height)) + 56;
    }
    placedLayouts.push(layout);
    layoutsByKey.set(reference.key, layout);
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


function fallbackPalette(reference) {
  const [paper, ink, accent] = FALLBACK_PALETTES[hashValue(reference.key || reference.title) % FALLBACK_PALETTES.length];
  return {
    '--fallback-paper': paper,
    '--fallback-ink': ink,
    '--fallback-accent': accent,
  };
}

function ReferenceVisual({ reference, detail = false }) {
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  if (assetKind === 'fallback') {
    return (
      <span
        className={`dom-fallback dom-fallback--${type}${detail ? ' dom-fallback--detail' : ''}`}
        style={fallbackPalette(reference)}
      >
        <span className="dom-fallback-kicker">{reference.typeLabel}</span>
        <strong>{reference.title}</strong>
        {reference.creatorsLabel && <span className="dom-fallback-authors">{reference.creatorsLabel}</span>}
        <em>{reference.year || 's. d.'}</em>
      </span>
    );
  }
  if (!reference.asset?.src) return null;
  return <img src={assetUrl(reference.asset.src)} alt="" loading={detail ? 'eager' : 'lazy'} />;
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

function ListVisual({ reference }) {
  if (reference.asset?.kind === 'fallback') {
    return (
      <span className={`list-fallback list-fallback--${supportType(reference)}`} style={fallbackPalette(reference)}>
        <span>{reference.typeLabel}</span>
      </span>
    );
  }
  if (!reference.asset?.src) return null;
  return <img src={assetUrl(reference.asset.src)} alt="" loading="lazy" />;
}

function ReferenceListRow({ reference, active, onSelect }) {
  const annotationCount = reference.annotations?.count || 0;
  const noteCount = reference.notes?.length || 0;
  const context = [
    reference.typeLabel,
    reference.year,
    ...(reference.memoirNames || []).map(memoirReaderLabel),
    annotationCount > 0 ? `${annotationCount} surligne${annotationCount > 1 ? 's' : ''}` : '',
    noteCount > 0 ? `${noteCount} note${noteCount > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return (
    <li className={`reference-list-item${active ? ' is-active' : ''}`}>
      <button
        className="reference-list-row"
        type="button"
        onClick={() => onSelect(reference)}
        aria-label={`${reference.title}, ${reference.creatorsLabel}`}
      >
        <span className={`reference-list-visual reference-list-visual--${supportType(reference)}`}>
          <ListVisual reference={reference} />
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

function ReferenceList({ references, sort, onSortChange, recentKeys, selectedReference, onSelect }) {
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
        <label>
          <span>Trier par</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
            <option value="recent">Ajouts récents</option>
            <option value="title">Titre</option>
            <option value="author">Auteur</option>
            <option value="year">Année</option>
          </select>
        </label>
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
  activeMemoir,
  setActiveMemoir,
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
  onClose,
  onReset,
}) {
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

        <label className="tool-field tool-field--search">
          <span><Search size={16} aria-hidden="true" />Recherche</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titre, auteur, sujet..." />
        </label>

        <fieldset className="memoir-filter">
          <legend>Mémoires</legend>
          <div className="memoir-filter-list">
            <button className={!activeMemoir ? 'is-active' : ''} type="button" onClick={() => setActiveMemoir('')} aria-pressed={!activeMemoir}>
              <span><strong>Toutes les références</strong><small>Collection en constitution</small></span>
              <em>{referenceCount}</em>
            </button>
            {memoirs.map((memoir) => {
              const display = memoirDisplay(memoir.name);
              return (
                <button
                  className={activeMemoir === memoir.key ? 'is-active' : ''}
                  key={memoir.key}
                  type="button"
                  onClick={() => setActiveMemoir(memoir.key)}
                  aria-pressed={activeMemoir === memoir.key}
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
          <FeatureToggle active={featureFilters.has('shared')} icon={UsersRound} label="Références communes" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'shared'))} />
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
      </aside>
    </>
  );
}

function AtlasObject({ reference, layout, active, related, recent, onSelect, onHover }) {
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  const transform = `translate(${layout.x}px, ${layout.y}px)`;

  return (
    <article
      className={`atlas-object atlas-object--${assetKind} atlas-object--${type}${active ? ' is-active' : ''}${related ? ' is-related' : ''}${recent ? ' is-recent' : ''}`}
      style={{
        width: layout.width,
        height: layout.height,
        '--media-height': `${layout.mediaHeight}px`,
        '--caption-height': `${layout.captionHeight}px`,
        transform,
        zIndex: active ? 10 : layout.layer || 1,
      }}
      onMouseEnter={() => onHover(reference.key)}
      onMouseLeave={() => onHover('')}
    >
      <button
        className="atlas-object-main"
        type="button"
        onClick={() => onSelect(reference)}
        aria-label={`${reference.title}, ${reference.creatorsLabel}`}
      >
        <span className="object-media">
          <ReferenceVisual reference={reference} />
        </span>
      </button>
      <div className="object-caption">
        <p>{reference.title}</p>
        <span>{reference.creatorsLabel}</span>
      </div>
    </article>
  );
}

function AtlasViewport({ focalItems, viewport, scale, setTransform, children }) {
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

  const recenter = () => {
    if (target) setTransform(target.x, target.y, scale, 260, 'easeOut');
  };
  const navigate = (x, y) => {
    const next = transformForPoint({ x, y }, viewport, scale);
    setTransform(next.x, next.y, scale, 220, 'easeOut');
  };

  return children({ navigate, recenter });
}

function MiniMap({ items, layout, activeKey, transformState, viewport, onNavigate, onRecenter }) {
  const compact = viewport.width < 760;
  const width = compact ? 96 : 150;
  const height = compact ? 68 : 105;
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
      <button className="mini-map-recenter" type="button" onClick={onRecenter} aria-label="Recentrer sur les derniers ajouts" title="Recentrer">
        <LocateFixed size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

function DetailPanel({ reference, suggestions, onSelect, onClose, suspended }) {
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
  const canEmbed = Boolean(embedSrc || embedHtml);
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
                sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
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
            <p>Mobilisé dans</p>
            <div className="detail-rubrics">
              {(reference.memoirNames || []).map((name) => <span key={name}>{memoirReaderLabel(name)}</span>)}
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
            <a href={href} target="_blank" rel="noreferrer">
              <ArrowUpRight size={16} />
              <span>{sourceActionLabel(reference)}</span>
            </a>
          )}
          {reference.zoteroUrl && (
            <a href={reference.zoteroUrl} target="_blank" rel="noreferrer">
              <Library size={16} />
              <span>Zotero</span>
            </a>
          )}
          {reference.archive?.url && (
            <a href={reference.archive.url} target="_blank" rel="noreferrer">
              <Globe2 size={16} />
              <span>Archive web</span>
            </a>
          )}
        </div>

        {suggestions.length > 0 && (
          <section className="detail-suggestions">
            <h3>Dans le même mémoire</h3>
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
            <dt>Type</dt><dd>{reference.typeLabel}</dd>
            {reference.year && <><dt>Année</dt><dd>{reference.year}</dd></>}
            {reference.publisher && <><dt>Édition</dt><dd>{reference.publisher}</dd></>}
            {reference.publicationTitle && <><dt>Revue</dt><dd>{reference.publicationTitle}</dd></>}
            {reference.bookTitle && <><dt>Dans</dt><dd>{reference.bookTitle}</dd></>}
            {reference.isbn && <><dt>ISBN</dt><dd>{reference.isbn}</dd></>}
            {reference.doi && <><dt>DOI</dt><dd>{reference.doi}</dd></>}
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

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [activeMemoir, setActiveMemoir] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [featureFilters, setFeatureFilters] = useState(new Set());
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState(null);
  const [viewMode, setViewMode] = useState(() => readViewParams().view);
  const [listSort, setListSort] = useState(() => readViewParams().sort);
  const [hoveredKey, setHoveredKey] = useState('');
  const [transformState, setTransformState] = useState({ scale: 1, positionX: 0, positionY: 0 });
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_URL}data/catalog.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`catalog.json ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setCatalog(payload);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Chargement impossible');
      });
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

  const references = catalog?.references || [];
  const memoirs = catalog?.memoirs || [];

  useEffect(() => {
    const syncLocation = () => {
      const next = readViewParams();
      setViewMode(next.view);
      setListSort(next.sort);
      setHoveredKey('');

      const key = referenceKeyFromHash();
      if (!key) {
        setSelectedReference(null);
        return;
      }
      if (!references.length) return;
      const reference = references.find((candidate) => candidate.key.toUpperCase() === key);
      if (!reference) {
        setSelectedReference(null);
        writeReferenceHash(null, 'replace', false);
        return;
      }
      setSelectedReference(reference);
      if (window.location.hash !== referenceHash(reference)) {
        writeReferenceHash(
          reference,
          'replace',
          Boolean(window.history.state?.zotscapeDetailEntry),
        );
      }
    };

    const current = readViewParams();
    writeViewParams(current.view, current.sort, 'replace');
    syncLocation();
    window.addEventListener('popstate', syncLocation);
    window.addEventListener('hashchange', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('hashchange', syncLocation);
    };
  }, [references]);

  const filteredReferences = useMemo(() => {
    const search = normalize(query);
    return references.filter((reference) => {
      if (activeMemoir && !reference.memoirKeys?.includes(activeMemoir)) return false;
      if (typeFilter && reference.itemType !== typeFilter) return false;
      if (yearFilter && reference.year !== yearFilter) return false;
      if (search && !getSearchBlob(reference).includes(search)) return false;
      for (const feature of featureFilters) {
        if (!referenceMatchesFeature(reference, feature)) return false;
      }
      return true;
    });
  }, [activeMemoir, featureFilters, query, references, typeFilter, yearFilter]);

  const recentKeys = useMemo(() => new Set(
    [...references]
      .sort(sortByRecent)
      .slice(0, RECENT_REFERENCE_COUNT)
      .map((reference) => reference.key),
  ), [references]);
  const sortedListReferences = useMemo(
    () => sortListReferences(filteredReferences, listSort),
    [filteredReferences, listSort],
  );
  const packed = useMemo(
    () => packReferences(filteredReferences, viewport, recentKeys),
    [filteredReferences, recentKeys, viewport],
  );
  const visibleItems = packed.items;
  const layout = packed.layout || catalog?.layout || DEFAULT_LAYOUT;
  const visibleRecentItems = useMemo(
    () => visibleItems.filter(({ reference }) => recentKeys.has(reference.key)),
    [recentKeys, visibleItems],
  );
  const focalItems = useMemo(
    () => visibleRecentItems.length ? visibleRecentItems : visibleItems.slice(0, RECENT_REFERENCE_COUNT),
    [visibleItems, visibleRecentItems],
  );
  const focalBounds = useMemo(() => itemBounds(focalItems), [focalItems]);
  const recentBounds = useMemo(() => itemBounds(visibleRecentItems), [visibleRecentItems]);
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

  const activeReference = selectedReference || references.find((reference) => reference.key === hoveredKey) || null;
  const relatedKeys = useMemo(() => new Set(selectedReference
    ? filteredReferences.filter((reference) => reference.key !== selectedReference.key && sharesMemoir(selectedReference, reference)).map((reference) => reference.key)
    : []), [filteredReferences, selectedReference]);
  const allTypeOptions = useMemo(() => typeOptions(references), [references]);
  const allYearOptions = useMemo(() => yearOptions(references), [references]);
  const suggestions = useMemo(
    () => relatedReferences(selectedReference, references),
    [references, selectedReference],
  );
  const toolCount = activeToolCount({ activeMemoir, query, typeFilter, yearFilter, featureFilters });

  useEffect(() => {
    setTransformState((current) => ({
      ...current,
      scale: fixedScale,
    }));
  }, [fixedScale]);

  useEffect(() => {
    if (selectedReference && !filteredReferences.some((reference) => reference.key === selectedReference.key)) {
      setSelectedReference(null);
      writeReferenceHash(null, 'replace', false);
    }
  }, [filteredReferences, selectedReference]);

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

  function changeViewMode(nextView) {
    if (!VIEW_MODES.has(nextView) || nextView === viewMode) return;
    setViewMode(nextView);
    setHoveredKey('');
    writeViewParams(nextView, listSort, selectedReference ? 'replace' : 'push');
  }

  function changeListSort(nextSort) {
    if (!LIST_SORTS.has(nextSort) || nextSort === listSort) return;
    setListSort(nextSort);
    writeViewParams(viewMode, nextSort, 'replace');
  }

  function resetTools() {
    setActiveMemoir('');
    setQuery('');
    setTypeFilter('');
    setYearFilter('');
    setFeatureFilters(new Set());
  }

  function openReference(reference) {
    const replacing = Boolean(selectedReference);
    setSelectedReference(reference);
    writeReferenceHash(
      reference,
      replacing ? 'replace' : 'push',
      replacing ? Boolean(window.history.state?.zotscapeDetailEntry) : true,
    );
  }

  function closeReference() {
    if (!selectedReference) return;
    setSelectedReference(null);
    if (window.history.state?.zotscapeDetailEntry) {
      window.history.back();
      return;
    }
    writeReferenceHash(null, 'replace', false);
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

  if (!catalog) {
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
          <a className="brand-link" href={catalog.source.groupUrl} target="_blank" rel="noreferrer">
            <Library size={17} aria-hidden="true" />
            <span>EnsadNancy</span>
          </a>
          <div className="atlas-title">
            <h1>{catalog.source.rootCollectionName}</h1>
            <p>
              {filteredReferences.length === catalog.stats.referenceCount
                ? `${catalog.stats.referenceCount} références`
                : `${filteredReferences.length} sur ${catalog.stats.referenceCount} références`}
              {' · '}{catalog.stats.memoirCount} mémoires en cours
              {' · '}mis à jour le {formatUpdated(catalog.generatedAt)}
            </p>
          </div>
        </div>
        <div className="atlas-actions">
          <ViewSwitcher value={viewMode} onChange={changeViewMode} />
          <button
            className="tools-toggle"
            type="button"
            onClick={() => setToolsOpen((open) => !open)}
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
            key={`${Math.round(fixedScale * 100)}-${layout.width}-${layout.height}-${filteredReferences.map((reference) => reference.key).join('-')}`}
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
              <AtlasViewport focalItems={focalItems} viewport={viewport} scale={fixedScale} setTransform={setTransform}>
                {({ navigate, recenter }) => (
                  <>
                    <MiniMap
                      items={visibleItems}
                      layout={layout}
                      activeKey={activeReference?.key || ''}
                      transformState={transformState}
                      viewport={viewport}
                      onNavigate={navigate}
                      onRecenter={recenter}
                    />
                    <TransformComponent wrapperClass="atlas-wrapper" contentClass="atlas-content">
                      <section className="atlas-surface" style={{ width: layout.width, height: layout.height }} aria-label="Table de références">
                        {recentBounds && (
                          <p
                            className="atlas-recent-label"
                            style={{ transform: `translate(${recentBounds.left}px, ${Math.max(18, recentBounds.top - 38)}px)` }}
                          >
                            Derniers ajouts
                          </p>
                        )}
                        {visibleItems.map(({ reference, layout: itemLayout }) => (
                          <AtlasObject
                            key={reference.key}
                            reference={reference}
                            layout={itemLayout}
                            active={activeReference?.key === reference.key}
                            related={relatedKeys.has(reference.key)}
                            recent={recentKeys.has(reference.key)}
                            onSelect={openReference}
                            onHover={setHoveredKey}
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
            selectedReference={selectedReference}
            onSelect={openReference}
          />
        )
      ) : (
        <EmptyState />
      )}

      <ToolPanel
        open={toolsOpen}
        memoirs={memoirs}
        activeMemoir={activeMemoir}
        setActiveMemoir={setActiveMemoir}
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
        onClose={() => setToolsOpen(false)}
        onReset={resetTools}
      />

      <DetailPanel
        reference={selectedReference}
        suggestions={suggestions}
        onSelect={openReference}
        onClose={closeReference}
        suspended={toolsOpen}
      />
    </main>
  );
}
