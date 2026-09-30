# Glovebox-Monitoring by KeT — Projekt-CLAUDE.md

Vault: `Vault/customer-website/` (Obsidian, gitignored); vor jeder Umsetzung `04 Arbeitsweise/02 Arbeitsweise — die geraden Linien.md` lesen. Einzel-Lehren: `04 Arbeitsweise/Fehler-Lehren/`, projektspezifische Regeln: `04 Arbeitsweise/Arbeitsregeln.md`, Einstieg: `00 Start/Home.md`.

## Codemap
- `server.js` — Express-App (exportiert `app`; `listen` nur bei Direktstart), `trust proxy` vor der Session-Middleware
- `routes/` · `models/` · `services/` (u. a. `alerts.js` = Ampel-Engine, reine Funktion) · `middleware/` · `config/database.js` (mssql-Pool, Azure SQL)
- `views/` (EJS, Frontend-Texte Englisch) · `public/` (CSS, JS, Fonts, `js/vendor/` Chart.js)
- `database/schema.sql` (idempotent, `npm run setup`) · `scripts/` (setup-db, seed-admin)
- `tests/` — Jest + Supertest, DB/SMTP gemockt; Gate = `npm test` (kein TS, kein Build, kein Lint)
- Doku: `DOKUMENTATION.txt` (bei neuen Funktionen/Views/Routen nachziehen), Lastenheft `Konzept.txt`

## Branches
`dev` = Arbeit (Commit/Push ohne Rückfrage), `main` = Live mit Render-Auto-Deploy — Merge nur mit Freigabe je Merge. Skills: `pre-merge`, `live-daten`.
