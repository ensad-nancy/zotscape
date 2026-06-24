import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .trim();
}

function slugifyHashPart(value, fallback = 'reference') {
  return normalize(value || fallback)
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72)
    .replace(/-+$/gu, '') || fallback;
}

function referenceHashPath(reference) {
  const title = slugifyHashPart(reference?.title, 'reference');
  const key = slugifyHashPart(reference?.citationKey || reference?.key, String(reference?.key || 'reference').toLowerCase());
  return `${title}--${key}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function startStaticServer() {
  await fs.access(path.join(distDir, 'index.html'));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/u, '');
      const requestedPath = cleanPath ? path.join(distDir, cleanPath) : path.join(distDir, 'index.html');
      const resolvedPath = path.resolve(requestedPath);
      if (!resolvedPath.startsWith(distDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const stat = await fs.stat(resolvedPath).catch(() => null);
      const filePath = stat?.isFile() ? resolvedPath : path.join(distDir, 'index.html');
      const extension = path.extname(filePath).toLowerCase();
      response.writeHead(200, { 'content-type': contentTypes[extension] || 'application/octet-stream' });
      response.end(await fs.readFile(filePath));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/`,
  };
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    for (const channel of ['chrome', 'msedge']) {
      try {
        return await chromium.launch({ channel, headless: true });
      } catch {
        // Keep trying known system browser channels before surfacing the Playwright install error.
      }
    }
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const index = await readJson(path.join(distDir, 'data', 'catalog-index.json'));
  const firstCatalogEntry = index.collections?.[0];
  assert(firstCatalogEntry, 'No collection in dist/data/catalog-index.json.');
  const firstCatalog = await readJson(path.join(distDir, firstCatalogEntry.catalog));
  const deepLinkReference = firstCatalog.references?.find((reference) => reference?.title && reference?.key);
  assert(deepLinkReference, `No reference found in ${firstCatalogEntry.catalog}.`);

  const { server, url: baseUrl } = await startStaticServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForSelector('.atlas-object-main', { timeout: 10_000 });
    const rootState = await page.evaluate(() => ({
      objects: document.querySelectorAll('.atlas-object-main').length,
      title: document.querySelector('.atlas-title h1')?.textContent.trim() || '',
      hasBrandText: (document.querySelector('.brand-link')?.textContent || '').trim().length > 0,
    }));
    assert(rootState.objects > 0, 'Root page rendered no atlas objects.');
    assert(rootState.title, 'Root page has no collection title.');
    assert(!rootState.hasBrandText, 'Header brand link should expose only the pictogram visually.');

    await page.getByRole('button', { name: 'Vue liste' }).click();
    await page.waitForSelector('.reference-list-row', { timeout: 10_000 });
    const listRows = await page.locator('.reference-list-row').count();
    assert(listRows > 0, 'List view rendered no rows.');

    await page.getByRole('button', { name: 'Ouvrir les filtres' }).click();
    await page.locator('#reference-search').fill('nova');
    await page.waitForTimeout(100);
    const filteredRows = await page.locator('.reference-list-row').count();
    assert(filteredRows > 0, 'Search filter returned no rows for "nova".');

    const deepLinkUrl = `${baseUrl}#${referenceHashPath(deepLinkReference)}?root=all`;
    await page.goto(deepLinkUrl, { waitUntil: 'load' });
    await page.waitForSelector('.detail-panel', { timeout: 10_000 });
    const deepLinkState = await page.evaluate((expectedTitle) => {
      const visibleLinks = [...document.querySelectorAll('a[href]')].filter((link) => {
        const rect = link.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth;
      });
      return {
        objects: document.querySelectorAll('.atlas-object-main').length,
        detailTitle: document.querySelector('.detail-body h2')?.textContent.trim() || '',
        badExternalLinks: visibleLinks.filter((link) => (
          /^https?:\/\//iu.test(link.getAttribute('href') || '')
          && (link.getAttribute('target') !== '_blank' || !String(link.getAttribute('rel') || '').includes('noopener'))
        )).map((link) => link.getAttribute('href')),
        expectedTitle,
      };
    }, deepLinkReference.title);
    assert(deepLinkState.objects > 0, 'Deep link rendered no atlas objects.');
    assert(deepLinkState.detailTitle === deepLinkReference.title, `Deep link opened "${deepLinkState.detailTitle}" instead of "${deepLinkReference.title}".`);
    assert(deepLinkState.badExternalLinks.length === 0, `External links missing target/rel: ${deepLinkState.badExternalLinks.join(', ')}`);

    assert(errors.length === 0, `Browser console/page errors:\n${errors.join('\n')}`);
    console.log(JSON.stringify({
      ok: true,
      rootObjects: rootState.objects,
      listRows,
      filteredRows,
      deepLinkTitle: deepLinkState.detailTitle,
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
