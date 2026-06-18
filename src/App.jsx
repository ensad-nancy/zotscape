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
  window.history[historyMode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
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
    [0.38, 0.19], [0.53, 0.14], [0.66, 0.25],
    [0.35, 0.39], [0.52, 0.42], [0.68, 0.45],
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
  const collides = (layout) => placedLayouts.some((placed) => (
    layout.x < placed.x + placed.width + 42
    && layout.x + layout.width + 42 > placed.x
    && layout.y < placed.y + placed.height + 42
    && layout.y + layout.height + 42 > placed.y
  ));
  const items = orderedReferences.map((reference, index) => {
    const featured = recentKeys.has(reference.key);
    const size = objectDimensions(reference, featured);
    const seed = hashValue(`${reference.key}:${index}`);
    const anchor = anchors[index % anchors.length];
    const panel = Math.floor(index / anchors.length);
    const jitterX = Math.round((((seed % 100) / 100) - 0.5) * (featured ? 34 : compact ? 54 : 82));
    const jitterY = Math.round(((((seed >> 8) % 100) / 100) - 0.5) * (featured ? 32 : compact ? 48 : 76));
    const panelOffset = panel * tableBaseHeight;
    const layout = {
      index: index + 1,
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
      layer: featured ? 4 : reference.memoirKeys?.length > 1 ? 3 : 1,
      featured,
    };
    let guard = 0;
    const shifts = [
      [0, 0], [54, 34], [-58, 42], [92, 82], [-98, 92], [18, 138],
      [132, 142], [-138, 154], [0, 214], [74, 250], [-80, 268],
    ];
    while (collides(layout) && guard < 80) {
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
    placedLayouts.push(layout);
    return { reference, layout };
  });
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    for (let index = 0; index < placedLayouts.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < placedLayouts.length; nextIndex += 1) {
        const current = placedLayouts[index];
        const next = placedLayouts[nextIndex];
        const overlaps = current.x < next.x + next.width + 42
          && current.x + current.width + 42 > next.x
          && current.y < next.y + next.height + 42
          && current.y + current.height + 42 > next.y;
        if (overlaps) {
          const lower = current.y <= next.y ? next : current;
          const upper = lower === next ? current : next;
          lower.y = upper.y + upper.height + 46;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
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
  return reference.url || reference.doiUrl || reference.zoteroUrl;
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

function ReferenceListRow({ reference, active, recent, onSelect }) {
  const annotationCount = reference.annotations?.count || 0;
  const noteCount = reference.notes?.length || 0;
  return (
    <li className={`reference-list-item${active ? ' is-active' : ''}${recent ? ' is-recent' : ''}`}>
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
            {recent && <em>Ajout récent</em>}
          </span>
          <span className="reference-list-author">{reference.creatorsLabel}</span>
          <span className="reference-list-meta">
            <span>{reference.typeLabel}{reference.year ? ` · ${reference.year}` : ''}</span>
            {annotationCount > 0 && <span>{annotationCount} surligne{annotationCount > 1 ? 's' : ''}</span>}
            {noteCount > 0 && <span>{noteCount} note{noteCount > 1 ? 's' : ''}</span>}
          </span>
          {(reference.memoirNames || []).length > 0 && (
            <span className="reference-list-memoirs">
              {(reference.memoirNames || []).map((name) => <span key={name}>{name}</span>)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function ReferenceList({ references, sort, onSortChange, recentKeys, selectedReference, onSelect }) {
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
      <ol className="reference-list">
        {references.map((reference) => (
          <ReferenceListRow
            key={reference.key}
            reference={reference}
            active={selectedReference?.key === reference.key}
            recent={recentKeys.has(reference.key)}
            onSelect={onSelect}
          />
        ))}
      </ol>
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
      <aside className={`tool-panel${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Filtres">
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

        <label className="tool-field">
          <span>Mémoire</span>
          <select value={activeMemoir} onChange={(event) => setActiveMemoir(event.target.value)}>
            <option value="">Tous</option>
            {memoirs.map((memoir) => (
              <option key={memoir.key} value={memoir.key}>
                {memoir.name} ({memoir.referenceCount})
              </option>
            ))}
          </select>
        </label>

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
        {recent && <em>Ajout récent</em>}
      </div>
    </article>
  );
}

function MiniMap({ items, layout, activeKey, transformState, viewport }) {
  const compact = viewport.width < 760;
  const width = compact ? 96 : 150;
  const height = compact ? 68 : 105;
  const scaleX = width / layout.width;
  const scaleY = height / layout.height;
  const rawView = transformState?.scale
    ? {
      x: (-transformState.positionX / transformState.scale) * scaleX,
      y: (-transformState.positionY / transformState.scale) * scaleY,
      width: (viewport.width / transformState.scale) * scaleX,
      height: (viewport.height / transformState.scale) * scaleY,
    }
    : null;
  const view = rawView && {
    x: clamp(rawView.x, 0, Math.max(0, width - Math.min(width, rawView.width))),
    y: clamp(rawView.y, 0, Math.max(0, height - Math.min(height, rawView.height))),
    width: Math.min(width, rawView.width),
    height: Math.min(height, rawView.height),
  };

  return (
    <aside className="mini-map" aria-label="Plan de la table">
      <div className="mini-map-board" style={{ width, height }}>
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
      </div>
    </aside>
  );
}

function DetailPanel({ reference, onClose }) {
  useEffect(() => {
    if (!reference) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, reference]);

  if (!reference) return null;
  const href = sourceHref(reference);
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  const embedSrc = reference.embed?.src || (type === 'web' && href ? href : '');
  const embedHtml = embedSrc ? '' : reference.embed?.html || '';
  const canEmbed = Boolean(embedSrc || embedHtml);
  const siteEmbed = canEmbed && type === 'web';

  return (
    <aside className="detail-panel" role="dialog" aria-modal="false" aria-label={reference.title}>
      <div className="detail-panel-head">
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

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

      <div className="detail-body">
        <h2>{reference.title}</h2>
        <p className="detail-authors">{reference.creatorsLabel}</p>

        {reference.abstract && <p className="detail-abstract">{reference.abstract}</p>}

        {(reference.memoirNames || []).length > 0 && (
          <section className="detail-collections">
            <p>Mobilisé dans</p>
            <div className="detail-rubrics">
              {(reference.memoirNames || []).map((name) => <span key={name}>{name}</span>)}
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
              <span>Source</span>
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

  useEffect(() => {
    const current = readViewParams();
    writeViewParams(current.view, current.sort, 'replace');
    const handlePopState = () => {
      const next = readViewParams();
      setViewMode(next.view);
      setListSort(next.sort);
      setHoveredKey('');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const references = catalog?.references || [];
  const memoirs = catalog?.memoirs || [];

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
  const fixedScale = useMemo(() => {
    const chromeX = viewport.width < 760 ? 32 : 84;
    return clamp(
      ((viewport.width - chromeX) / layout.width) * 1.08,
      viewport.width < 760 ? 0.68 : 0.84,
      viewport.width < 760 ? 0.9 : 1,
    );
  }, [layout.width, viewport.width]);

  const activeReference = selectedReference || references.find((reference) => reference.key === hoveredKey) || null;
  const relatedKeys = useMemo(() => new Set(selectedReference
    ? filteredReferences.filter((reference) => reference.key !== selectedReference.key && sharesMemoir(selectedReference, reference)).map((reference) => reference.key)
    : []), [filteredReferences, selectedReference]);
  const allTypeOptions = useMemo(() => typeOptions(references), [references]);
  const allYearOptions = useMemo(() => yearOptions(references), [references]);
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
    writeViewParams(nextView, listSort, 'push');
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
          <button className="tools-toggle" type="button" onClick={() => setToolsOpen(true)}>
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
            centerOnInit
            limitToBounds={false}
            wheel={{ disabled: true }}
            pinch={{ disabled: true }}
            doubleClick={{ disabled: true }}
            onTransformed={(_, state) => setTransformState(state)}
          >
            {() => (
              <>
                <MiniMap items={visibleItems} layout={layout} activeKey={activeReference?.key || ''} transformState={transformState} viewport={viewport} />
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
                        onSelect={setSelectedReference}
                        onHover={setHoveredKey}
                      />
                    ))}
                  </section>
                </TransformComponent>
              </>
            )}
          </TransformWrapper>
        ) : (
          <ReferenceList
            references={sortedListReferences}
            sort={listSort}
            onSortChange={changeListSort}
            recentKeys={recentKeys}
            selectedReference={selectedReference}
            onSelect={setSelectedReference}
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
        onClose={() => setToolsOpen(false)}
        onReset={resetTools}
      />

      <DetailPanel reference={selectedReference} onClose={() => setSelectedReference(null)} />
    </main>
  );
}
