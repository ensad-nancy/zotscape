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
  Play,
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
  fallback: 'Carton de référence',
  oembed: 'Média intégré',
  'open-graph': 'Image du site',
  'pdf-screenshot': 'PDF public',
  screenshot: 'Capture',
};

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
  if (type === 'film') return { width: shared ? 390 : 360, height: 260 };
  if (type === 'web') return { width: shared ? 370 : 340, height: 270 };
  if (type === 'article') return { width: shared ? 300 : 275, height: 330 };
  if (type === 'chapter') return { width: 240, height: 330 };
  if (type === 'thesis') return { width: 260, height: 350 };
  if (type === 'book') return { width: shared ? 260 : 230, height: shared ? 365 : 335 };
  return { width: 270, height: 320 };
}

function packReferences(references, viewport) {
  const margin = viewport.width < 760 ? 86 : 118;
  const gapX = viewport.width < 760 ? 34 : 58;
  const gapY = viewport.width < 760 ? 42 : 56;
  const maxWidth = clamp(viewport.width * (viewport.width < 760 ? 2.2 : 1.75), 980, 2320);
  let x = margin;
  let y = margin + 82;
  let rowHeight = 0;
  const items = references.map((reference, index) => {
    const size = objectDimensions(reference);
    if (x + size.width > maxWidth - margin && x > margin) {
      x = margin;
      y += rowHeight + gapY;
      rowHeight = 0;
    }
    const layout = {
      index: index + 1,
      x,
      y,
      width: size.width,
      height: size.height,
      rotation: 0,
      layer: reference.memoirKeys?.length > 1 ? 3 : 1,
    };
    x += size.width + gapX;
    rowHeight = Math.max(rowHeight, size.height);
    return { reference, layout };
  });
  return {
    items,
    layout: {
      width: Math.max(maxWidth, x + margin),
      height: Math.max(viewport.height + 240, y + rowHeight + margin + 150),
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
      style={{ width: layout.width, height: layout.height, transform, zIndex: active ? 10 : layout.layer || 1 }}
      onMouseEnter={() => onHover(reference.key)}
      onMouseLeave={() => onHover('')}
    >
      <button className="atlas-object-main" type="button" onClick={() => onSelect(reference)}>
        <span className="object-number">{layout.index}</span>
        <span className="object-media">
          {reference.asset?.src && <img src={assetUrl(reference.asset.src)} alt="" loading="lazy" />}
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
  const view = transformState?.scale
    ? {
      x: Math.max(0, (-transformState.positionX / transformState.scale) * scale),
      y: Math.max(0, (-transformState.positionY / transformState.scale) * scale),
      width: Math.min(width, (viewport.width / transformState.scale) * scale),
      height: Math.min(height, (viewport.height / transformState.scale) * scale),
    }
    : null;

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
            {reference.asset?.src && <img src={assetUrl(reference.asset.src)} alt="" />}
          </span>
        ))}
        {view && <span className="mini-map-viewport" style={{ left: view.x, top: view.y, width: view.width, height: view.height }} />}
      </div>
    </aside>
  );
}

function DetailPanel({ reference, onClose }) {
  const [embedLoaded, setEmbedLoaded] = useState(false);

  useEffect(() => {
    if (!reference) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, reference]);

  useEffect(() => {
    setEmbedLoaded(false);
  }, [reference?.key]);

  if (!reference) return null;
  const href = sourceHref(reference);
  const assetKind = reference.asset?.kind || 'fallback';
  const canEmbed = Boolean(reference.embed?.src || reference.embed?.html);

  return (
    <aside className="detail-panel" role="dialog" aria-modal="false" aria-label={reference.title}>
      <div className="panel-head">
        <span>{reference.typeLabel}{reference.year ? ` / ${reference.year}` : ''}</span>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

      <div className={`detail-media detail-media--${assetKind}`}>
        {embedLoaded && canEmbed ? (
          <iframe
            title={reference.embed.title || reference.title}
            src={reference.embed.src || undefined}
            srcDoc={reference.embed.src ? undefined : reference.embed.html}
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          reference.asset?.src && <img src={assetUrl(reference.asset.src)} alt="" />
        )}
      </div>

      <div className="detail-body">
        <h2>{reference.title}</h2>
        <p className="detail-authors">{reference.creatorsLabel}</p>

        {canEmbed && !embedLoaded && (
          <button className="media-load-button" type="button" onClick={() => setEmbedLoaded(true)}>
            <Play size={16} aria-hidden="true" />
            <span>Charger le média</span>
          </button>
        )}

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
    const chromeY = viewport.width < 760 ? 120 : 150;
    return clamp(
      Math.min((viewport.width - chromeX) / layout.width, (viewport.height - chromeY) / layout.height) * 1.18,
      viewport.width < 760 ? 0.46 : 0.5,
      viewport.width < 760 ? 0.78 : 0.86,
    );
  }, [layout.height, layout.width, viewport.height, viewport.width]);

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

      <DetailPanel reference={selectedReference} onClose={() => setSelectedReference(null)} />

      <footer className="atlas-footer">
        <span><CalendarDays size={14} aria-hidden="true" />{formatUpdated(catalog.generatedAt)}</span>
        <span>Images et médias chargés à la demande</span>
      </footer>
    </main>
  );
}
