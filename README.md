# Zotscape

Interface React/Vite pour explorer les références du groupe Zotero public EnsadNancy sous forme d’atlas ou de liste éditoriale.

Le site est entièrement statique : les données et médias sont générés avant le build, puis publiés sur GitHub Pages.

## Développement

```sh
npm install
npm run collect:fast
npm run dev
```

```sh
npm run build
```

## Collecte Zotero

```sh
npm run collect
```

La collecte cible le groupe `6584095` et détecte automatiquement les collections racines nommées `Mémoires YYYY-YY`. Elle génère un catalogue par promotion, un index des archives et l’alias courant `public/data/catalog.json`. Les médias associés sont écrits dans `public/media/`.

La récupération des couvertures utilise notamment Open Library, Google Books, la BnF et Inventaire. Lorsque seule une pièce jointe PDF publique est disponible, la collecte peut rasteriser sa première page éditoriale avec Poppler (`pdftoppm` et `pdftotext`). Ce fallback est ignoré sans faire échouer la collecte si Poppler n’est pas installé (`brew install poppler` sur macOS).

Les clés optionnelles se configurent dans un fichier local `.env.local` :

```env
GOOGLE_BOOKS_API_KEY=
ISBNDB_API_KEY=
```

La collecte parallélise les pages Zotero, les enrichissements médias et les captures avec des limites prudentes adaptées à GitHub Actions. Elle conserve aussi un cache Zotero versionné dans `.cache/` et le met à jour via les changements depuis la dernière version connue. Les réglages optionnels sont documentés dans `.env.example` (`ZOTSCAPE_ENRICH_CONCURRENCY`, `ZOTSCAPE_ZOTERO_PAGE_CONCURRENCY`, `ZOTSCAPE_SCREENSHOT_CONCURRENCY`, `ZOTSCAPE_WEB_CACHE_TTL_HOURS`, etc.).

## Déploiement

GitHub Actions collecte les données, restaure le cache des enrichissements, construit l’application et la publie sur GitHub Pages à chaque push sur `main` et une fois par jour.

Les clés API de production sont enregistrées dans les secrets GitHub Actions.
