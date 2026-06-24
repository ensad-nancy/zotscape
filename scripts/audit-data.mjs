import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(__dirname, '..');

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizePublicMediaSrc(projectRoot, src) {
  if (!src || /^https?:\/\//iu.test(src) || /^data:/iu.test(src)) return '';
  const clean = String(src).replace(/^\/+/u, '');
  if (!clean.startsWith('media/')) return '';
  const publicRoot = path.join(projectRoot, 'public');
  const fullPath = path.resolve(publicRoot, clean);
  if (!fullPath.startsWith(publicRoot)) return '';
  return fullPath;
}

function collectReferencedMedia(projectRoot, value, output) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectReferencedMedia(projectRoot, entry, output));
    return;
  }
  if (typeof value.src === 'string') {
    const mediaPath = normalizePublicMediaSrc(projectRoot, value.src);
    if (mediaPath) output.add(mediaPath);
  }
  Object.values(value).forEach((entry) => collectReferencedMedia(projectRoot, entry, output));
}

function rootId(defaultRoot = {}) {
  const groupId = Number(defaultRoot.groupId);
  const collectionKey = String(defaultRoot.collectionKey || '').trim();
  return Number.isInteger(groupId) && groupId > 0 && collectionKey ? `${groupId}:${collectionKey}` : '';
}

export async function auditData(options = {}) {
  const projectRoot = options.projectRoot || defaultProjectRoot;
  const publicRoot = path.join(projectRoot, 'public');
  const dataDir = path.join(publicRoot, 'data');
  const catalogsDir = path.join(dataDir, 'catalogs');
  const configPath = path.join(projectRoot, 'zotscape.config.json');
  const indexPath = path.join(dataDir, 'catalog-index.json');
  const errors = [];
  const warnings = [];
  const referencedMedia = new Set();
  const expectedCatalogFiles = new Set();
  const uniqueReferenceKeys = new Set();

  const config = await readJson(configPath).catch((error) => {
    errors.push(`zotscape.config.json unreadable: ${error.message}`);
    return null;
  });
  if (!Array.isArray(config?.sources) || !config.sources.length) {
    errors.push('zotscape.config.json must declare at least one source.');
  }

  if (await exists(path.join(dataDir, 'catalog.json'))) {
    errors.push('Legacy public/data/catalog.json is present; collect should only emit catalog-index.json and data/catalogs/*.json.');
  }

  const index = await readJson(indexPath).catch((error) => {
    errors.push(`public/data/catalog-index.json unreadable: ${error.message}`);
    return null;
  });
  const collections = Array.isArray(index?.collections) ? index.collections : [];
  if (!collections.length) errors.push('catalog-index.json contains no collections.');
  const collectionIds = new Set(collections.map((entry) => entry.id));
  if (index?.defaultRoot && !collectionIds.has(index.defaultRoot)) {
    errors.push(`defaultRoot ${index.defaultRoot} is not listed in catalog-index collections.`);
  }
  const configuredDefaultRoot = rootId(config?.defaultRoot);
  if (configuredDefaultRoot && index?.defaultRoot && configuredDefaultRoot !== index.defaultRoot) {
    errors.push(`configured defaultRoot ${configuredDefaultRoot} does not match generated defaultRoot ${index.defaultRoot}.`);
  }

  for (const entry of collections) {
    const catalogRelPath = String(entry.catalog || '').replace(/^\/+/u, '');
    if (!catalogRelPath.startsWith('data/catalogs/') || catalogRelPath.includes('..')) {
      errors.push(`Invalid catalog path for ${entry.id || 'unknown collection'}: ${entry.catalog || '(empty)'}`);
      continue;
    }
    const catalogPath = path.join(publicRoot, catalogRelPath);
    expectedCatalogFiles.add(path.resolve(catalogPath));
    const catalog = await readJson(catalogPath).catch((error) => {
      errors.push(`${entry.catalog} unreadable: ${error.message}`);
      return null;
    });
    if (!catalog) continue;
    if (catalog.source?.rootId && catalog.source.rootId !== entry.id) {
      errors.push(`${entry.catalog} source.rootId ${catalog.source.rootId} does not match index id ${entry.id}.`);
    }
    const references = Array.isArray(catalog.references) ? catalog.references : [];
    if ((entry.stats?.referenceCount || 0) !== references.length) {
      errors.push(`${entry.catalog} has ${references.length} references but index reports ${entry.stats?.referenceCount || 0}.`);
    }
    references.forEach((reference) => {
      if (reference?.key) uniqueReferenceKeys.add(reference.key);
    });
    collectReferencedMedia(projectRoot, catalog, referencedMedia);
  }

  const actualCatalogFiles = (await listFiles(catalogsDir))
    .filter((filePath) => filePath.endsWith('.json'))
    .map((filePath) => path.resolve(filePath));
  for (const filePath of actualCatalogFiles) {
    if (!expectedCatalogFiles.has(filePath)) {
      errors.push(`Obsolete catalog file is present: ${path.relative(projectRoot, filePath)}`);
    }
  }

  const unexpectedDataFiles = (await fs.readdir(dataDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.name !== 'catalog-index.json' && entry.name !== 'catalogs')
    .map((entry) => entry.name);
  if (unexpectedDataFiles.length) {
    errors.push(`Unexpected file(s) in public/data: ${unexpectedDataFiles.join(', ')}`);
  }

  for (const mediaPath of referencedMedia) {
    if (!await exists(mediaPath)) {
      errors.push(`Referenced media is missing: ${path.relative(projectRoot, mediaPath)}`);
    }
  }

  const generatedReferenceCount = Number(index?.stats?.referenceCount || 0);
  if (generatedReferenceCount && generatedReferenceCount !== uniqueReferenceKeys.size) {
    errors.push(`catalog-index stats.referenceCount=${generatedReferenceCount} but catalogs contain ${uniqueReferenceKeys.size} unique references.`);
  }
  if (!generatedReferenceCount) {
    warnings.push('catalog-index stats.referenceCount is missing or zero.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    catalogCount: collections.length,
    referenceCount: uniqueReferenceKeys.size,
    mediaCount: referencedMedia.size,
    referencedMedia,
  };
}

export async function pruneUnreferencedMedia(options = {}) {
  const projectRoot = options.projectRoot || defaultProjectRoot;
  const referencedMedia = options.referencedMedia || new Set();
  const mediaDir = path.join(projectRoot, 'public', 'media');
  const generatedDirs = ['covers', 'previews', 'screenshots', 'fallbacks'];
  const removed = [];
  for (const dir of generatedDirs) {
    const root = path.join(mediaDir, dir);
    for (const filePath of await listFiles(root)) {
      const resolved = path.resolve(filePath);
      if (referencedMedia.has(resolved)) continue;
      await fs.rm(resolved, { force: true });
      removed.push(path.relative(projectRoot, resolved));
    }
  }
  return { removed };
}

async function main() {
  const result = await auditData();
  if (process.argv.includes('--prune-media')) {
    const pruneResult = await pruneUnreferencedMedia({ referencedMedia: result.referencedMedia });
    console.log(`Pruned ${pruneResult.removed.length} unreferenced media file(s).`);
  }
  const printable = {
    ok: result.ok,
    catalogCount: result.catalogCount,
    referenceCount: result.referenceCount,
    mediaCount: result.mediaCount,
    warnings: result.warnings,
    errors: result.errors,
  };
  console.log(JSON.stringify(printable, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
