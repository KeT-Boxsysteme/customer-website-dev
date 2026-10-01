// Einrichtung vollständig löschen, "als hätte es sie nie gegeben" (Betreiber 01.10.2026 über KET). Nur Website-Daten —
// in KeT Management wird nichts gelöscht. Erlaubt für pending/rejected/suspended; aktive Einrichtungen müssen erst
// gesperrt werden (Prüfung IN der Transaktion, mit Zeilensperre — kein Wettlauf mit einer Freischaltung).
// Der Plan ist Daten: tests/companyDeletion.test.js prüft ihn gegen database/schema.sql (jede Tabelle mit Fremdschlüssel
// auf companies/users/boxes muss vorkommen, Kinder vor Eltern).
// Daten ANDERER Einrichtungen werden nie gelöscht: zeigt dort ein Messwert/eine Quittung auf einen Benutzer dieser
// Einrichtung, wird nur der Verweis geleert (Spalten sind NULL-fähig).
const OWN_USERS = 'SELECT id FROM users WHERE company_id = @id';
const OWN_BOXES = 'SELECT id FROM boxes WHERE company_id = @id';

const PLAN = [
  { key: 'password_resets',        table: 'password_resets', sql: `DELETE FROM password_resets WHERE user_id IN (${OWN_USERS});` },
  { key: 'alert_acks',             table: 'alert_acks',      sql: `DELETE FROM alert_acks WHERE box_id IN (${OWN_BOXES});` },
  { key: 'alert_acks_detached',    table: 'alert_acks',      sql: `UPDATE alert_acks SET acked_by = NULL WHERE acked_by IN (${OWN_USERS});` },
  { key: 'measurements',           table: 'measurements',    sql: `DELETE FROM measurements WHERE box_id IN (${OWN_BOXES});` },
  { key: 'measurements_detached',  table: 'measurements',    sql: `UPDATE measurements SET user_id = NULL WHERE user_id IN (${OWN_USERS});` },
  { key: 'sensor_readings',        table: 'sensor_readings', sql: `DELETE FROM sensor_readings WHERE box_id IN (${OWN_BOXES});` },
  { key: 'boxes',                  table: 'boxes',           sql: 'DELETE FROM boxes WHERE company_id = @id;' },
  // Anmeldungen der Benutzer (Sitzungsspeicher ohne Fremdschlüssel, services/sessionStore.js): user.companyId im JSON
  { key: 'sessions',               table: 'sessions',        sql: "DELETE FROM sessions WHERE ISJSON(session) = 1 AND JSON_VALUE(session, '$.user.companyId') = CAST(@id AS NVARCHAR(20));" },
  { key: 'users',                  table: 'users',           sql: 'DELETE FROM users WHERE company_id = @id;' },
  { key: 'companies',              table: 'companies',       sql: 'DELETE FROM companies WHERE id = @id;' }
];

// Ein SQL-Block: Sperre + Statusprüfung + alle Schritte + Zählungen, alles oder nichts (XACT_ABORT).
function buildDeletionSql() {
  const decl = PLAN.map(s => `DECLARE @n_${s.key} INT = 0;`).join('\n');
  const steps = PLAN.map(s => `${s.sql}\nSET @n_${s.key} = @@ROWCOUNT;`).join('\n');
  const counts = PLAN.map(s => `@n_${s.key} AS ${s.key}`).join(', ');
  return `SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @status NVARCHAR(20);
SELECT @status = status FROM companies WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
IF @status IS NULL BEGIN COMMIT TRANSACTION; SELECT 'not_found' AS result; RETURN; END
IF @status = 'active' BEGIN COMMIT TRANSACTION; SELECT 'is_active' AS result; RETURN; END
${decl}
${steps}
COMMIT TRANSACTION;
SELECT 'deleted' AS result, ${counts};`;
}

module.exports = { PLAN, buildDeletionSql };
