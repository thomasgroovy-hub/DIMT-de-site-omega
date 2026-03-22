# Pole de maintenance

Application web interne complete pour gerer l'information, la maintenance et le service avec persistance SQLite, authentification interne, roles et webhook Discord.

## Fonctionnalites

- Authentification interne avec creation de compte et connexion sur une page unique
- Hash des mots de passe avec `bcryptjs`
- Roles `administrateur`, `moderateur`, `spectateur`
- Dashboard en trois onglets: `Information`, `Maintenance`, `Service`
- Widgets texte/image drag and drop, redimensionnables et sauvegardes automatiquement
- Tableau de maintenance dynamique persistant
- Prise et fin de service avec envoi Discord en embed
- Rapports d'incident et de service avec signature canvas et envoi Discord en embed
- Verification des permissions cote serveur
- Stockage persistant en SQLite

## Stack

- Node.js 20+
- Express
- SQLite via `better-sqlite3`
- Sessions serveur via `express-session` + `connect-sqlite3`
- Upload d'images via `multer`

## Lancement

1. Installer Node.js 20 ou plus.
2. Installer les dependances:

```bash
npm install
```

3. Definir au besoin les variables d'environnement:

```bash
SESSION_SECRET=un-secret-fort
DISCORD_WEBHOOK_URL=votre-webhook
PORT=3000
```

4. Demarrer l'application:

```bash
npm start
```

5. Ouvrir [http://localhost:3000](http://localhost:3000)

## Deploiement Railway

Le projet est maintenant pret pour Railway via le `Dockerfile`.

1. Creer un nouveau projet Railway depuis ce repository GitHub.
2. Ajouter un volume persistant Railway et le monter sur `/data`.
3. Definir ces variables Railway:

```bash
NODE_ENV=production
SESSION_SECRET=un-secret-tres-fort
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
STORAGE_DIR=/data
```

4. Railway detectera automatiquement le `Dockerfile` et lancera `npm start`.
5. Configurer le healthcheck sur `/health`.

Important:

- SQLite et les fichiers uploades doivent rester sur le volume monte sur `/data`, sinon ils seront perdus au redeploiement.
- GitHub Pages ne peut pas faire tourner cette application car un backend Node/SQLite est requis.

## Regles integrees

- Les nouveaux comptes sont `spectateur` par defaut.
- Toutes les validations sensibles sont effectuees cote serveur.

## Donnees

- Base SQLite: `data/pole-maintenance.db`
- Sessions: `data/sessions.sqlite`
- Images widgets: `uploads/images`
- Signatures rapports: `uploads/signatures`

## Limites a connaitre

- L'environnement actuel du depot ne contient pas Node.js, donc l'application n'a pas pu etre executee ni testee ici.
- Pour que Discord affiche la signature directement dans l'embed, le webhook envoie l'image comme piece jointe `attachment://...`, ce qui suppose un runtime Node moderne avec `fetch`, `FormData` et `Blob`.
