---
name: pre-merge
description: Qualitäts-Gate vor jedem Merge nach main (und vor größeren dev-Pushes). Ausführen, wenn eine Arbeitsrunde abgeschlossen wird oder der Nutzer mergen/deployen will. Fängt die wiederkehrenden Fehlermuster systematisch ab.
---

# Pre-Merge — das Qualitäts-Gate (Glovebox-Monitoring)

Reihenfolge einhalten, kein Schritt ist optional.

## 1. Typprüfung + Build
Entfällt in diesem Projekt: reines JavaScript (Node + Express + EJS), kein TypeScript, kein Build-Schritt (Render: `npm install`, Start `node server.js`). Ersatz: App lokal starten (`npm start`, Port 3000) und prüfen, dass sie ohne Fehler hochfährt — Syntax-/Require-Fehler fallen erst dort auf.

## 2. Tests
`npm test` (Jest + Supertest, `--runInBand`, DB und SMTP gemockt; Stand siehe Vault `02 Technik/Tests.md`). Einen Linter gibt es nicht. Grüne Tests sind kein laufender Server (Schritt 1). Nach jeder Nachbesserung das VOLLE Gate erneut, nie nur den betroffenen Test. Gate nur über einen ruhenden Arbeitsbaum (keine parallel schreibende Sitzung). Commit/Push per `&&` hinter dem Gate.

## 3. Braucht die Änderung ein Nach-Deploy-Skript?
Ein Code-Deploy ändert keine Daten, und Render führt beim Deploy keine Migration aus. Für Live-Läufe gilt der Skill `live-daten`.

| Änderung im Merge | Danach nötig | Wo |
|---|---|---|
| `database/schema.sql` (neue Tabelle/Spalte/Index) | `npm run setup` (idempotent) — **vor** dem Merge gegen die Dev-DB, nach Freigabe gegen die Produktiv-DB | Dev-DB `KeT-Dev-Website`; Produktiv-DB siehe Vault `03 Betrieb/Datenbank-Landschaft.md` |
| Neuer Admin-Zugang auf leerer DB | `npm run seed` | nur auf ausdrücklichen Auftrag |
| Neue Env-Variable | im Render-Dashboard eintragen — je Service, Render vererbt nichts | Vault `03 Betrieb/Umgebungsvariablen.md` |
| Nur Views/CSS/Routen ohne Schema | nichts | — |

Neuer Code, der eine neue Spalte liest, darf erst live gehen, wenn die Spalte in der Produktiv-DB existiert — sonst Reihenfolge ansagen.

## 4. Changelog gepflegt?
Das Projekt hat keinen Changelog in der App; die Historie steht im Vault `05 Log/Aenderungslog.md`, die Technik in `DOKUMENTATION.txt`. Beides im selben Zug nachziehen. Ein Eintrag je Merge, knapp, mit Commit-Hash.

## 5. UI-Änderungen dabei?
Design-Regeln gegenprüfen (Vault `02 Technik/Design-System.md`): Frontend-Texte Englisch, Kontrast, Fokus, Handy-Breite, Animationen nur transform/opacity, Ladezustände neuer Routen; alle vier Rollen (`admin`, `controller`, `user`, `box_user`) — sieht jede Rolle nur, was sie darf?

## 6. Wirkung dort prüfen, wo sie wirkt
Erst fertig, wenn in der echten Anwendung gesehen: lokal (`npm start`, Test-Login siehe Vault `03 Betrieb/Zugaenge.md`) bzw. auf dem Render-dev-Service den betroffenen Ablauf einmal wirklich durchklicken. Ehrlich berichten — „nicht geprüft" sagen, nie „in Ordnung" ohne Prüfung.

## 7. Merge-Disziplin
- Push auf `dev` ist erlaubt.
- **Merge nach `main` NUR mit ausdrücklicher Freigabe — je Merge, keine Ausnahmen.** Push auf `main` deployt sofort zu den Kunden (Render Auto-Deploy).
- Nur komplette Stände: alle Pakete + alle gemerkten Nebenbefunde erledigt. Checkliste vorlegen; was erst NACH dem Merge geht (Schritt 3), ausdrücklich benennen.
- Ablauf: Vault `04 Arbeitsweise/Branch-Strategie.md`. Deploy-Beleg: etwas, das es nur im neuen Stand gibt (neue Route/Datei), plus Login-Seite 200.

## 8. Notizen & Memory nachziehen — sofort, ungefragt
Gilt am Ende JEDER Arbeitsrunde, nicht nur beim Merge: Vault `05 Log/Aenderungslog.md` (Commits, Funde), `01 Projekt/Offene Punkte.md` (Neues rein, Erledigtes abhaken), `05 Log/Entscheidungen.md` (mit Datum), Memory (Stand + neue Dauer-Regeln), `DOKUMENTATION.txt` bei neuen Funktionen/Views/Routen.
