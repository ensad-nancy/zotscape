import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  FileText,
  Filter,
  Globe2,
  Highlighter,
  Layers3,
  Library,
  Link2,
  Search,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL || '/';

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
      hour: '2-digit',
      minute: '2-digit',
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
    reference.citationKey,
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

function sortReferences(references, sortMode) {
  const sorted = [...references];
  if (sortMode === 'year-desc') {
    sorted.sort((left, right) => Number(right.year || 0) - Number(left.year || 0) || left.title.localeCompare(right.title, 'fr'));
  } else if (sortMode === 'shared') {
    sorted.sort((left, right) => (right.memoirKeys?.length || 0) - (left.memoirKeys?.length || 0) || left.title.localeCompare(right.title, 'fr'));
  } else if (sortMode === 'type') {
    sorted.sort((left, right) => (left.typeLabel || '').localeCompare(right.typeLabel || '', 'fr') || left.title.localeCompare(right.title, 'fr'));
  } else {
    sorted.sort((left, right) => left.title.localeCompare(right.title, 'fr'));
  }
  return sorted;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <Icon size={17} aria-hidden="true" />
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function MemoirButton({ memoir, active, onClick }) {
  return (
    <button className={`memoir-button${active ? ' is-active' : ''}`} type="button" onClick={onClick}>
      <span className="memoir-name">{memoir.name}</span>
      <span className="memoir-meta">
        <span>{memoir.referenceCount} refs</span>
        {memoir.sharedReferenceCount > 0 && <span>{memoir.sharedReferenceCount} croisées</span>}
      </span>
      <span className="type-ribbons" aria-hidden="true">
        {(memoir.dominantTypes || []).slice(0, 3).map((entry) => (
          <span key={entry.type} title={`${entry.label}: ${entry.count}`} />
        ))}
      </span>
    </button>
  );
}

function FeatureToggle({ active, icon: Icon, label, onClick }) {
  return (
    <button className={`chip${active ? ' is-active' : ''}`} type="button" onClick={onClick}>
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function ReferenceCard({ reference, onSelect }) {
  const sourceHref = reference.url || reference.doiUrl || reference.zoteroUrl;
  return (
    <article className="reference-card">
      <button className="reference-open" type="button" onClick={() => onSelect(reference)}>
        <span className={`reference-visual reference-visual--${reference.asset?.kind || 'fallback'}`}>
          {reference.asset?.src && (
            <img src={assetUrl(reference.asset.src)} alt="" loading="lazy" />
          )}
        </span>
        <span className="reference-body">
          <span className="reference-kicker">
            <span>{reference.typeLabel}</span>
            {reference.year && <span>{reference.year}</span>}
          </span>
          <strong>{reference.title}</strong>
          <span className="reference-creator">{reference.creatorsLabel}</span>
          <span className="reference-badges">
            {reference.memoirKeys?.length > 1 && <span><UsersRound size={13} />{reference.memoirKeys.length}</span>}
            {reference.attachments?.hasPdf && <span><FileText size={13} />PDF</span>}
            {(reference.annotations?.count > 0 || reference.notes?.length > 0) && <span><Highlighter size={13} />{reference.annotations.count}</span>}
            {reference.url && <span><Globe2 size={13} />web</span>}
          </span>
        </span>
      </button>
      {sourceHref && (
        <a className="reference-link" href={sourceHref} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${reference.title}`}>
          <ArrowUpRight size={16} />
        </a>
      )}
    </article>
  );
}

function SharedStrip({ sharedReferences, onSelectKey }) {
  if (!sharedReferences.length) return null;
  return (
    <section className="shared-strip" aria-labelledby="shared-heading">
      <div className="section-heading">
        <Sparkles size={18} aria-hidden="true" />
        <h2 id="shared-heading">Références croisées</h2>
      </div>
      <div className="shared-list">
        {sharedReferences.slice(0, 8).map((reference) => (
          <button key={reference.key} className="shared-item" type="button" onClick={() => onSelectKey(reference.key)}>
            <strong>{reference.title}</strong>
            <span>{reference.creatorsLabel}{reference.year ? `, ${reference.year}` : ''}</span>
            <em>{reference.count} mémoires</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function DetailDrawer({ reference, onClose }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!reference) return null;
  const sourceHref = reference.url || reference.doiUrl || reference.zoteroUrl;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={reference.title} onMouseDown={(event) => event.stopPropagation()}>
        <button className="drawer-close" type="button" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <div className="drawer-media">
          {reference.asset?.src && <img src={assetUrl(reference.asset.src)} alt="" />}
        </div>
        <div className="drawer-content">
          <div className="reference-kicker">
            <span>{reference.typeLabel}</span>
            {reference.year && <span>{reference.year}</span>}
          </div>
          <h2>{reference.title}</h2>
          <p className="drawer-authors">{reference.creatorsLabel}</p>
          <div className="drawer-actions">
            {sourceHref && (
              <a href={sourceHref} target="_blank" rel="noreferrer">
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
          </div>

          {reference.abstract && <p className="abstract">{reference.abstract}</p>}

          <dl className="meta-grid">
            {reference.publisher && <><dt>Édition</dt><dd>{reference.publisher}</dd></>}
            {reference.publicationTitle && <><dt>Revue</dt><dd>{reference.publicationTitle}</dd></>}
            {reference.bookTitle && <><dt>Dans</dt><dd>{reference.bookTitle}</dd></>}
            {reference.isbn && <><dt>ISBN</dt><dd>{reference.isbn}</dd></>}
            {reference.doi && <><dt>DOI</dt><dd>{reference.doi}</dd></>}
            {reference.citationKey && <><dt>Citekey</dt><dd>{reference.citationKey}</dd></>}
          </dl>

          <div className="memoir-tags">
            {(reference.memoirNames || []).map((name) => <span key={name}>{name}</span>)}
          </div>

          {(reference.annotations?.count > 0 || reference.notes?.length > 0) && (
            <section className="annotation-section">
              <div className="section-heading">
                <Highlighter size={18} aria-hidden="true" />
                <h3>Notes et surlignes</h3>
                <span>{reference.annotations?.count || 0}</span>
              </div>
              {(reference.annotations?.samples || []).map((sample, index) => (
                <blockquote key={`${sample.page}-${index}`} style={{ borderColor: sample.color || '#d7dadd' }}>
                  <p>{sample.text || sample.comment}</p>
                  {sample.page && <cite>p. {sample.page}</cite>}
                </blockquote>
              ))}
              {(reference.notes || []).map((note, index) => (
                <blockquote key={`note-${index}`}>
                  <p>{note.text}</p>
                </blockquote>
              ))}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <BookOpen size={28} aria-hidden="true" />
      <p>Aucune référence dans cette sélection.</p>
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
  const [sortMode, setSortMode] = useState('title');
  const [selectedReference, setSelectedReference] = useState(null);

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

  const references = catalog?.references || [];
  const memoirs = catalog?.memoirs || [];
  const activeMemoirName = memoirs.find((memoir) => memoir.key === activeMemoir)?.name || 'Tous les mémoires';

  const filteredReferences = useMemo(() => {
    const search = normalize(query);
    const base = references.filter((reference) => {
      if (activeMemoir && !reference.memoirKeys?.includes(activeMemoir)) return false;
      if (typeFilter && reference.itemType !== typeFilter) return false;
      if (yearFilter && reference.year !== yearFilter) return false;
      if (search && !getSearchBlob(reference).includes(search)) return false;
      for (const feature of featureFilters) {
        if (!referenceMatchesFeature(reference, feature)) return false;
      }
      return true;
    });
    return sortReferences(base, sortMode);
  }, [activeMemoir, featureFilters, query, references, sortMode, typeFilter, yearFilter]);

  const allTypeOptions = useMemo(() => typeOptions(references), [references]);
  const allYearOptions = useMemo(() => yearOptions(references), [references]);

  function openReferenceByKey(key) {
    const reference = references.find((candidate) => candidate.key === key);
    if (reference) setSelectedReference(reference);
  }

  if (error) {
    return (
      <main className="app-shell">
        <div className="empty-state">
          <Library size={28} aria-hidden="true" />
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="app-shell">
        <div className="empty-state">
          <Library size={28} aria-hidden="true" />
          <p>Chargement du catalogue…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Library size={24} /></div>
          <div>
            <p>EnsadNancy</p>
            <h1>{catalog.source.rootCollectionName}</h1>
          </div>
        </div>
        <div className="stats-row" aria-label="Statistiques du catalogue">
          <Stat icon={Layers3} label="mémoires" value={catalog.stats.memoirCount} />
          <Stat icon={BookOpen} label="références" value={catalog.stats.referenceCount} />
          <Stat icon={Highlighter} label="surlignes" value={catalog.stats.annotationCount} />
        </div>
      </header>

      <section className="memoir-band" aria-label="Mémoires">
        <button className={`memoir-button memoir-button--all${activeMemoir ? '' : ' is-active'}`} type="button" onClick={() => setActiveMemoir('')}>
          <span className="memoir-name">Tous les mémoires</span>
          <span className="memoir-meta">
            <span>{catalog.stats.referenceCount} refs</span>
            <span>{catalog.stats.sharedReferenceCount} croisées</span>
          </span>
        </button>
        {memoirs.map((memoir) => (
          <MemoirButton
            key={memoir.key}
            memoir={memoir}
            active={activeMemoir === memoir.key}
            onClick={() => setActiveMemoir(memoir.key)}
          />
        ))}
      </section>

      <SharedStrip sharedReferences={catalog.sharedReferences || []} onSelectKey={openReferenceByKey} />

      <section className="catalog-section">
        <div className="catalog-heading">
          <div>
            <p>{activeMemoirName}</p>
            <h2>{filteredReferences.length} références</h2>
          </div>
          <span className="updated"><CalendarDays size={15} />{formatUpdated(catalog.generatedAt)}</span>
        </div>

        <div className="toolbar">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
          </label>
          <label className="select-box">
            <Filter size={16} aria-hidden="true" />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">Types</option>
              {allTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="select-box">
            <CalendarDays size={16} aria-hidden="true" />
            <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
              <option value="">Années</option>
              {allYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="select-box">
            <Layers3 size={16} aria-hidden="true" />
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="title">Titre</option>
              <option value="year-desc">Année</option>
              <option value="shared">Croisements</option>
              <option value="type">Type</option>
            </select>
          </label>
        </div>

        <div className="chips-row" aria-label="Filtres rapides">
          <FeatureToggle active={featureFilters.has('pdf')} icon={FileText} label="PDF" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'pdf'))} />
          <FeatureToggle active={featureFilters.has('url')} icon={Link2} label="Lien" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'url'))} />
          <FeatureToggle active={featureFilters.has('annotations')} icon={Highlighter} label="Surlignes" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'annotations'))} />
          <FeatureToggle active={featureFilters.has('shared')} icon={UsersRound} label="Croisées" onClick={() => setFeatureFilters(toggleSet(featureFilters, 'shared'))} />
        </div>

        {filteredReferences.length ? (
          <div className="reference-grid">
            {filteredReferences.map((reference) => (
              <ReferenceCard key={reference.key} reference={reference} onSelect={setSelectedReference} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>

      <DetailDrawer reference={selectedReference} onClose={() => setSelectedReference(null)} />
    </main>
  );
}
