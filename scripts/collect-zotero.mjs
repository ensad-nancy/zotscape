import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const dataDir = path.join(publicRoot, 'data');
const catalogsDir = path.join(dataDir, 'catalogs');
const mediaDir = path.join(publicRoot, 'media');
const coverDir = path.join(mediaDir, 'covers');
const previewDir = path.join(mediaDir, 'previews');
const screenshotDir = path.join(mediaDir, 'screenshots');
const fallbackDir = path.join(mediaDir, 'fallbacks');
const cacheDir = path.join(projectRoot, '.cache');
const assetCacheFile = path.join(cacheDir, 'zotscape-assets.json');

function parseEnvLine(line) {
  const match = String(line || '').match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/iu);
  if (!match) return null;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

async function loadLocalEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const text = await fs.readFile(path.join(projectRoot, name), 'utf8').catch(() => '');
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

await loadLocalEnvFiles();

const GROUP_ID = Number(process.env.ZOTSCAPE_ZOTERO_GROUP_ID || 6584095);
const ROOT_COLLECTION_FILTER = process.env.ZOTSCAPE_ROOT_COLLECTION || '';
const API_BASE = 'https://api.zotero.org';
const PAGE_SIZE = 100;
const SCREENSHOT_LIMIT = Math.max(0, Number(process.env.ZOTSCAPE_SCREENSHOT_LIMIT || 18));
const SKIP_SCREENSHOTS = process.env.ZOTSCAPE_SKIP_SCREENSHOTS === '1';
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
const USE_PUBLIC_GOOGLE_BOOKS = process.env.ZOTSCAPE_ENABLE_GOOGLE_BOOKS_PUBLIC === '1';
const ISBNDB_API_KEY = process.env.ISBNDB_API_KEY || '';
const COVER_PIPELINE_VERSION = 2;
const ATLAS_WIDTH = 3200;
const ATLAS_HEIGHT = 2200;

const EXCLUDED_ITEM_TYPES = new Set(['attachment', 'note', 'annotation']);
const EXCLUDED_MEMOIR_COLLECTION_PATTERNS = [
  /^acquisitions?\b/i,
  /^acclimatements?\b/i,
  /^m[ée]thodologie\b/i,
];
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
const COVER_OBJECT_TYPES = new Set(['book', 'bookSection', 'thesis']);
const CATALOG_ENRICHMENT_FIELDS = [
  'cover',
  'fallback',
  'embed',
  'openGraph',
  'archive',
  'screenshot',
  'asset',
  'previewStatus',
];

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

const OEMBED_ENDPOINTS = [
  {
    hosts: ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'],
    endpoint: 'https://www.youtube.com/oembed',
  },
  {
    hosts: ['vimeo.com', 'www.vimeo.com'],
    endpoint: 'https://vimeo.com/api/oembed.json',
  },
  {
    hosts: ['soundcloud.com', 'www.soundcloud.com'],
    endpoint: 'https://soundcloud.com/oembed',
  },
  {
    hosts: ['flickr.com', 'www.flickr.com', 'flic.kr'],
    endpoint: 'https://www.flickr.com/services/oembed/',
  },
];

const BLOCKED_PATTERNS = [
  /access denied/iu,
  /anubis/iu,
  /are you human/iu,
  /checking if the site connection is secure/iu,
  /cloudflare/iu,
  /cf-browser-verification/iu,
  /human or not/iu,
  /protected by/iu,
  /prove you are human/iu,
  /unusual traffic/iu,
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

function isMemoirCollectionName(name) {
  const normalized = normalizeSpace(name);
  return normalized && !EXCLUDED_MEMOIR_COLLECTION_PATTERNS.some((pattern) => pattern.test(normalized));
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

function memoirYearCollection(name) {
  const label = normalizeSpace(name);
  const match = label.match(/^m[ée]moires\s+(\d{4})\s*[-–]\s*(\d{2}|\d{4})$/iu);
  if (!match) return null;
  const startYear = Number(match[1]);
  const rawEnd = Number(match[2]);
  const endYear = match[2].length === 2
    ? Math.floor(startYear / 100) * 100 + rawEnd
    : rawEnd;
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) return null;
  return {
    id: `${startYear}-${String(endYear).slice(-2)}`,
    label,
    startYear,
    endYear,
  };
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

function extractCoverUrl(extra) {
  const match = String(extra || '').match(/^\s*(?:cover|cover\s*url|cover\s*image|image\s*cover)\s*:\s*(https?:\/\/\S+)\s*$/imu);
  return publicUrl(match?.[1] || '');
}

function parseIsbns(value) {
  const raw = String(value || '').replace(/ISBN(?:-1[03])?:?/giu, ' ');
  const matches = raw.match(/[0-9X][0-9X\-\s]{8,20}[0-9X]/giu) || [];
  const parsed = [...new Set(matches
    .map((candidate) => candidate.replace(/[^0-9X]/giu, '').toUpperCase())
    .filter((candidate) => candidate.length === 10 || candidate.length === 13))]
    .sort((left, right) => right.length - left.length);
  return expandIsbns(parsed);
}

function isbn10CheckDigit(firstNine) {
  const sum = firstNine
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = 11 - (sum % 11);
  if (remainder === 10) return 'X';
  if (remainder === 11) return '0';
  return String(remainder);
}

function isbn13CheckDigit(firstTwelve) {
  const sum = firstTwelve
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

function isbn13To10(isbn) {
  const value = String(isbn || '').replace(/[^0-9X]/giu, '').toUpperCase();
  if (!/^978\d{10}$/u.test(value)) return '';
  const firstNine = value.slice(3, 12);
  return `${firstNine}${isbn10CheckDigit(firstNine)}`;
}

function isbn10To13(isbn) {
  const value = String(isbn || '').replace(/[^0-9X]/giu, '').toUpperCase();
  if (!/^\d{9}[0-9X]$/u.test(value)) return '';
  const firstTwelve = `978${value.slice(0, 9)}`;
  return `${firstTwelve}${isbn13CheckDigit(firstTwelve)}`;
}

function expandIsbns(isbns = []) {
  const expanded = new Set();
  for (const isbn of isbns) {
    if (!isbn) continue;
    expanded.add(isbn);
    const converted = isbn.length === 13 ? isbn13To10(isbn) : isbn10To13(isbn);
    if (converted) expanded.add(converted);
  }
  return [...expanded].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

const COVER_STOP_WORDS = new Set([
  'about', 'avec', 'book', 'dans', 'des', 'du', 'edition', 'etait', 'from',
  'hist', 'histoire', 'humanite', 'les', 'livre', 'new', 'nouvelle', 'pour',
  'summary', 'the', 'une', 'und', 'with',
]);

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[’'`´]/gu, ' ')
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/giu, ' ')
    .toLowerCase()
    .trim();
}

function significantTokens(value) {
  return normalizeForMatch(value)
    .split(/\s+/u)
    .filter((token) => token.length >= 4 && !COVER_STOP_WORDS.has(token));
}

function creatorMatchTokens(reference) {
  return [...new Set((reference.creators || [])
    .flatMap((creator) => {
      const sortName = String(creator.sortName || '');
      if (sortName.includes(',')) return significantTokens(sortName.split(',')[0]);
      return significantTokens(creator.name).slice(-1);
    })
    .filter(Boolean))];
}

function titleOverlapScore(reference, candidateTitle) {
  const referenceTokens = significantTokens(reference.title);
  if (!referenceTokens.length) return 0;
  const candidate = new Set(significantTokens(candidateTitle));
  const shared = referenceTokens.filter((token) => candidate.has(token));
  return shared.length / referenceTokens.length;
}

function creatorOverlapScore(reference, candidateAuthors = []) {
  const creatorTokens = creatorMatchTokens(reference);
  if (!creatorTokens.length) return 0;
  const candidate = normalizeForMatch(Array.isArray(candidateAuthors) ? candidateAuthors.join(' ') : candidateAuthors);
  return creatorTokens.filter((token) => candidate.includes(token)).length;
}

function hasReferenceIsbn(reference, candidateIsbns = []) {
  const normalized = new Set((candidateIsbns || []).map((isbn) => String(isbn).replace(/[^0-9X]/giu, '').toUpperCase()));
  return reference.isbns.some((isbn) => normalized.has(isbn));
}

function titlePrefixMatch(reference, candidateTitle) {
  const referenceTitle = normalizeForMatch(reference.title);
  const candidate = normalizeForMatch(candidateTitle);
  if (candidate.length < 8) return false;
  return referenceTitle.startsWith(candidate) || candidate.startsWith(referenceTitle);
}

function coverSearchQueries(reference) {
  const creators = (reference.creators || []).map((creator) => creator.name).filter(Boolean).join(' ');
  const shortTitle = normalizeSpace(reference.shortTitle || reference.title.split(/[:.;!?—–-]/u)[0] || reference.title);
  const titleTokens = significantTokens(reference.title).slice(0, 4).join(' ');
  return [...new Set([
    reference.isbns.length ? `isbn:${reference.isbns[0]}` : '',
    [shortTitle, creators].filter(Boolean).join(' '),
    [titleTokens, creators].filter(Boolean).join(' '),
    [reference.title, creators].filter(Boolean).join(' '),
  ].map(normalizeSpace).filter(Boolean))];
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

function absoluteUrl(value, base) {
  try {
    return publicUrl(new URL(String(value || '').trim(), base).toString());
  } catch {
    return '';
  }
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>');
}

function getAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, 'iu');
  return decodeHtml(tag.match(pattern)?.[2] || '');
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const tag = html.match(new RegExp(`<meta\\b(?=[^>]*(?:property|name)=['"]${escaped}['"])[^>]*>`, 'iu'))?.[0];
    if (tag) {
      const value = getAttribute(tag, 'content');
      if (value) return normalizeSpace(value);
    }
  }
  return '';
}

function linkHref(html, typePattern) {
  const links = html.match(/<link\b[^>]*>/giu) || [];
  for (const tag of links) {
    const type = getAttribute(tag, 'type');
    if (typePattern.test(type)) {
      const href = getAttribute(tag, 'href');
      if (href) return href;
    }
  }
  return '';
}

function relationLinkHref(html, relationPattern) {
  const links = html.match(/<link\b[^>]*>/giu) || [];
  for (const tag of links) {
    const relation = getAttribute(tag, 'rel');
    if (relationPattern.test(relation)) {
      const href = getAttribute(tag, 'href');
      if (href) return href;
    }
  }
  return '';
}

function extractIframeSrc(html, base) {
  const iframe = String(html || '').match(/<iframe\b[^>]*>/iu)?.[0] || '';
  const src = getAttribute(iframe, 'src');
  return absoluteUrl(src, base);
}

function detectBlockedHtml(html, status = 200) {
  if ([401, 403, 429, 503].includes(Number(status))) return true;
  const text = stripHtml(String(html || '')).slice(0, 5000);
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikePublicPdfUrl(value) {
  const url = publicUrl(value);
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function assetPathExists(asset) {
  if (!asset?.src) return false;
  return exists(path.join(publicRoot, asset.src));
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

async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeout || 30_000),
  }, options.attempts || 2).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
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
  const typeLabel = TYPE_LABELS[reference.itemType] || reference.itemType || 'Reference';
  const family = (() => {
    if (['film', 'videoRecording', 'tvBroadcast'].includes(reference.itemType)) return 'film';
    if (['webpage', 'blogPost'].includes(reference.itemType)) return 'web';
    if (['journalArticle', 'newspaperArticle', 'document', 'presentation'].includes(reference.itemType)) return 'article';
    if (reference.itemType === 'bookSection') return 'chapter';
    if (reference.itemType === 'thesis') return 'thesis';
    return 'book';
  })();
  const spec = {
    article: { width: 500, height: 650, pad: 42, titleChars: 27, titleLines: 4, titleY: 142, authorY: 390, yearY: 580 },
    book: { width: 420, height: 620, pad: 42, titleChars: 23, titleLines: 4, titleY: 116, authorY: 380, yearY: 548 },
    chapter: { width: 420, height: 560, pad: 42, titleChars: 24, titleLines: 4, titleY: 112, authorY: 342, yearY: 492 },
    film: { width: 720, height: 420, pad: 48, titleChars: 38, titleLines: 3, titleY: 156, authorY: 292, yearY: 360 },
    thesis: { width: 460, height: 640, pad: 44, titleChars: 25, titleLines: 4, titleY: 146, authorY: 398, yearY: 570 },
    web: { width: 700, height: 480, pad: 44, titleChars: 38, titleLines: 3, titleY: 158, authorY: 318, yearY: 416 },
  }[family];
  const titleLines = wrapText(reference.title || 'Sans titre', spec.titleChars, spec.titleLines);
  const authorLines = wrapText(reference.creatorsLabel || '', Math.max(28, spec.titleChars + 8), 2);
  const titleTspans = titleLines.map((line, index) => (
    `<tspan x="${spec.pad}" y="${spec.titleY + index * 34}">${escapeXml(line)}</tspan>`
  )).join('');
  const authorTspans = authorLines.map((line, index) => (
    `<tspan x="${spec.pad}" y="${spec.authorY + index * 22}">${escapeXml(line)}</tspan>`
  )).join('');
  const motifs = {
    article: `<rect x="24" y="20" width="${spec.width - 48}" height="${spec.height - 40}" rx="12" fill="#fff" opacity="0.34"/>
  <rect x="42" y="48" width="7" height="${spec.height - 96}" rx="3" fill="${accent}" opacity="0.9"/>
  <path d="M76 70h250M76 92h330M76 114h280M76 520h240M76 544h190" stroke="${ink}" stroke-opacity="0.13" stroke-width="7" stroke-linecap="round"/>`,
    book: `<rect x="0" y="0" width="38" height="${spec.height}" fill="${ink}" opacity="0.11"/>
  <rect x="26" y="24" width="${spec.width - 52}" height="${spec.height - 48}" rx="18" fill="none" stroke="${ink}" stroke-opacity="0.16" stroke-width="2"/>
  <path d="M382 42v536" stroke="${ink}" stroke-opacity="0.1" stroke-width="12"/>
  <path d="M386 42v536" stroke="#fff" stroke-opacity="0.28" stroke-width="4"/>`,
    chapter: `<rect x="24" y="28" width="${spec.width - 48}" height="${spec.height - 56}" rx="16" fill="#fff" opacity="0.22"/>
  <path d="M${spec.width / 2} 54v452" stroke="${ink}" stroke-opacity="0.12" stroke-width="2"/>
  <rect x="42" y="42" width="76" height="8" rx="4" fill="${accent}" opacity="0.95"/>`,
    film: `<rect x="22" y="28" width="${spec.width - 44}" height="${spec.height - 56}" rx="22" fill="${ink}" opacity="0.08"/>
  <path d="M54 62h612M54 358h612" stroke="${ink}" stroke-opacity="0.2" stroke-width="10" stroke-dasharray="2 23" stroke-linecap="round"/>
  <path d="M344 206l54 32-54 32z" fill="${accent}" opacity="0.9"/>`,
    thesis: `<path d="M30 84h126l22 28h252v480H30z" fill="#fff" opacity="0.25"/>
  <rect x="52" y="134" width="18" height="380" rx="9" fill="${ink}" opacity="0.1"/>
  <path d="M96 158h246M96 182h280M96 206h210" stroke="${ink}" stroke-opacity="0.12" stroke-width="7" stroke-linecap="round"/>`,
    web: `<rect x="24" y="28" width="${spec.width - 48}" height="${spec.height - 56}" rx="24" fill="#fff" opacity="0.28"/>
  <rect x="44" y="52" width="${spec.width - 88}" height="36" rx="18" fill="${ink}" opacity="0.1"/>
  <circle cx="66" cy="70" r="6" fill="${accent}"/>
  <circle cx="86" cy="70" r="6" fill="${ink}" opacity="0.18"/>
  <circle cx="106" cy="70" r="6" fill="${ink}" opacity="0.18"/>
  <path d="M54 370h220M54 396h310M54 422h250" stroke="${ink}" stroke-opacity="0.12" stroke-width="8" stroke-linecap="round"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-label="${escapeXml(reference.title)}">
  <rect width="${spec.width}" height="${spec.height}" rx="0" fill="${bg}"/>
  ${motifs[family]}
  <rect x="${spec.pad}" y="${family === 'film' ? 96 : 62}" width="82" height="8" rx="4" fill="${accent}"/>
  <text x="${spec.pad}" y="${family === 'film' ? 126 : 92}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" fill="${ink}" opacity="0.72">${escapeXml(typeLabel.toUpperCase())}</text>
  <text font-family="Georgia, 'Times New Roman', serif" font-size="${family === 'film' || family === 'web' ? 32 : 30}" font-weight="700" fill="${ink}" letter-spacing="0">${titleTspans}</text>
  <text font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" fill="${ink}" opacity="0.72">${authorTspans}</text>
  <text x="${spec.pad}" y="${spec.yearY}" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${ink}" opacity="0.75">${escapeXml(reference.year || 's. d.')}</text>
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

async function imageLooksUsable(filePath, role = 'preview') {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats || stats.size < (role === 'cover' ? 1100 : 700)) return false;
  const sharpModule = await import('sharp').catch(() => null);
  const sharp = sharpModule?.default || sharpModule;
  if (!sharp) return true;
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) return false;
    if (role === 'cover') {
      if (metadata.width < 80 || metadata.height < 110) return false;
      const ratio = metadata.width / metadata.height;
      if (ratio < 0.32 || ratio > 1.25) return false;
    } else if (metadata.width < 120 || metadata.height < 80) {
      return false;
    }
    const imageStats = await image.stats().catch(() => null);
    const entropy = Number(imageStats?.entropy || 0);
    if (entropy > 0 && entropy < 0.55) return false;
    return true;
  } catch {
    return true;
  }
}

async function downloadImage(url, targetBasePath, options = {}) {
  const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(45_000) }, 2);
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 700) return null;
  const extension = extensionForContentType(contentType);
  const filePath = `${targetBasePath}${extension}`;
  await fs.writeFile(filePath, bytes);
  if (!await imageLooksUsable(filePath, options.role || 'preview')) {
    await fs.unlink(filePath).catch(() => {});
    return null;
  }
  return filePath;
}

async function imageDimensions(filePath) {
  const sharpModule = await import('sharp').catch(() => null);
  const sharp = sharpModule?.default || sharpModule;
  if (!sharp) return {};
  const metadata = await sharp(filePath).metadata().catch(() => null);
  if (!metadata?.width || !metadata?.height) return {};
  return {
    width: metadata.width,
    height: metadata.height,
    ratio: Number((metadata.width / metadata.height).toFixed(4)),
  };
}

async function coverAsset(filePath, source, identifier) {
  return {
    kind: 'cover',
    src: mediaPath(filePath),
    source,
    identifier,
    ...await imageDimensions(filePath),
  };
}

async function downloadOpenLibraryCoverById(reference, coverId, source) {
  if (!coverId) return null;
  const url = `https://covers.openlibrary.org/b/id/${encodeURIComponent(String(coverId))}-L.jpg?default=false`;
  const filePath = await downloadImage(
    url,
    path.join(coverDir, `${reference.key}-${source}-${coverId}`),
    { role: 'cover' },
  ).catch(() => null);
  if (!filePath) return null;
  return coverAsset(filePath, source, String(coverId));
}

async function findOpenLibraryCover(reference) {
  for (const isbn of reference.isbns) {
    const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;
    const filePath = await downloadImage(url, path.join(coverDir, `${reference.key}-openlibrary-${isbn}`), { role: 'cover' }).catch(() => null);
    if (filePath) {
      return await coverAsset(filePath, 'openlibrary-isbn', isbn);
    }
  }
  return null;
}

async function findOpenLibraryRelatedEditionCover(reference) {
  const seenWorks = new Set();
  const seenCovers = new Set();

  for (const isbn of reference.isbns) {
    const edition = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
    if (!edition) continue;

    for (const coverId of edition.covers || []) {
      if (seenCovers.has(String(coverId))) continue;
      seenCovers.add(String(coverId));
      const asset = await downloadOpenLibraryCoverById(reference, coverId, 'openlibrary-edition');
      if (asset) return asset;
    }

    for (const work of edition.works || []) {
      const workKey = String(work?.key || '');
      if (!workKey.startsWith('/works/') || seenWorks.has(workKey)) continue;
      seenWorks.add(workKey);
      const editionsUrl = new URL(`https://openlibrary.org${workKey}/editions.json`);
      editionsUrl.searchParams.set('limit', '35');
      const editions = await fetchJson(editionsUrl);
      const entries = Array.isArray(editions?.entries) ? editions.entries : [];
      const rankedEntries = entries
        .filter((entry) => Array.isArray(entry.covers) && entry.covers.length)
        .map((entry, index) => {
          const candidateIsbns = [...(entry.isbn_13 || []), ...(entry.isbn_10 || [])];
          const isbnMatch = hasReferenceIsbn(reference, candidateIsbns);
          const titleScore = titleOverlapScore(reference, entry.title || edition.title || '');
          const yearMatch = reference.year && String(entry.publish_date || '').includes(reference.year);
          return {
            entry,
            score: (isbnMatch ? 10 : 0) + titleScore * 4 + (yearMatch ? 1 : 0) - index * 0.02,
          };
        })
        .sort((left, right) => right.score - left.score);

      for (const ranked of rankedEntries.slice(0, 8)) {
        for (const coverId of ranked.entry.covers || []) {
          if (seenCovers.has(String(coverId))) continue;
          seenCovers.add(String(coverId));
          const asset = await downloadOpenLibraryCoverById(reference, coverId, 'openlibrary-work-edition');
          if (asset) return asset;
        }
      }
    }
  }
  return null;
}

async function findManualCover(reference) {
  if (!reference.coverUrl) return null;
  const filePath = await downloadImage(
    reference.coverUrl,
    path.join(coverDir, `${reference.key}-manual-cover`),
    { role: 'cover' },
  ).catch(() => null);
  if (!filePath) return null;
  return await coverAsset(filePath, 'zotero-extra-cover', reference.coverUrl);
}

async function findOpenLibrarySearchCover(reference) {
  const queries = coverSearchQueries(reference);

  for (const query of queries) {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '8');
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(30_000) }, 2).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const docs = Array.isArray(payload?.docs) ? payload.docs : [];
    for (let index = 0; index < docs.length; index += 1) {
      const doc = docs[index];
      if (!doc?.cover_i) continue;
      const isbnMatch = hasReferenceIsbn(reference, doc.isbn || []);
      const titleScore = titleOverlapScore(reference, doc.title);
      const prefixMatch = titlePrefixMatch(reference, doc.title);
      const creatorScore = creatorOverlapScore(reference, doc.author_name || []);
      const creatorTarget = Math.min(2, Math.max(1, creatorMatchTokens(reference).length));
      const isStrongTitleMatch = (titleScore >= 0.45 || prefixMatch) && creatorScore >= 1;
      const isLikelyTranslation = index === 0 && creatorScore >= creatorTarget && Number(payload?.numFound || 0) <= 24;
      if (!isbnMatch && !isStrongTitleMatch && !isLikelyTranslation) continue;
      const coverUrl = `https://covers.openlibrary.org/b/id/${encodeURIComponent(doc.cover_i)}-L.jpg?default=false`;
      const filePath = await downloadImage(
        coverUrl,
        path.join(coverDir, `${reference.key}-openlibrary-search-${doc.cover_i}`),
        { role: 'cover' },
      ).catch(() => null);
      if (filePath) {
        return await coverAsset(filePath, isbnMatch ? 'openlibrary-search-isbn' : 'openlibrary-search', String(doc.cover_i));
      }
    }
  }
  return null;
}

async function findGoogleBooksCover(reference) {
  if (!GOOGLE_BOOKS_API_KEY && !USE_PUBLIC_GOOGLE_BOOKS) return null;
  for (const isbn of reference.isbns) {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', `isbn:${isbn}`);
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('projection', 'lite');
    if (GOOGLE_BOOKS_API_KEY) url.searchParams.set('key', GOOGLE_BOOKS_API_KEY);
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(30_000) }, 2).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      const info = item.volumeInfo || {};
      const links = info.imageLinks || {};
      for (const imageUrl of googleBooksImageUrls(links)) {
        const filePath = await downloadImage(imageUrl, path.join(coverDir, `${reference.key}-google-${isbn}-${item.id || hashIndex(imageUrl)}`), { role: 'cover' }).catch(() => null);
        if (filePath) {
          return await coverAsset(filePath, 'google-books-isbn', isbn);
        }
      }
    }
  }
  return null;
}

function googleBooksQueries(reference) {
  const authors = primaryCreators(reference.creators || []).map((creator) => creator.name).filter(Boolean);
  const firstAuthor = authors[0] || '';
  const shortTitle = normalizeSpace(reference.shortTitle || reference.title.split(/[:.;!?—–-]/u)[0] || reference.title);
  const titleTokens = significantTokens(reference.title).slice(0, 5).join(' ');
  return [...new Set([
    ...reference.isbns.map((isbn) => `isbn:${isbn}`),
    shortTitle && firstAuthor ? `intitle:"${shortTitle}" inauthor:"${firstAuthor}"` : '',
    reference.publisher && shortTitle ? `intitle:"${shortTitle}" inpublisher:"${reference.publisher}"` : '',
    [shortTitle, firstAuthor].filter(Boolean).join(' '),
    [titleTokens, firstAuthor].filter(Boolean).join(' '),
    [reference.title, firstAuthor].filter(Boolean).join(' '),
  ].map(normalizeSpace).filter(Boolean))];
}

function upgradeGoogleBooksImageUrl(value) {
  const url = publicUrl(String(value || '').replace(/^http:/u, 'https:'));
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('google.com') || parsed.hostname.endsWith('googleusercontent.com')) {
      if (parsed.searchParams.has('zoom')) parsed.searchParams.set('zoom', '0');
      parsed.searchParams.delete('edge');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function googleBooksImageUrls(links = {}) {
  const values = [
    links.extraLarge,
    links.large,
    links.medium,
    links.thumbnail,
    links.smallThumbnail,
  ].map((value) => publicUrl(String(value || '').replace(/^http:/u, 'https:'))).filter(Boolean);
  const urls = [];
  for (const value of values) {
    const upgraded = upgradeGoogleBooksImageUrl(value);
    if (upgraded) urls.push(upgraded);
    urls.push(value);
  }
  return [...new Set(urls)];
}

function googleBookScore(reference, info = {}) {
  const candidateIsbns = (info.industryIdentifiers || []).map((identifier) => identifier.identifier);
  const isbnMatch = hasReferenceIsbn(reference, candidateIsbns);
  const titleScore = titleOverlapScore(reference, info.title || '');
  const prefixMatch = titlePrefixMatch(reference, info.title || '');
  const creatorScore = creatorOverlapScore(reference, info.authors || []);
  const publisherScore = reference.publisher && normalizeForMatch(info.publisher).includes(normalizeForMatch(reference.publisher)) ? 1 : 0;
  const yearScore = reference.year && String(info.publishedDate || '').startsWith(reference.year) ? 1 : 0;
  return (isbnMatch ? 10 : 0)
    + titleScore * 5
    + (prefixMatch ? 2 : 0)
    + Math.min(2, creatorScore) * 2
    + publisherScore
    + yearScore;
}

async function findGoogleBooksSearchCover(reference) {
  if (!GOOGLE_BOOKS_API_KEY && !USE_PUBLIC_GOOGLE_BOOKS) return null;
  const candidates = [];
  for (const query of googleBooksQueries(reference)) {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('projection', 'lite');
    if (GOOGLE_BOOKS_API_KEY) url.searchParams.set('key', GOOGLE_BOOKS_API_KEY);
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(30_000) }, 2).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    for (const item of payload?.items || []) {
      const info = item.volumeInfo || {};
      const links = info.imageLinks || {};
      const imageUrls = googleBooksImageUrls(links);
      if (!imageUrls.length) continue;
      const score = googleBookScore(reference, info);
      if (score < (reference.isbns.length ? 5 : 6)) continue;
      for (const imageUrl of imageUrls) candidates.push({ item, imageUrl, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  for (const candidate of candidates.slice(0, 10)) {
    const filePath = await downloadImage(
      candidate.imageUrl,
      path.join(coverDir, `${reference.key}-google-search-${candidate.item.id || hashIndex(candidate.imageUrl)}`),
      { role: 'cover' },
    ).catch(() => null);
    if (filePath) {
      const info = candidate.item.volumeInfo || {};
      const isbnMatch = hasReferenceIsbn(reference, (info.industryIdentifiers || []).map((identifier) => identifier.identifier));
      return await coverAsset(filePath, isbnMatch ? 'google-books-search-isbn' : 'google-books-search', candidate.item.id || '');
    }
  }
  return null;
}

const COVER_IMAGE_GOOD_WORDS = [
  'book',
  'cover',
  'couverture',
  'frontcover',
  'jacket',
  'livre',
  'ouvrage',
  'product',
  '978',
  '979',
];

const COVER_IMAGE_BAD_WORDS = [
  'avatar',
  'banner',
  'captcha',
  'favicon',
  'footer',
  'header',
  'icon',
  'logo',
  'placeholder',
  'profile',
  'sprite',
  'transparent',
  'twitter',
];

function extractSrcsetUrl(value, base) {
  const candidates = String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/u)[0])
    .filter(Boolean);
  return absoluteUrl(candidates.at(-1), base);
}

function jsonLdScriptBlocks(html) {
  const blocks = [];
  const pattern = /<script\b(?=[^>]*type=['"]application\/ld\+json['"])[^>]*>([\s\S]*?)<\/script>/giu;
  let match = pattern.exec(String(html || ''));
  while (match) {
    blocks.push(decodeHtml(match[1]).trim());
    match = pattern.exec(String(html || ''));
  }
  return blocks;
}

function parseJsonLd(block) {
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

function collectImageValues(value, base, output, source, context = '') {
  if (!value) return;
  if (typeof value === 'string') {
    const url = absoluteUrl(value, base);
    if (url) output.push({ url, source, context });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectImageValues(entry, base, output, source, context));
    return;
  }
  if (typeof value === 'object') {
    collectImageValues(value.url || value.contentUrl || value.thumbnailUrl, base, output, source, context);
  }
}

function collectJsonLdCoverCandidates(node, base, output, depth = 0, inheritedContext = '') {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectJsonLdCoverCandidates(entry, base, output, depth + 1, inheritedContext));
    return;
  }
  if (typeof node !== 'object') return;
  const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '');
  const context = normalizeSpace([inheritedContext, type, node.name, node.title, node.author?.name].filter(Boolean).join(' '));
  collectImageValues(node.image, base, output, 'json-ld', context);
  collectImageValues(node.thumbnailUrl, base, output, 'json-ld', context);
  collectImageValues(node.primaryImageOfPage, base, output, 'json-ld', context);
  for (const key of ['@graph', 'mainEntity', 'workExample', 'exampleOfWork', 'offers', 'hasPart', 'isPartOf']) {
    collectJsonLdCoverCandidates(node[key], base, output, depth + 1, context);
  }
}

function imageContextScore(reference, candidate) {
  const normalized = normalizeForMatch(`${candidate.url} ${candidate.context || ''} ${candidate.source || ''}`);
  let score = 0;
  if (candidate.source === 'json-ld') score += 5;
  if (candidate.source === 'open-graph') score += 4;
  if (candidate.source === 'twitter') score += 3;
  if (candidate.source === 'image-src') score += 2;
  for (const word of COVER_IMAGE_GOOD_WORDS) {
    if (normalized.includes(word)) score += 1.25;
  }
  for (const word of COVER_IMAGE_BAD_WORDS) {
    if (normalized.includes(word)) score -= 4;
  }
  for (const isbn of reference.isbns || []) {
    if (isbn.length >= 10 && normalized.includes(isbn.toLowerCase())) score += 5;
  }
  for (const token of significantTokens(reference.title).slice(0, 5)) {
    if (normalized.includes(token)) score += 0.85;
  }
  for (const token of creatorMatchTokens(reference).slice(0, 3)) {
    if (normalized.includes(token)) score += 0.8;
  }
  return score;
}

function extractPageCoverCandidates(reference, html) {
  const base = publicUrl(reference.url);
  if (!base) return [];
  const candidates = [];
  const add = (url, source, context = '') => {
    const absolute = absoluteUrl(url, base);
    if (absolute) candidates.push({ url: absolute, source, context });
  };

  add(metaContent(html, ['og:image:secure_url', 'og:image']), 'open-graph', metaContent(html, ['og:title', 'twitter:title']));
  add(metaContent(html, ['twitter:image:src', 'twitter:image']), 'twitter', metaContent(html, ['twitter:title', 'og:title']));
  add(relationLinkHref(html, /(?:^|\s)image_src(?:\s|$)/iu), 'image-src');

  for (const block of jsonLdScriptBlocks(html)) {
    const parsed = parseJsonLd(block);
    collectJsonLdCoverCandidates(parsed, base, candidates);
  }

  const imageTags = html.match(/<img\b[^>]*>/giu) || [];
  for (const tag of imageTags.slice(0, 80)) {
    const src = getAttribute(tag, 'data-src')
      || getAttribute(tag, 'data-lazy-src')
      || getAttribute(tag, 'data-original')
      || getAttribute(tag, 'src')
      || extractSrcsetUrl(getAttribute(tag, 'srcset') || getAttribute(tag, 'data-srcset'), base);
    const context = [
      getAttribute(tag, 'alt'),
      getAttribute(tag, 'title'),
      getAttribute(tag, 'class'),
      getAttribute(tag, 'id'),
    ].filter(Boolean).join(' ');
    add(src, 'img', context);
  }

  const byUrl = new Map();
  for (const candidate of candidates) {
    if (!candidate.url) continue;
    const existing = byUrl.get(candidate.url);
    const score = imageContextScore(reference, candidate);
    if (!existing || score > existing.score) byUrl.set(candidate.url, { ...candidate, score });
  }
  return [...byUrl.values()]
    .filter((candidate) => candidate.score >= 2.5)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
}

async function findPageCover(reference, html, assetCache) {
  if (!COVER_OBJECT_TYPES.has(reference.itemType) || !reference.url || !html) return null;
  const cacheKey = `${COVER_PIPELINE_VERSION}:${reference.key}:${reference.version}:${reference.url}`;
  assetCache.pageCovers ||= {};
  const cached = assetCache.pageCovers[reference.key];
  if (cached?.cacheKey === cacheKey) {
    if (!cached.asset?.src) return null;
    const filePath = path.join(publicRoot, cached.asset.src);
    if (await exists(filePath) && await imageLooksUsable(filePath, 'cover')) return cached.asset;
  }

  const candidates = extractPageCoverCandidates(reference, html);
  for (const candidate of candidates) {
    const filePath = await downloadImage(
      candidate.url,
      path.join(coverDir, `${reference.key}-page-cover-${hashIndex(candidate.url)}`),
      { role: 'cover' },
    ).catch(() => null);
    if (!filePath) continue;
    const asset = await coverAsset(filePath, `source-page-${candidate.source}`, candidate.url);
    assetCache.pageCovers[reference.key] = { cacheKey, asset };
    return asset;
  }
  assetCache.pageCovers[reference.key] = { cacheKey, asset: null };
  return null;
}

async function findIsbnDbCover(reference) {
  if (!ISBNDB_API_KEY) return null;
  for (const isbn of reference.isbns) {
    const url = `https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`;
    const response = await fetchWithRetry(url, {
      headers: { Authorization: ISBNDB_API_KEY },
      signal: AbortSignal.timeout(30_000),
    }, 2).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const imageUrl = publicUrl(payload?.book?.image || payload?.book?.image_original || payload?.book?.cover);
    if (!imageUrl) continue;
    const filePath = await downloadImage(imageUrl.replace(/^http:/u, 'https:'), path.join(coverDir, `${reference.key}-isbndb-${isbn}`), { role: 'cover' }).catch(() => null);
    if (filePath) {
      return await coverAsset(filePath, 'isbndb', isbn);
    }
  }
  return null;
}

async function enrichCover(reference, assetCache) {
  const cacheKey = `${COVER_PIPELINE_VERSION}:${reference.key}:${reference.version}:${reference.isbns.join(',')}:${reference.coverUrl || ''}`;
  const cached = assetCache.covers?.[reference.key];
  if (cached?.cacheKey && cached.cacheKey === cacheKey && cached.asset?.src) {
    const filePath = path.join(publicRoot, cached.asset.src);
    if (await exists(filePath) && await imageLooksUsable(filePath, 'cover')) {
      if (!cached.asset.width || !cached.asset.height) {
        cached.asset = { ...cached.asset, ...await imageDimensions(filePath) };
      }
      return cached.asset;
    }
  }
  const canSearchByTitle = ['book', 'bookSection', 'thesis'].includes(reference.itemType)
    && reference.title
    && (reference.creators || []).length;
  if (!reference.coverUrl && !reference.isbns.length && !canSearchByTitle) return null;
  const asset = await findManualCover(reference)
    || await findOpenLibraryCover(reference)
    || await findOpenLibraryRelatedEditionCover(reference)
    || await findOpenLibrarySearchCover(reference)
    || await findGoogleBooksCover(reference)
    || await findGoogleBooksSearchCover(reference)
    || await findIsbnDbCover(reference);
  assetCache.covers[reference.key] = { cacheKey, asset };
  return asset;
}

async function fetchHtml(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30_000),
  }, 2).catch((error) => ({ ok: false, status: 0, error }));
  if (!response?.ok) {
    return {
      html: '',
      status: response?.status || 0,
      blocked: detectBlockedHtml('', response?.status || 0),
    };
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/html|xml/iu.test(contentType)) {
    return { html: '', status: response.status, blocked: false };
  }
  const html = await response.text().catch(() => '');
  return {
    html,
    status: response.status,
    blocked: detectBlockedHtml(html, response.status),
  };
}

function knownOembedEndpoint(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
    const match = OEMBED_ENDPOINTS.find((provider) => provider.hosts.some((candidate) => (
      host === candidate.replace(/^www\./u, '') || host.endsWith(`.${candidate.replace(/^www\./u, '')}`)
    )));
    return match?.endpoint || '';
  } catch {
    return '';
  }
}

async function downloadPreviewImage(url, reference, type, assetCache, cacheKey) {
  const cached = assetCache.previews?.[`${reference.key}:${type}`];
  if (cached?.cacheKey === cacheKey && cached.asset?.src && await assetPathExists(cached.asset)) {
    return cached.asset;
  }
  const imageUrl = publicUrl(String(url || '').replace(/^http:/u, 'https:'));
  if (!imageUrl) return null;
  const filePath = await downloadImage(imageUrl, path.join(previewDir, `${reference.key}-${type}`), { role: 'preview' }).catch(() => null);
  const asset = filePath
    ? {
      kind: type,
      src: mediaPath(filePath),
      source: imageUrl,
    }
    : null;
  assetCache.previews[`${reference.key}:${type}`] = { cacheKey, asset };
  return asset;
}

async function fetchOembedPayload(reference, html = '') {
  const url = publicUrl(reference.url);
  if (!url) return null;
  const endpoint = knownOembedEndpoint(url)
    || absoluteUrl(linkHref(html, /application\/json\+oembed/iu), url)
    || absoluteUrl(linkHref(html, /text\/xml\+oembed|application\/xml\+oembed/iu), url);
  if (!endpoint) return null;
  const requestUrl = new URL(endpoint);
  if (!requestUrl.searchParams.has('url')) requestUrl.searchParams.set('url', url);
  if (!requestUrl.searchParams.has('format') && !/\.json(?:$|\?)/iu.test(requestUrl.pathname)) {
    requestUrl.searchParams.set('format', 'json');
  }
  const response = await fetchWithRetry(requestUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  }, 2).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function enrichOembed(reference, html, assetCache) {
  const url = publicUrl(reference.url);
  if (!url) return null;
  const cacheKey = `${reference.key}:${reference.version}:${url}`;
  const cached = assetCache.embeds?.[reference.key];
  if (cached?.cacheKey === cacheKey && cached.embed) {
    if (!cached.embed.thumbnail?.src || await assetPathExists(cached.embed.thumbnail)) return cached.embed;
  }
  const payload = await fetchOembedPayload(reference, html);
  if (!payload) {
    assetCache.embeds[reference.key] = { cacheKey, embed: null };
    return null;
  }
  const thumbnail = await downloadPreviewImage(payload.thumbnail_url, reference, 'oembed', assetCache, `${cacheKey}:${payload.thumbnail_url || ''}`);
  const embed = {
    type: normalizeSpace(payload.type || ''),
    provider: normalizeSpace(payload.provider_name || ''),
    title: truncate(payload.title || reference.title, 180),
    authorName: normalizeSpace(payload.author_name || ''),
    html: payload.html || '',
    src: extractIframeSrc(payload.html || '', url),
    width: Number(payload.width || 0) || null,
    height: Number(payload.height || 0) || null,
    thumbnail,
  };
  assetCache.embeds[reference.key] = { cacheKey, embed };
  return embed;
}

async function enrichOpenGraph(reference, html, assetCache) {
  const url = publicUrl(reference.url);
  if (!url || !html) return null;
  const cacheKey = `${reference.key}:${reference.version}:${url}`;
  const cached = assetCache.openGraph?.[reference.key];
  if (cached?.cacheKey === cacheKey && cached.openGraph) {
    if (!cached.openGraph.image?.src || await assetPathExists(cached.openGraph.image)) return cached.openGraph;
  }
  const imageUrl = absoluteUrl(metaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']), url);
  const image = await downloadPreviewImage(imageUrl, reference, 'open-graph', assetCache, `${cacheKey}:${imageUrl || ''}`);
  const openGraph = {
    title: truncate(metaContent(html, ['og:title', 'twitter:title']) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || '', 180),
    description: truncate(metaContent(html, ['og:description', 'description', 'twitter:description']), 280),
    siteName: normalizeSpace(metaContent(html, ['og:site_name'])),
    url: absoluteUrl(metaContent(html, ['og:url']), url) || url,
    image,
  };
  assetCache.openGraph[reference.key] = { cacheKey, openGraph };
  return openGraph;
}

async function findWaybackArchive(reference, assetCache) {
  const url = publicUrl(reference.url);
  if (!url) return null;
  const cacheKey = `${reference.key}:${reference.version}:${url}`;
  const cached = assetCache.archives?.[reference.key];
  if (cached?.cacheKey === cacheKey) return cached.archive || null;
  const requestUrl = new URL('https://archive.org/wayback/available');
  requestUrl.searchParams.set('url', url);
  const response = await fetchWithRetry(requestUrl, { signal: AbortSignal.timeout(25_000) }, 2).catch(() => null);
  if (!response?.ok) {
    assetCache.archives[reference.key] = { cacheKey, archive: null };
    return null;
  }
  const payload = await response.json().catch(() => null);
  const closest = payload?.archived_snapshots?.closest;
  const archiveUrl = publicUrl(closest?.url || '');
  const archive = closest?.available && archiveUrl
    ? {
      url: archiveUrl,
      timestamp: closest.timestamp || '',
      status: closest.status || '',
    }
    : null;
  assetCache.archives[reference.key] = { cacheKey, archive };
  return archive;
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

async function captureScreenshot(reference, tools, assetCache, options = {}) {
  const url = publicUrl(options.url || reference.url);
  if (!tools || !url) return null;
  const isPdf = looksLikePublicPdfUrl(url);
  const kind = options.kind || (isPdf ? 'pdf-screenshot' : 'screenshot');
  const cacheId = `${reference.key}:${kind}`;
  const cacheKey = `${reference.key}:${reference.version}:${kind}:${url}`;
  const cached = assetCache.screenshots?.[cacheId];
  if (cached?.cacheKey === cacheKey) {
    if (cached.asset?.src) {
      const filePath = path.join(publicRoot, cached.asset.src);
      if (await exists(filePath)) return cached.asset;
    }
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
    const html = await page.content().catch(() => '');
    if (detectBlockedHtml(html)) {
      assetCache.screenshots[cacheId] = {
        cacheKey,
        asset: null,
        failed: true,
        blocked: true,
        error: 'blocked page',
      };
      return null;
    }
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 68,
      fullPage: false,
      animations: 'disabled',
    });
    let filePath = path.join(screenshotDir, `${reference.key}-${kind}.jpg`);
    if (tools.sharp) {
      filePath = path.join(screenshotDir, `${reference.key}-${kind}.webp`);
      await tools.sharp(jpeg)
        .resize(900, 534, { fit: 'contain', background: '#f1f2ee' })
        .webp({ quality: 68 })
        .toFile(filePath);
    } else {
      await fs.writeFile(filePath, jpeg);
    }
    const asset = {
      kind,
      src: mediaPath(filePath),
      source: url,
    };
    assetCache.screenshots[cacheId] = { cacheKey, asset };
    return asset;
  } catch (error) {
    assetCache.screenshots[cacheId] = {
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
    coverUrl: extractCoverUrl(data.extra),
    doi: normalizeSpace(data.DOI || ''),
    doiUrl: getDoiUrl(data.DOI || ''),
    url,
    publicPdfUrl: looksLikePublicPdfUrl(url) ? url : '',
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
    embed: null,
    openGraph: null,
    archive: null,
    screenshot: null,
    fallback: null,
    asset: null,
    previewStatus: {
      source: 'pending',
      blocked: false,
      reason: '',
    },
    layout: null,
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
  if (COVER_OBJECT_TYPES.has(reference.itemType)) {
    return reference.cover || reference.fallback || reference.embed?.thumbnail || reference.openGraph?.image || reference.archive?.asset || reference.screenshot;
  }
  return reference.cover
    || reference.embed?.thumbnail
    || reference.openGraph?.image
    || reference.archive?.asset
    || reference.screenshot
    || reference.fallback;
}

function shouldCaptureVisual(reference) {
  if (!reference.url) return false;
  if (COVER_OBJECT_TYPES.has(reference.itemType)) return false;
  if (reference.cover || reference.embed?.thumbnail || reference.openGraph?.image || reference.archive?.asset) return false;
  if (reference.publicPdfUrl) return !reference.cover;
  return WEB_CAPTURE_TYPES.has(reference.itemType) || !reference.cover;
}

function objectSize(reference, index) {
  const kind = reference.asset?.kind || 'fallback';
  const shared = reference.memoirKeys.length > 1;
  if (kind === 'cover') return { width: shared ? 250 : 220, height: shared ? 360 : 320 };
  if (kind === 'fallback') return { width: shared ? 260 : 225, height: shared ? 360 : 320 };
  if (kind === 'oembed' || kind === 'open-graph' || kind === 'archive' || kind === 'screenshot') {
    const wide = index % 5 === 0 || shared;
    return { width: wide ? 430 : 340, height: wide ? 290 : 230 };
  }
  return { width: 260, height: 320 };
}

function computeAtlasLayout(references, memoirs) {
  const center = { x: ATLAS_WIDTH / 2, y: ATLAS_HEIGHT / 2 };
  const memoirCenters = new Map();
  const radiusX = 1040;
  const radiusY = 650;
  memoirs.forEach((memoir, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, memoirs.length)) * Math.PI * 2;
    memoirCenters.set(memoir.key, {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    });
  });

  const perMemoirIndex = new Map();
  references.forEach((reference, index) => {
    const primaryKey = reference.memoirKeys.length > 1 ? 'shared' : reference.memoirKeys[0];
    const order = perMemoirIndex.get(primaryKey) || 0;
    perMemoirIndex.set(primaryKey, order + 1);
    const base = primaryKey === 'shared'
      ? center
      : (memoirCenters.get(primaryKey) || center);
    const localAngle = hashIndex(`${reference.key}:angle`, 360) * (Math.PI / 180);
    const ring = 110 + Math.floor(order / 4) * 145;
    const drift = (order % 4) * 48;
    const size = objectSize(reference, index);
    const x = Math.round(Math.max(60, Math.min(ATLAS_WIDTH - size.width - 60, base.x + Math.cos(localAngle) * (ring + drift) - size.width / 2)));
    const y = Math.round(Math.max(70, Math.min(ATLAS_HEIGHT - size.height - 70, base.y + Math.sin(localAngle) * (ring + drift) - size.height / 2)));
    reference.layout = {
      index: index + 1,
      x,
      y,
      width: size.width,
      height: size.height,
      rotation: 0,
      layer: reference.memoirKeys.length > 1 ? 3 : (reference.annotations.count > 0 ? 2 : 1),
    };
  });

  return {
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    memoirCenters: memoirs.map((memoir) => ({
      key: memoir.key,
      name: memoir.name,
      x: Math.round(memoirCenters.get(memoir.key)?.x || center.x),
      y: Math.round(memoirCenters.get(memoir.key)?.y || center.y),
    })),
  };
}

function yearDescriptor(rootCollection, year, activeCollections, items, sharedContext) {
  const memoirs = activeCollections
    .filter((collection) => (collection.data?.parentCollection || false) === rootCollection.key)
    .filter((collection) => isMemoirCollectionName(collection.data?.name))
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
  const context = { ...sharedContext, memoirByKey };
  const references = selectedTopItems
    .map((item) => normalizeReference(item, context))
    .sort((left, right) => (
      left.title.localeCompare(right.title, 'fr')
      || left.key.localeCompare(right.key)
    ));
  return {
    year,
    rootCollection,
    memoirs,
    selectedTopItems,
    references,
  };
}

function copyReferenceEnrichments(target, source) {
  for (const field of CATALOG_ENRICHMENT_FIELDS) target[field] = source[field] ?? null;
}

function createYearCatalog(descriptor, metadata) {
  const { references, memoirs, rootCollection, selectedTopItems, year } = descriptor;
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
  return {
    generatedAt: metadata.generatedAt,
    source: {
      groupId: GROUP_ID,
      groupName: selectedTopItems[0]?.library?.name || metadata.groupName,
      groupUrl: selectedTopItems[0]?.library?.links?.alternate?.href || metadata.groupUrl,
      rootCollectionKey: rootCollection.key,
      rootCollectionName: year.label,
      rootCollectionUrl: rootCollection.links?.alternate?.href || '',
      libraryVersion: metadata.libraryVersion,
      yearId: year.id,
    },
    stats: {
      memoirCount: memoirsWithStats.length,
      referenceCount: references.length,
      sharedReferenceCount: sharedReferences.length,
      annotationCount: references.reduce((sum, reference) => sum + reference.annotations.count, 0),
      noteCount: references.reduce((sum, reference) => sum + reference.notes.length, 0),
      attachmentCount: references.reduce((sum, reference) => sum + reference.attachments.count, 0),
    },
    layout: computeAtlasLayout(references, memoirs),
    memoirs: memoirsWithStats,
    references,
    sharedReferences,
  };
}

async function main() {
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(catalogsDir, { recursive: true }),
    fs.mkdir(coverDir, { recursive: true }),
    fs.mkdir(previewDir, { recursive: true }),
    fs.mkdir(screenshotDir, { recursive: true }),
    fs.mkdir(fallbackDir, { recursive: true }),
    fs.mkdir(cacheDir, { recursive: true }),
  ]);

  const assetCache = {
    covers: {},
    pageCovers: {},
    embeds: {},
    openGraph: {},
    previews: {},
    archives: {},
    screenshots: {},
    ...(await readJson(assetCacheFile, {})),
  };
  assetCache.covers ||= {};
  assetCache.pageCovers ||= {};
  assetCache.embeds ||= {};
  assetCache.openGraph ||= {};
  assetCache.previews ||= {};
  assetCache.archives ||= {};
  assetCache.screenshots ||= {};

  log(`Collecting Zotero group ${GROUP_ID}...`);
  const [{ items: collections, libraryVersion: collectionVersion }, { items, libraryVersion: itemVersion }] = await Promise.all([
    zoteroAll('/collections'),
    zoteroAll('/items', { include: 'data', includeTrashed: '0' }),
  ]);

  const activeCollections = collections.filter((collection) => !collection.data?.deleted);
  const yearRoots = activeCollections
    .filter((collection) => (collection.data?.parentCollection || false) === false)
    .map((rootCollection) => ({
      rootCollection,
      year: memoirYearCollection(rootCollection.data?.name),
    }))
    .filter(({ rootCollection, year }) => (
      year
      && (!ROOT_COLLECTION_FILTER || rootCollection.data?.name === ROOT_COLLECTION_FILTER)
    ))
    .sort((left, right) => right.year.startYear - left.year.startYear);
  if (!yearRoots.length) {
    const suffix = ROOT_COLLECTION_FILTER ? ` matching ${ROOT_COLLECTION_FILTER}` : '';
    throw new Error(`No root collection named Mémoires YYYY-YY${suffix}`);
  }

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
  const sharedContext = { attachmentsByParent, notesByParent, annotationsByAttachment };
  const descriptors = yearRoots.map(({ rootCollection, year }) => (
    yearDescriptor(rootCollection, year, activeCollections, items, sharedContext)
  ));
  const uniqueReferenceByKey = new Map();
  for (const descriptor of descriptors) {
    for (const reference of descriptor.references) {
      if (!uniqueReferenceByKey.has(reference.key)) uniqueReferenceByKey.set(reference.key, reference);
    }
    log(`Found ${descriptor.memoirs.length} memoir collections and ${descriptor.references.length} references for ${descriptor.year.id}.`);
  }
  const references = [...uniqueReferenceByKey.values()];

  log(`Enriching ${references.length} unique references across ${descriptors.length} year catalog(s).`);
  log('Enriching covers, embeds, page metadata and fallback cards...');
  for (const reference of references) {
    reference.cover = await enrichCover(reference, assetCache);
    reference.fallback = await generateFallbackAsset(reference);
  }

  for (const reference of references) {
    if (!reference.url) {
      reference.previewStatus = { source: 'fallback', blocked: false, reason: 'no-url' };
      continue;
    }
    const page = await fetchHtml(reference.url);
    reference.previewStatus = {
      source: 'pending',
      blocked: page.blocked,
      reason: page.blocked ? 'blocked-live-page' : '',
    };
    if (!page.blocked && page.html) {
      if (!reference.cover && COVER_OBJECT_TYPES.has(reference.itemType)) {
        reference.cover = await findPageCover(reference, page.html, assetCache);
      }
      reference.embed = await enrichOembed(reference, page.html, assetCache);
      reference.openGraph = await enrichOpenGraph(reference, page.html, assetCache);
    }
    if (page.blocked || (!reference.cover && !reference.embed?.thumbnail && !reference.openGraph?.image)) {
      reference.archive = await findWaybackArchive(reference, assetCache);
    }
  }

  const screenshotTools = await loadScreenshotTools();
  if (screenshotTools) {
    let captured = 0;
    const captureCandidates = references.filter((reference) => (
      reference.url
      && !COVER_OBJECT_TYPES.has(reference.itemType)
      && !reference.cover
      && !reference.embed?.thumbnail
      && !reference.openGraph?.image
    ));
    log(`Capturing up to ${SCREENSHOT_LIMIT} final preview fallbacks...`);
    for (const reference of captureCandidates) {
      if (captured >= SCREENSHOT_LIMIT) break;
      if (reference.archive?.url) {
        const asset = await captureScreenshot(reference, screenshotTools, assetCache, {
          url: reference.archive.url,
          kind: 'archive',
        });
        if (asset) {
          reference.archive.asset = asset;
          captured += 1;
          continue;
        }
      }
      if (shouldCaptureVisual(reference)) {
        reference.screenshot = await captureScreenshot(reference, screenshotTools, assetCache);
        if (reference.screenshot) captured += 1;
      }
    }
    await screenshotTools.browser.close().catch(() => {});
  }

  for (const reference of references) {
    reference.asset = chooseCardAsset(reference);
    reference.previewStatus = {
      ...(reference.previewStatus || {}),
      source: reference.asset?.kind || 'none',
      blocked: Boolean(reference.previewStatus?.blocked),
      reason: reference.previewStatus?.reason || '',
    };
  }

  for (const descriptor of descriptors) {
    for (const reference of descriptor.references) {
      copyReferenceEnrichments(reference, uniqueReferenceByKey.get(reference.key));
    }
  }

  const generatedAt = new Date().toISOString();
  const libraryVersion = Number(itemVersion || collectionVersion || 0) || null;
  const allSelectedItems = descriptors.flatMap((descriptor) => descriptor.selectedTopItems);
  const groupName = allSelectedItems[0]?.library?.name || 'EnsadNancy';
  const groupUrl = allSelectedItems[0]?.library?.links?.alternate?.href || `https://www.zotero.org/groups/${GROUP_ID}`;
  const catalogs = descriptors.map((descriptor) => ({
    descriptor,
    catalog: createYearCatalog(descriptor, {
      generatedAt,
      groupName,
      groupUrl,
      libraryVersion,
    }),
  }));
  const referenceYears = {};
  for (const { descriptor, catalog } of catalogs) {
    const catalogPath = path.join(catalogsDir, `${descriptor.year.id}.json`);
    await writeJson(catalogPath, catalog);
    for (const reference of catalog.references) {
      referenceYears[reference.key] ||= [];
      referenceYears[reference.key].push(descriptor.year.id);
    }
    log(`Wrote ${path.relative(projectRoot, catalogPath)}.`);
  }

  const defaultCatalog = catalogs[0].catalog;
  const catalogIndex = {
    generatedAt,
    defaultYear: catalogs[0].descriptor.year.id,
    group: {
      id: GROUP_ID,
      name: groupName,
      url: groupUrl,
      libraryVersion,
    },
    years: catalogs.map(({ descriptor, catalog }) => ({
      id: descriptor.year.id,
      label: descriptor.year.label,
      catalog: `data/catalogs/${descriptor.year.id}.json`,
      rootCollectionUrl: catalog.source.rootCollectionUrl,
      stats: catalog.stats,
      generatedAt: catalog.generatedAt,
    })),
    referenceYears,
  };

  await writeJson(path.join(dataDir, 'catalog-index.json'), catalogIndex);
  await writeJson(path.join(dataDir, 'catalog.json'), defaultCatalog);
  await writeJson(assetCacheFile, assetCache);
  log(`Wrote ${path.relative(projectRoot, path.join(dataDir, 'catalog-index.json'))} and latest catalog alias.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
