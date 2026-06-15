import { useEffect, useMemo, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  FileText,
  Globe2,
  Highlighter,
  Library,
  Link2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  UsersRound,
  X,
} from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL || '/';
const DEFAULT_LAYOUT = { width: 1800, height: 1200 };

const ASSET_LABELS = {
  archive: 'Archive web',
  cover: 'Couverture',
  fallback: 'Objet composé',
  oembed: 'Média intégré',
  'open-graph': 'Image du site',
  'pdf-screenshot': 'PDF public',
  screenshot: 'Capture',
};

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
  if (feature === 'pdf') return reference.attachments?.hasPdf;
  if (feature === 'url') return Boolean(reference.url || reference.doiUrl);
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

function objectDimensions(reference) {
  const type = supportType(reference);
  const shared = reference.memoirKeys?.length > 1;
  const seed = hashValue(reference.key || reference.title);
  const scale = (shared ? 1.04 : 1) * ([0.96, 1, 1.04][seed % 3]);
  const captionHeight = 66;
  const gap = 12;
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

function packReferences(references, viewport) {
  const compact = viewport.width < 760;
  const margin = compact ? 72 : 110;
  const tableWidth = clamp(
    viewport.width * (compact ? 2.55 : 1.42),
    compact ? 1120 : 1840,
    compact ? 1440 : 2240,
  );
  const panelHeight = compact ? 1580 : 1680;
  const anchors = [
    [0.08, 0.08], [0.23, 0.02], [0.39, 0.10], [0.58, 0.08], [0.78, 0.15],
    [0.03, 0.26], [0.22, 0.27], [0.43, 0.30], [0.66, 0.28], [0.82, 0.35],
    [0.12, 0.46], [0.33, 0.43], [0.53, 0.49], [0.74, 0.50],
    [0.05, 0.66], [0.24, 0.63], [0.46, 0.70], [0.67, 0.65], [0.84, 0.74],
    [0.18, 0.84], [0.40, 0.88], [0.61, 0.82], [0.79, 0.90],
  ];
  const placedLayouts = [];
  const collides = (layout) => placedLayouts.some((placed) => (
    layout.x < placed.x + placed.width + 34
    && layout.x + layout.width + 34 > placed.x
    && layout.y < placed.y + placed.height + 34
    && layout.y + layout.height + 34 > placed.y
  ));
  const items = references.map((reference, index) => {
    const size = objectDimensions(reference);
    const seed = hashValue(`${reference.key}:${index}`);
    const anchor = anchors[index % anchors.length];
    const panel = Math.floor(index / anchors.length);
    const jitterX = Math.round((((seed % 100) / 100) - 0.5) * (compact ? 58 : 92));
    const jitterY = Math.round(((((seed >> 8) % 100) / 100) - 0.5) * (compact ? 52 : 86));
    const layout = {
      index: index + 1,
      x: clamp(
        Math.round(margin + anchor[0] * (tableWidth - margin * 2 - size.width) + jitterX),
        margin,
        Math.max(margin, tableWidth - margin - size.width),
      ),
      y: Math.max(margin, Math.round(margin + panel * panelHeight + anchor[1] * panelHeight + jitterY)),
      width: size.width,
      height: size.height,
      mediaHeight: size.mediaHeight,
      captionHeight: size.captionHeight,
      rotation: 0,
      layer: reference.memoirKeys?.length > 1 ? 3 : 1,
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
      layout.y = Math.max(margin, Math.round(margin + panel * panelHeight + anchor[1] * panelHeight + jitterY + shift[1] + pass * 92));
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
        const overlaps = current.x < next.x + next.width + 34
          && current.x + current.width + 34 > next.x
          && current.y < next.y + next.height + 34
          && current.y + current.height + 34 > next.y;
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

function centerOf(item) {
  const layout = item.layout;
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function sharesMemoir(left, right) {
  return (left.memoirKeys || []).some((key) => (right.memoirKeys || []).includes(key));
}

function buildRelationLines(activeReference, references) {
  if (!activeReference) return [];
  const activeItem = references.find((item) => item.reference.key === activeReference.key);
  if (!activeItem) return [];
  const from = centerOf(activeItem);
  return references
    .filter(({ reference }) => reference.key !== activeReference.key && sharesMemoir(activeReference, reference))
    .map((item) => ({
      key: `${activeReference.key}-${item.reference.key}`,
      from,
      to: centerOf(item),
      shared: activeReference.memoirKeys.filter((key) => item.reference.memoirKeys.includes(key)).length,
    }));
}

function sourceHref(reference) {
  return reference.url || reference.doiUrl || reference.zoteroUrl;
}

function assetLabel(reference) {
  if (reference.embed && reference.asset?.kind === 'oembed') return 'Média intégré';
  return ASSET_LABELS[reference.asset?.kind] || 'Image';
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
            {memoirs.map((memoir) => <option key={memoir.key} value={memoir.key}>{memoir.name}</option>)}
          </select>
        </label>

        <label className="tool-field">
          <span>Type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">Tous</option>
            {allTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className="tool-field">
          <span>Année</span>
          <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
            <option value="">Toutes</option>
            {allYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>

        <div className="tool-cluster" aria-label="Filtres">
          <FeatureToggle active={featureFilters.has('pdf')} icon={FileText} label="PDF" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'pdf'))} />
          <FeatureToggle active={featureFilters.has('url')} icon={Link2} label="Lien" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'url'))} />
          <FeatureToggle active={featureFilters.has('annotations')} icon={Highlighter} label="Surlignes" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'annotations'))} />
          <FeatureToggle active={featureFilters.has('shared')} icon={UsersRound} label="Croisées" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'shared'))} />
        </div>

        <button className="reset-button" type="button" onClick={onReset}>
          <RotateCcw size={16} aria-hidden="true" />
          <span>Réinitialiser</span>
        </button>
      </aside>
    </>
  );
}

function AtlasObject({ reference, layout, active, related, onSelect, onHover }) {
  const assetKind = reference.asset?.kind || 'fallback';
  const type = supportType(reference);
  const transform = `translate(${layout.x}px, ${layout.y}px)`;

  return (
    <article
      className={`atlas-object atlas-object--${assetKind} atlas-object--${type}${active ? ' is-active' : ''}${related ? ' is-related' : ''}`}
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
      <button className="atlas-object-main" type="button" onClick={() => onSelect(reference)}>
        <span className="object-media">
          <ReferenceVisual reference={reference} />
        </span>
      </button>
      <div className="object-caption">
        <p>{reference.title}</p>
        <span>{reference.typeLabel}{reference.year ? ` / ${reference.year}` : ''}</span>
      </div>
    </article>
  );
}

function RelationLayer({ lines, width, height }) {
  return (
    <svg className="relation-layer" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {lines.map((line) => (
        <line
          key={line.key}
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
          strokeWidth={line.shared > 1 ? 2.4 : 1.5}
        />
      ))}
    </svg>
  );
}

function MiniMap({ items, layout, activeKey, transformState, viewport }) {
  const width = 260;
  const height = Math.round(width * (layout.height / layout.width));
  const scale = width / layout.width;
  const rawView = transformState?.scale
    ? {
      x: (-transformState.positionX / transformState.scale) * scale,
      y: (-transformState.positionY / transformState.scale) * scale,
      width: (viewport.width / transformState.scale) * scale,
      height: (viewport.height / transformState.scale) * scale,
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
              left: item.x * scale,
              top: item.y * scale,
              width: Math.max(5, item.width * scale),
              height: Math.max(5, item.height * scale),
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

function DetailPanel({ reference, onClose, width, onResize }) {
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
  const siteScale = clamp((width - 40) / 1120, 0.28, 0.68);

  const startResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handleMove = (moveEvent) => {
      const maxWidth = Math.min(window.innerWidth - 24, 820);
      onResize(clamp(startWidth + startX - moveEvent.clientX, 360, maxWidth));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <aside className="detail-panel" role="dialog" aria-modal="false" aria-label={reference.title} style={{ '--detail-width': `${width}px` }}>
      <button className="detail-resizer" type="button" aria-label="Redimensionner le volet" onPointerDown={startResize} />
      <div className="panel-head">
        <span>{reference.typeLabel}{reference.year ? ` / ${reference.year}` : ''}</span>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

      <div className={`detail-media detail-media--${assetKind} detail-media--${type}${canEmbed ? ' detail-media--embed' : ''}`}>
        {canEmbed ? (
          <div className={`embed-stage${siteEmbed ? ' embed-stage--site' : ''}`} style={siteEmbed ? { '--site-scale': siteScale } : undefined}>
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

        <dl className="detail-meta">
          <dt>Visuel</dt><dd>{assetLabel(reference)}</dd>
          {reference.publisher && <><dt>Édition</dt><dd>{reference.publisher}</dd></>}
          {reference.publicationTitle && <><dt>Revue</dt><dd>{reference.publicationTitle}</dd></>}
          {reference.bookTitle && <><dt>Dans</dt><dd>{reference.bookTitle}</dd></>}
          {reference.isbn && <><dt>ISBN</dt><dd>{reference.isbn}</dd></>}
          {reference.doi && <><dt>DOI</dt><dd>{reference.doi}</dd></>}
        </dl>

        <div className="detail-rubrics">
          {(reference.memoirNames || []).map((name) => <span key={name}>{name}</span>)}
        </div>
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
  const [detailWidth, setDetailWidth] = useState(460);
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

  const packed = useMemo(() => packReferences(filteredReferences, viewport), [filteredReferences, viewport]);
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
  const relatedKeys = useMemo(() => new Set(activeReference
    ? filteredReferences.filter((reference) => reference.key !== activeReference.key && sharesMemoir(activeReference, reference)).map((reference) => reference.key)
    : []), [activeReference, filteredReferences]);
  const relationLines = useMemo(() => buildRelationLines(activeReference, visibleItems), [activeReference, visibleItems]);
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
  }, [fixedScale, layout.height, layout.width, visibleItems.length]);

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
        <a className="brand-link" href={catalog.source.groupUrl} target="_blank" rel="noreferrer">
          <Library size={20} aria-hidden="true" />
          <span>EnsadNancy</span>
        </a>
        <div className="atlas-title">
          <h1>{catalog.source.rootCollectionName}</h1>
          <p>{filteredReferences.length} objets / {catalog.stats.referenceCount} références / {catalog.stats.annotationCount} surlignes</p>
        </div>
        <button className="tools-toggle" type="button" onClick={() => setToolsOpen(true)}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Filtres</span>
          {toolCount > 0 && <em>{toolCount}</em>}
        </button>
      </header>

      {filteredReferences.length ? (
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
                  <RelationLayer lines={relationLines} width={layout.width} height={layout.height} />
                  {visibleItems.map(({ reference, layout: itemLayout }) => (
                    <AtlasObject
                      key={reference.key}
                      reference={reference}
                      layout={itemLayout}
                      active={activeReference?.key === reference.key}
                      related={relatedKeys.has(reference.key)}
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

      <DetailPanel reference={selectedReference} onClose={() => setSelectedReference(null)} width={detailWidth} onResize={setDetailWidth} />

      <footer className="atlas-footer">
        <span><CalendarDays size={14} aria-hidden="true" />{formatUpdated(catalog.generatedAt)}</span>
        <span>Images et médias chargés à la demande</span>
      </footer>
    </main>
  );
}
