# Zotscape

Interface statique React/Vite pour parcourir visuellement les références du groupe Zotero public EnsadNancy.

## Commandes

```sh
npm install
npm run collect
npm run dev
npm run build
```

`npm run collect` lit le groupe Zotero `6584095`, cible la collection `Mémoires 2026-27`, enrichit les références avec des couvertures et quelques captures de pages publiques, puis écrit `public/data/catalog.json` et les images dans `public/media/`.

Pour une collecte rapide sans captures Playwright :

```sh
npm run collect:fast
```

## Données

Le site de production ne contacte pas Zotero au chargement. Il lit uniquement les fichiers statiques générés dans `public/`, ce qui permet une publication GitHub Pages et une mise à jour par cron.
