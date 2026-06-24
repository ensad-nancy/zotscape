# Zotscape

Interface React/Vite pour explorer une collection de références Zotero sous forme d’atlas ou de liste éditoriale.

Le site est entièrement statique : les données et médias sont générés avant le build, puis publiés sur GitHub Pages.

## Développement

```sh
npm install
npm run collect:fast
npm run dev
```

```sh
npm run build
npm run audit:data
npm run smoke
```

## Collecte Zotero

```sh
npm run collect
```

La collecte lit `zotscape.config.json`, qui déclare les groupes Zotero publics à collecter, la collection racine ouverte par défaut et l’option d’affichage à l’échelle physique.

```json
{
  "sources": [
    { "groupId": 6584095, "label": "EnsadNancy" },
    { "groupId": 5231865, "label": "Acclimatements" }
  ],
  "defaultRoot": { "groupId": 6584095, "collectionKey": "F5GTTQ2J" },
  "physicalScale": true
}
```

Chaque collection racine Zotero devient un catalogue, identifié par `groupId:collectionKey`. Ses sous-dossiers deviennent les sous-collections filtrables ; lorsqu’une racine n’a pas de sous-dossier, la racine elle-même sert de sous-collection. La collecte recrée `public/data/`, génère `public/data/catalog-index.json`, les catalogues dans `public/data/catalogs/` et les médias dans `public/media/`.

La récupération des couvertures utilise notamment Open Library, Google Books, la BnF et Inventaire. Lorsque seule une pièce jointe PDF publique est disponible, la collecte peut rasteriser sa première page éditoriale avec Poppler (`pdftoppm` et `pdftotext`). Ce fallback est ignoré sans faire échouer la collecte si Poppler n’est pas installé (`brew install poppler` sur macOS).

Les clés optionnelles se configurent dans un fichier local `.env.local` :

```env
GOOGLE_BOOKS_API_KEY=
ISBNDB_API_KEY=
```

La collecte parallélise les pages Zotero, les enrichissements médias, les mesures physiques et les captures avec des limites prudentes adaptées à GitHub Actions. Elle conserve aussi un cache Zotero versionné dans `.cache/` et le met à jour via les changements depuis la dernière version connue. Les rasters téléchargés sont normalisés en WebP sans recadrage (`fit: inside`). Les réglages optionnels sont documentés dans `.env.example` (`ZOTSCAPE_ENRICH_CONCURRENCY`, `ZOTSCAPE_ZOTERO_PAGE_CONCURRENCY`, `ZOTSCAPE_SCREENSHOT_CONCURRENCY`, `ZOTSCAPE_WEB_CACHE_TTL_HOURS`, `ZOTSCAPE_PRUNE_MEDIA`, etc.).

`npm run audit:data` vérifie la configuration, l’index, les catalogues et les médias référencés. `npm run smoke` sert le build `dist/` et vérifie les parcours critiques avec Playwright.

## Déploiement

GitHub Actions collecte les données, restaure le cache des enrichissements, construit l’application et la publie sur GitHub Pages à chaque push sur `main` et une fois par jour.

Les clés API de production sont enregistrées dans les secrets GitHub Actions.
