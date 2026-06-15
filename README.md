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

## Cles API optionnelles

Open Library ne demande pas de cle API pour les couvertures. Les requetes sont publiques, mais limitees en debit.

Pour ameliorer la recherche de covers, creer un fichier local non versionne :

```sh
cp .env.example .env.local
```

Puis renseigner au besoin :

```sh
GOOGLE_BOOKS_API_KEY=...
ISBNDB_API_KEY=...
```

Le collecteur lit automatiquement `.env.local`, puis `.env`, sans remplacer les variables deja definies par le shell ou GitHub Actions.

Sur GitHub Pages, declarer les memes noms dans `Settings > Secrets and variables > Actions`, puis les exposer au job de collecte si necessaire.

Le pipeline de covers reste entierement automatique et compatible GitHub Pages :

- ISBN exact et editions proches via Open Library / Internet Archive ;
- recherche Google Books scoree par ISBN, titre, auteur, editeur et annee quand `GOOGLE_BOOKS_API_KEY` est disponible ;
- extraction prudente des images declarees par les pages sources (`schema.org`, Open Graph, `image_src`) pour les livres, memoires et theses ;
- fallback ISBNdb si `ISBNDB_API_KEY` est disponible ;
- aucune requete API au chargement du site public.

Goodreads n'est pas utilise comme source automatique : son API publique historique n'est plus disponible pour de nouvelles integrations et le scraping de pages Goodreads serait fragile pour GitHub Actions.

## Données

Le site de production ne contacte pas Zotero au chargement. Il lit uniquement les fichiers statiques générés dans `public/`, ce qui permet une publication GitHub Pages et une mise à jour par cron.
