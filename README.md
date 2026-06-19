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

La collecte cible le groupe `6584095` et la collection `Mémoires 2026-27`. Elle génère `public/data/catalog.json` et les médias associés dans `public/media/`.

Les clés optionnelles se configurent dans un fichier local `.env.local` :

```env
GOOGLE_BOOKS_API_KEY=
ISBNDB_API_KEY=
```

## Déploiement

GitHub Actions collecte les données, construit l’application et la publie sur GitHub Pages à chaque push sur `main` et une fois par jour.

Les clés API de production sont enregistrées dans les secrets GitHub Actions.
