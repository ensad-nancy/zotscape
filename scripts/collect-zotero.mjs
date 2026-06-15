import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const dataDir = path.join(publicRoot, 'data');
const mediaDir = path.join(publicRoot, 'media');
const coverDir = path.join(mediaDir, 'covers');
const screenshotDir = path.join(mediaDir, 'screenshots');
const fallbackDir = path.join(mediaDir, 'fallbacks');
const cacheDir = path.join(projectRoot, '.cache');
const assetCacheFile = path.join(cacheDir, 'zotscape-assets.json');

const GROUP_ID = Number(process.env.ZOTSCAPE_ZOTERO_GROUP_ID || 6584095);
const ROOT_COLLECTION_NAME = process.env.ZOTSCAPE_ROOT_COLLECTION || 'Mémoires 2026-27';
const API_BASE = 'https://api.zotero.org';
const PAGE_SIZE = 100;
const SCREENSHOT_LIMIT = Math.max(0, Number(process.env.ZOTSCAPE_SCREENSHOT_LIMIT || 18));
const SKIP_SCREENSHOTS = process.env.ZOTSCAPE_SKIP_SCREENSHOTS === '1';

const EXCLUDED_ITEM_TYPES = new Set(['attachment', 'note', 'annotation']);
const WEB_CAPTURE_TYPES = new Set([
  'webpage',
  'blogPost',
  'newspaperArticle',
  'podcast',
  'videoRecording',
  'tvBroadcast',
  'film',
  'document',
  'presentation',
]);

const TYPE_LABELS = {
  artwork: 'Oeuvre',
  blogPost: 'Billet',
  book: 'Livre',
  bookSection: 'Chapitre',
  document: 'Document',
  film: 'Film',
  journalArticle: 'Article',
  newspaperArticle: 'Presse',
  podcast: 'Podcast',
  presentation: 'Presentation',
  thesis: 'Memoire / these',
  tvBroadcast: 'Emission',
  videoRecording: 'Video',
  webpage: 'Page web',
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

function zoteroPrefix() {
  return `${API_BASE}/groups/${GROUP_ID}`;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'zotscape/0.1 (+https://github.com)',
          ...(options.headers || {}),
        },
      });
      const backoff = Number(response.headers.get('Backoff') || 0);
      if (backoff > 0) {
        await sleep(Math.min(backoff * 1000, 15_000));
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        await sleep(750 * (index + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      await sleep(750 * (index + 1));
    }
  }
  throw lastError || new Error(`Fetch failed for ${url}`);
}

async function zoteroPage(pathname, params = {}, start = 0) {
  const url = new URL(`${zoteroPrefix()}${pathname}`);
  url.searchParams.set('v', '3');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('start', String(start));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithRetry(url, {
    headers: { 'Zotero-API-Version': '3' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Zotero ${pathname} -> ${response.status}: ${body.slice(0, 200)}`);
  }
  return {
    items: await response.json(),
    total: Number(response.headers.get('Total-Results') || 0),
    libraryVersion: response.headers.get('Last-Modified-Version') || null,
  };
}

async function zoteroAll(pathname, params = {}) {
  const all = [];
  let start = 0;
  let total = Infinity;
  let libraryVersion = null;
  while (start < total) {
    const page = await zoteroPage(pathname, params, start);
    if (!libraryVersion && page.libraryVersion) {
      libraryVersion = page.libraryVersion;
    }
    if (!Array.isArray(page.items) || page.items.length === 0) {
      break;
    }
    all.push(...page.items);
    total = page.total || all.length;
    start += page.items.length;
  }
  return { items: all, libraryVersion };
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function stripHtml(value) {
  return normalizeSpace(String(value || '')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>'));
}

function truncate(value, length) {
  const text = normalizeSpace(value);
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 1)).trim()}…`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'item';
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function mediaPath(filePath) {
  return path.relative(publicRoot, filePath).replace(/\\/gu, '/');
}

function creatorName(creator) {
  if (!creator) return '';
  if (creator.name) return normalizeSpace(creator.name);
  return normalizeSpace([creator.firstName, creator.lastName].filter(Boolean).join(' '));
}

function creatorSortName(creator) {
  if (!creator) return '';
  if (creator.name) return normalizeSpace(creator.name);
  return normalizeSpace([creator.lastName, creator.firstName].filter(Boolean).join(', '));
}

function primaryCreators(creators = []) {
  const priority = [
    'author',
    'artist',
    'director',
    'podcaster',
    'presenter',
    'editor',
    'contributor',
    'creator',
  ];
  for (const creatorType of priority) {
    const matches = creators.filter((creator) => creator.creatorType === creatorType);
    if (matches.length) return matches;
  }
  return creators.slice(0, 3);
}

function formatCreatorSummary(creators = []) {
  const names = primaryCreators(creators).map(creatorName).filter(Boolean);
  if (!names.length) return 'Auteur inconnu';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} et ${names[1]}`;
  return `${names[0]} et al.`;
}

function extractYear(item) {
  const parsed = String(item?.meta?.parsedDate || '');
  const fromParsed = parsed.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/u)?.[1];
  if (fromParsed) return fromParsed;
  const date = String(item?.data?.date || '');
  return date.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/u)?.[1] || '';
}

function extractCitationKey(item) {
  const data = item?.data || {};
  const extra = String(data.extra || '');
  const extraMatch = extra.match(/^\s*(?:citation key|better bibtex citation key|bibtex key)\s*:\s*(.+)\s*$/imu);
  return normalizeSpace(data.citationKey || data['citation-key'] || extraMatch?.[1] || '');
}

function parseIsbns(value) {
  const raw = String(value || '').replace(/ISBN(?:-1[03])?:?/giu, ' ');
  const matches = raw.match(/[0-9X][0-9X\-\s]{8,20}[0-9X]/giu) || [];
  return [...new Set(matches
    .map((candidate) => candidate.replace(/[^0-9X]/giu, '').toUpperCase())
    .filter((candidate) => candidate.length === 10 || candidate.length === 13))]
    .sort((left, right) => right.length - left.length);
}

function hostIsPrivate(hostname) {
  const host = hostname.toLowerCase();
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host.startsWith('127.')
    || host.startsWith('10.')
    || host.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./u.test(host);
}

function publicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (hostIsPrivate(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function getDoiUrl(doi) {
  const value = normalizeSpace(doi);
  if (!value) return '';
  return `https://doi.org/${value.replace(/^https?:\/\/doi\.org\//iu, '')}`;
}

function hashIndex(value, modulo) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return modulo ? hash % modulo : hash;
}

function wrapText(text, maxChars, maxLines) {
  const words = normalizeSpace(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/u, '')}…`;
  }
  return lines;
}

async function generateFallbackAsset(reference) {
  const filePath = path.join(fallbackDir, `${reference.key}.svg`);
  const [bg, ink, accent] = FALLBACK_PALETTES[hashIndex(reference.key, FALLBACK_PALETTES.length)];
  const titleLines = wrapText(reference.title || 'Sans titre', 24, 4);
  const authorLines = wrapText(reference.creatorsLabel || '', 34, 2);
  const typeLabel = TYPE_LABELS[reference.itemType] || reference.itemType || 'Reference';
  const titleTspans = titleLines.map((line, index) => (
    `<tspan x="34" y="${96 + index * 34}">${escapeXml(line)}</tspan>`
  )).join('');
  const authorTspans = authorLines.map((line, index) => (
    `<tspan x="34" y="${278 + index * 22}">${escapeXml(line)}</tspan>`
  )).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="620" viewBox="0 0 420 620" role="img" aria-label="${escapeXml(reference.title)}">
  <rect width="420" height="620" rx="0" fill="${bg}"/>
  <rect x="22" y="22" width="376" height="576" rx="18" fill="none" stroke="${ink}" stroke-opacity="0.16" stroke-width="2"/>
  <rect x="34" y="42" width="74" height="8" rx="4" fill="${accent}"/>
  <text x="34" y="72" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" fill="${ink}" opacity="0.72">${escapeXml(typeLabel.toUpperCase())}</text>
  <text font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700" fill="${ink}" letter-spacing="0">${titleTspans}</text>
  <text font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" fill="${ink}" opacity="0.72">${authorTspans}</text>
  <text x="34" y="548" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${ink}" opacity="0.75">${escapeXml(reference.year || 's. d.')}</text>
  <circle cx="350" cy="540" r="36" fill="${accent}" opacity="0.9"/>
  <text x="350" y="548" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="800" fill="${bg}">Z</text>
</svg>
`;
  await fs.writeFile(filePath, svg, 'utf8');
  return {
    kind: 'fallback',
    src: mediaPath(filePath),
    source: 'generated',
  };
}

function extensionForContentType(contentType, fallback = '.jpg') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  return fallback;
}

async function downloadImage(url, targetBasePath) {
  const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(45_000) }, 2);
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 700) return null;
  const extension = extensionForContentType(contentType);
  const filePath = `${targetBasePath}${extension}`;
  await fs.writeFile(filePath, bytes);
  return filePath;
}

async function findOpenLibraryCover(reference) {
  for (const isbn of reference.isbns) {
    const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;
    const filePath = await downloadImage(url, path.join(coverDir, `${reference.key}-openlibrary-${isbn}`)).catch(() => null);
    if (filePath) {
      return {
        kind: 'cover',
        src: mediaPath(filePath),
        source: 'openlibrary',
        identifier: isbn,
      };
    }
  }
  return null;
}

async function findGoogleBooksCover(reference) {
  for (const isbn of reference.isbns) {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', `isbn:${isbn}`);
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('projection', 'lite');
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(30_000) }, 2).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const links = payload?.items?.[0]?.volumeInfo?.imageLinks || {};
    const imageUrl = publicUrl(links.extraLarge || links.large || links.medium || links.thumbnail || links.smallThumbnail);
    if (!imageUrl) continue;
    const filePath = await downloadImage(imageUrl.replace(/^http:/u, 'https:'), path.join(coverDir, `${reference.key}-google-${isbn}`)).catch(() => null);
    if (filePath) {
      return {
        kind: 'cover',
        src: mediaPath(filePath),
        source: 'google-books',
        identifier: isbn,
      };
    }
  }
  return null;
}

async function enrichCover(reference, assetCache) {
  const cacheKey = `${reference.key}:${reference.version}:${reference.isbns.join(',')}`;
  const cached = assetCache.covers?.[reference.key];
  if (cached?.cacheKey && cached.cacheKey === cacheKey && cached.asset?.src) {
    const filePath = path.join(publicRoot, cached.asset.src);
    if (await exists(filePath)) return cached.asset;
  }
  if (!reference.isbns.length) return null;
  const asset = await findOpenLibraryCover(reference) || await findGoogleBooksCover(reference);
  assetCache.covers[reference.key] = { cacheKey, asset };
  return asset;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadScreenshotTools() {
  if (SKIP_SCREENSHOTS || SCREENSHOT_LIMIT === 0) return null;
  try {
    const [{ chromium }, sharpModule] = await Promise.all([
      import('playwright'),
      import('sharp').catch(() => null),
    ]);
    const browser = await chromium.launch({ headless: true });
    return {
      browser,
      sharp: sharpModule?.default || sharpModule,
    };
  } catch (error) {
    log(`Screenshots disabled: ${error.message}`);
    return null;
  }
}

async function captureScreenshot(reference, tools, assetCache) {
  const url = publicUrl(reference.url);
  if (!tools || !url) return null;
  const cacheKey = `${reference.key}:${reference.version}:${url}`;
  const cached = assetCache.screenshots?.[reference.key];
  if (cached?.cacheKey === cacheKey && cached.asset?.src) {
    const filePath = path.join(publicRoot, cached.asset.src);
    if (await exists(filePath)) return cached.asset;
    if (cached.failed) return null;
  }

  const page = await tools.browser.newPage({
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18_000 });
    await page.waitForTimeout(900);
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 68,
      fullPage: false,
      animations: 'disabled',
    });
    let filePath = path.join(screenshotDir, `${reference.key}.jpg`);
    if (tools.sharp) {
      filePath = path.join(screenshotDir, `${reference.key}.webp`);
      await tools.sharp(jpeg)
        .resize(900, 534, { fit: 'cover', position: 'top' })
        .webp({ quality: 68 })
        .toFile(filePath);
    } else {
      await fs.writeFile(filePath, jpeg);
    }
    const asset = {
      kind: 'screenshot',
      src: mediaPath(filePath),
      source: url,
    };
    assetCache.screenshots[reference.key] = { cacheKey, asset };
    return asset;
  } catch (error) {
    assetCache.screenshots[reference.key] = {
      cacheKey,
      asset: null,
      failed: true,
      error: error.message,
    };
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

function buildAttachmentSummary(attachments) {
  const contentTypes = {};
  for (const attachment of attachments) {
    const type = attachment.data?.contentType || attachment.data?.linkMode || 'unknown';
    contentTypes[type] = (contentTypes[type] || 0) + 1;
  }
  return {
    count: attachments.length,
    hasPdf: attachments.some((attachment) => attachment.data?.contentType === 'application/pdf'),
    hasEpub: attachments.some((attachment) => attachment.data?.contentType === 'application/epub+zip'),
    hasHtml: attachments.some((attachment) => attachment.data?.contentType === 'text/html'),
    contentTypes,
  };
}

function buildAnnotationSummary(annotations) {
  return {
    count: annotations.length,
    samples: annotations.slice(0, 4).map((annotation) => ({
      type: annotation.data?.annotationType || 'highlight',
      color: annotation.data?.annotationColor || '',
      page: annotation.data?.annotationPageLabel || '',
      text: truncate(annotation.data?.annotationText || '', 220),
      comment: truncate(annotation.data?.annotationComment || '', 160),
    })).filter((sample) => sample.text || sample.comment),
  };
}

function buildNoteSummary(notes) {
  return notes.slice(0, 3).map((note) => ({
    text: truncate(stripHtml(note.data?.note || ''), 260),
  })).filter((note) => note.text);
}

function normalizeReference(item, context) {
  const data = item.data || {};
  const creators = Array.isArray(data.creators) ? data.creators : [];
  const memoKeys = (data.collections || []).filter((key) => context.memoirByKey.has(key));
  const memoNames = memoKeys.map((key) => context.memoirByKey.get(key).name);
  const attachments = context.attachmentsByParent.get(item.key) || [];
  const directNotes = context.notesByParent.get(item.key) || [];
  const annotationList = attachments.flatMap((attachment) => context.annotationsByAttachment.get(attachment.key) || []);
  const year = extractYear(item);
  const title = normalizeSpace(data.title || data.shortTitle || 'Sans titre');
  const url = publicUrl(data.url);
  return {
    key: item.key,
    version: item.version ?? data.version ?? null,
    itemType: data.itemType || 'document',
    typeLabel: TYPE_LABELS[data.itemType] || data.itemType || 'Reference',
    title,
    shortTitle: normalizeSpace(data.shortTitle || ''),
    creators: creators.map((creator) => ({
      type: creator.creatorType || '',
      name: creatorName(creator),
      sortName: creatorSortName(creator),
    })).filter((creator) => creator.name),
    creatorsLabel: formatCreatorSummary(creators),
    year,
    date: normalizeSpace(data.date || ''),
    abstract: truncate(data.abstractNote || '', 760),
    publisher: normalizeSpace(data.publisher || data.distributor || data.studio || ''),
    place: normalizeSpace(data.place || ''),
    publicationTitle: normalizeSpace(data.publicationTitle || ''),
    bookTitle: normalizeSpace(data.bookTitle || ''),
    language: normalizeSpace(data.language || ''),
    isbn: normalizeSpace(data.ISBN || ''),
    isbns: parseIsbns(data.ISBN),
    doi: normalizeSpace(data.DOI || ''),
    doiUrl: getDoiUrl(data.DOI || ''),
    url,
    citationKey: extractCitationKey(item),
    zoteroUrl: item.links?.alternate?.href || '',
    tags: (data.tags || []).map((tag) => normalizeSpace(tag.tag)).filter(Boolean),
    memoirKeys: memoKeys,
    memoirNames: memoNames,
    sharedWith: memoNames,
    attachments: buildAttachmentSummary(attachments),
    notes: buildNoteSummary(directNotes),
    annotations: buildAnnotationSummary(annotationList),
    dateAdded: data.dateAdded || '',
    dateModified: data.dateModified || '',
    cover: null,
    screenshot: null,
    fallback: null,
    asset: null,
  };
}

function computeMemoirStats(memoir, references) {
  const refs = references.filter((reference) => reference.memoirKeys.includes(memoir.key));
  const typeCounts = {};
  for (const reference of refs) {
    typeCounts[reference.itemType] = (typeCounts[reference.itemType] || 0) + 1;
  }
  const dominantTypes = Object.entries(typeCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'fr'))
    .slice(0, 3)
    .map(([type, count]) => ({ type, label: TYPE_LABELS[type] || type, count }));
  return {
    ...memoir,
    referenceCount: refs.length,
    sharedReferenceCount: refs.filter((reference) => reference.memoirKeys.length > 1).length,
    typeCounts,
    dominantTypes,
  };
}

function chooseCardAsset(reference) {
  if (reference.screenshot && (WEB_CAPTURE_TYPES.has(reference.itemType) || !reference.cover)) {
    return reference.screenshot;
  }
  return reference.cover || reference.screenshot || reference.fallback;
}

async function main() {
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(coverDir, { recursive: true }),
    fs.mkdir(screenshotDir, { recursive: true }),
    fs.mkdir(fallbackDir, { recursive: true }),
    fs.mkdir(cacheDir, { recursive: true }),
  ]);

  const assetCache = {
    covers: {},
    screenshots: {},
    ...(await readJson(assetCacheFile, {})),
  };
  assetCache.covers ||= {};
  assetCache.screenshots ||= {};

  log(`Collecting Zotero group ${GROUP_ID}...`);
  const [{ items: collections, libraryVersion: collectionVersion }, { items, libraryVersion: itemVersion }] = await Promise.all([
    zoteroAll('/collections'),
    zoteroAll('/items', { include: 'data', includeTrashed: '0' }),
  ]);

  const activeCollections = collections.filter((collection) => !collection.data?.deleted);
  const rootCollection = activeCollections.find((collection) => (
    collection.data?.name === ROOT_COLLECTION_NAME
    && (collection.data?.parentCollection || false) === false
  ));
  if (!rootCollection) {
    throw new Error(`Collection root not found: ${ROOT_COLLECTION_NAME}`);
  }

  const memoirs = activeCollections
    .filter((collection) => (collection.data?.parentCollection || false) === rootCollection.key)
    .sort((left, right) => String(left.data?.name || '').localeCompare(String(right.data?.name || ''), 'fr'))
    .map((collection) => ({
      key: collection.key,
      name: normalizeSpace(collection.data?.name || collection.key),
      slug: slugify(collection.data?.name || collection.key),
      zoteroUrl: collection.links?.alternate?.href || '',
    }));

  const memoirByKey = new Map(memoirs.map((memoir) => [memoir.key, memoir]));
  const selectedTopItems = items.filter((item) => (
    item?.key
    && !EXCLUDED_ITEM_TYPES.has(item.data?.itemType)
    && (item.data?.collections || []).some((key) => memoirByKey.has(key))
  ));
  const attachmentsByParent = new Map();
  const notesByParent = new Map();
  const annotationsByAttachment = new Map();
  for (const item of items) {
    if (item.data?.itemType === 'attachment' && item.data?.parentItem) {
      const list = attachmentsByParent.get(item.data.parentItem) || [];
      list.push(item);
      attachmentsByParent.set(item.data.parentItem, list);
    }
    if (item.data?.itemType === 'note' && item.data?.parentItem) {
      const list = notesByParent.get(item.data.parentItem) || [];
      list.push(item);
      notesByParent.set(item.data.parentItem, list);
    }
    if (item.data?.itemType === 'annotation' && item.data?.parentItem) {
      const list = annotationsByAttachment.get(item.data.parentItem) || [];
      list.push(item);
      annotationsByAttachment.set(item.data.parentItem, list);
    }
  }

  const context = { memoirByKey, attachmentsByParent, notesByParent, annotationsByAttachment };
  const references = selectedTopItems
    .map((item) => normalizeReference(item, context))
    .sort((left, right) => (
      left.title.localeCompare(right.title, 'fr')
      || left.key.localeCompare(right.key)
    ));

  log(`Found ${memoirs.length} memoir collections and ${references.length} references.`);
  log('Enriching covers and fallback cards...');
  for (const reference of references) {
    reference.cover = await enrichCover(reference, assetCache);
    reference.fallback = await generateFallbackAsset(reference);
  }

  const screenshotCandidates = references
    .filter((reference) => reference.url && (WEB_CAPTURE_TYPES.has(reference.itemType) || !reference.cover))
    .slice(0, SCREENSHOT_LIMIT);
  const screenshotTools = await loadScreenshotTools();
  if (screenshotTools && screenshotCandidates.length) {
    log(`Capturing ${screenshotCandidates.length} targeted web thumbnails...`);
    for (const reference of screenshotCandidates) {
      reference.screenshot = await captureScreenshot(reference, screenshotTools, assetCache);
    }
    await screenshotTools.browser.close().catch(() => {});
  }

  for (const reference of references) {
    reference.asset = chooseCardAsset(reference);
  }

  const memoirsWithStats = memoirs.map((memoir) => computeMemoirStats(memoir, references));
  const sharedReferences = references
    .filter((reference) => reference.memoirKeys.length > 1)
    .sort((left, right) => (
      right.memoirKeys.length - left.memoirKeys.length
      || left.title.localeCompare(right.title, 'fr')
    ))
    .map((reference) => ({
      key: reference.key,
      title: reference.title,
      creatorsLabel: reference.creatorsLabel,
      year: reference.year,
      memoirKeys: reference.memoirKeys,
      memoirNames: reference.memoirNames,
      count: reference.memoirKeys.length,
    }));

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: {
      groupId: GROUP_ID,
      groupName: selectedTopItems[0]?.library?.name || 'EnsadNancy',
      groupUrl: selectedTopItems[0]?.library?.links?.alternate?.href || `https://www.zotero.org/groups/${GROUP_ID}`,
      rootCollectionKey: rootCollection.key,
      rootCollectionName: ROOT_COLLECTION_NAME,
      rootCollectionUrl: rootCollection.links?.alternate?.href || '',
      libraryVersion: Number(itemVersion || collectionVersion || 0) || null,
    },
    stats: {
      memoirCount: memoirsWithStats.length,
      referenceCount: references.length,
      sharedReferenceCount: sharedReferences.length,
      annotationCount: references.reduce((sum, reference) => sum + reference.annotations.count, 0),
      noteCount: references.reduce((sum, reference) => sum + reference.notes.length, 0),
      attachmentCount: references.reduce((sum, reference) => sum + reference.attachments.count, 0),
    },
    memoirs: memoirsWithStats,
    references,
    sharedReferences,
  };

  await writeJson(path.join(dataDir, 'catalog.json'), catalog);
  await writeJson(assetCacheFile, assetCache);
  log(`Wrote ${path.relative(projectRoot, path.join(dataDir, 'catalog.json'))}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
