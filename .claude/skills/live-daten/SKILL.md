---
name: live-daten
description: Daten-Skripte und Schema-Änderungen sicher auf der Produktiv-Datenbank (Azure SQL) fahren — Migrationen, Backfills, Cleanups, Fixes. Ausführen, wenn Daten auf Live geändert werden sollen oder ein Merge ein Nach-Deploy-Skript verlangt. Erzwingt Sicherheitskopie, Probelauf und Gegenprobe.
---

# Live-Daten — Daten-Skripte auf Live fahren (Glovebox-Monitoring)

Ein Code-Deploy ändert keine Daten. Schema-Änderungen (`npm run setup` → `database/schema.sql`), Backfills, Cleanups und Fixes laufen nur, wenn jemand sie startet — in dieser Reihenfolge, ohne Abkürzung. Welche Befehle und welche erwarteten Zahlen eine Runde braucht, steht in der Planungsnotiz der Runde, nicht hier.

**Ziele in diesem Projekt:** Dev-DB `KeT-Dev-Website` (auch lokal per `.env`) und die Produktiv-DB auf einem eigenen logischen Server — Details und aktueller Stand im Vault `03 Betrieb/Datenbank-Landschaft.md`. Welche DB ein Skript trifft, entscheidet die `.env` bzw. die gesetzten `DB_*`-Variablen: **vor jedem Lauf `DB_SERVER`/`DB_DATABASE` ausgeben und gegen das Ziel halten.**

⚠ Jeder schreibende Befehl gegen die Produktiv-DB braucht die ausdrückliche Zustimmung des Betreibers — auch wenn dieselbe Aktion auf dev freigegeben ist. Vorher gegen die Dev-DB proben.
⚠ Die Tabellen enthalten Kunden-/Personendaten (`users`, `companies`, `boxes`, `measurements`, `alert_acks`): nur Zählungen und Schema ins Gespräch, nie Einzeldatensätze (hookify-Regel `.claude/hookify.kundendaten.local.md`).

## 1. Vorbedingungen
- Deploy läuft wirklich: Render-Dashboard zeigt den erwarteten Commit UND eine Route/Datei, die es nur im neuen Stand gibt, antwortet. Login-Seite 200 allein beweist nichts.
- Läuft gerade jemand mitten in etwas (Kunden im Monitoring)? Ein Deploy/Neustart wirft laufende Sitzungen ab.
- Azure SQL Serverless pausiert: erst aufwecken bzw. mit 45 s Connect-Timeout rechnen (Vault `03 Betrieb/Azure SQL.md`) — ein Timeout ist kein Befund.

## 2. Sicherheitskopie (immer)
Vor dem Schreiben einen Stand sichern, auf den man zurück kann — z. B. Datenbank-Kopie im Azure-Portal bzw. `CREATE DATABASE <name>_vor_<runde> AS COPY OF <db>` oder Export als `.bacpac`, mit Rundennamen.
Belegt 01.10.2026: Tarif GP Serverless, automatische Sicherungen laufen (jüngste Protokollsicherung Minuten alt) — Vault `03 Betrieb/Azure SQL.md`.
⚠ Aufbewahrungsdauer und ein echter Wiederherstellungstest sind **noch nicht belegt** (nur im Portal) — siehe dort.

## 3. Probelauf ist Pflicht — jedes Skript, jedes Mal
Ohne Schreiben: Zählungen vorher (`SELECT COUNT(*)` je betroffener Tabelle), erwartete Änderung benennen. Neue Datenskripte bekommen einen Probelauf als Standard und schreiben nur mit `--apply`; das Ziel ist Pflichtangabe ohne Vorgabewert (die bestehenden `setup`/`seed` haben das nicht — dort ersetzt die Zählung vorher den Probelauf). **Weicht eine Zahl nach unten ab: STOPPEN.** (Fremdschlüssel/Löschungen nehmen Kundendaten mit.) `schema.sql` ist idempotent (`IF OBJECT_ID … IS NULL`) — neue Teile genauso schreiben.

## 4. Anwenden, dann Gegenprobe (immer)
Anwenden (`npm run setup` bzw. Skript mit `--apply`), danach Zählungen erneut, Referenzprüfungen, betroffenen Ablauf in der App ansehen und ein **zweiter Lauf, der „nichts zu tun" meldet** (Idempotenz). Reparaturen laufen in Ketten: jeden Lauf der Runde erneut probelaufen, bis ALLE 0 melden.

## 5. Rückweg kennen, bevor man ihn braucht
Render-Service anhalten bzw. vorherigen Deploy zurückrollen, DB aus der Kopie aus Schritt 2 wiederherstellen und `DB_DATABASE` im Render-Dashboard darauf zeigen lassen (oder zurückbenennen), Service neu starten, Login + Monitoring prüfen.

## 6. Danach dokumentieren
Vault: `05 Log/Aenderungslog.md` (Lauf, Ziel-DB, Ist-Zahlen, Datum), `01 Projekt/Offene Punkte.md`, `03 Betrieb/Datenbank-Landschaft.md` bei Schema-Stand. Memory nur bei neuer Dauer-Regel. Ein nicht notierter Live-Lauf wird doppelt gefahren oder doppelt untersucht.
