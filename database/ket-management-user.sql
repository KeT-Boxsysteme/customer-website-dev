-- Eigener SQL-Benutzer fuer KeT Management auf der Website-DB (KET\AUFTRAG Abschnitt 6: minimale Rechte).
-- NICHT Teil von "npm run setup". Fuehrt der Betreiber einmal aus (Azure-Portal > Query-Editor oder sqlcmd),
-- verbunden mit der Website-DB (nicht master). Passwort vorher ersetzen und nur in KET settings.json ablegen.
--
-- Rechte: lesen companies (alle Spalten) und users (ohne password_hash); schreiben nur die Freischalt-Spalten.
-- Kein DELETE (endgueltiges Loeschen abgelehnter Registrierungen ist noch offen, 7.1).

CREATE USER [ket_management] WITH PASSWORD = '<HIER-STARKES-PASSWORT-EINSETZEN>';

GRANT SELECT ON dbo.companies TO [ket_management];
GRANT SELECT ON dbo.users (id, company_id, firstname, lastname, email, phone, username, department,
                           role, is_active, created_at) TO [ket_management];
GRANT UPDATE ON dbo.companies (status, access_code, approved_at, approved_by, [plan], ket_kunde_id)
  TO [ket_management];

-- Gegenprobe (als ket_management angemeldet): muss scheitern
--   SELECT password_hash FROM dbo.users;           -> The SELECT permission was denied ...
--   UPDATE dbo.companies SET name = name;          -> The UPDATE permission was denied ...
