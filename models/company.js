const { getPool, sql } = require('../config/database');

// Neue Einrichtungen bekommen status 'pending' (DB-Vorgabe): sie warten auf Freischaltung durch KeT
async function create({ name, type, city, street, housenumber, zip }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('name',        sql.NVarChar(200), name)
    .input('type',        sql.NVarChar(20),  type)
    .input('city',        sql.NVarChar(100), city)
    .input('street',      sql.NVarChar(150), street)
    .input('housenumber', sql.NVarChar(20),  housenumber)
    .input('zip',         sql.NVarChar(20),  zip)
    .query(`INSERT INTO companies (name, type, city, street, housenumber, zip)
            OUTPUT INSERTED.id
            VALUES (@name, @type, @city, @street, @housenumber, @zip)`);
  return result.recordset[0].id;
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM companies WHERE id = @id');
  return result.recordset[0] || null;
}

// Mail mit der Nutz-Nummer "beanspruchen": nur wer notified_code von etwas anderem auf diese Nummer setzt,
// darf die Mail schicken. Ein Schreibvorgang statt Lesen-dann-Schreiben (parallele Aufrufe aus KET).
async function claimNotification(id, code) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .input('code', sql.Char(6), code)
    .query(`UPDATE companies SET notified_code = @code
            WHERE id = @id AND access_code = @code AND (notified_code IS NULL OR notified_code <> @code)`);
  return result.rowsAffected[0] === 1;
}

// Mail ging nicht raus: Anspruch zuruecknehmen, damit "erneut senden" in KET wieder verschickt
async function releaseNotification(id, code) {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .input('code', sql.Char(6), code)
    .query('UPDATE companies SET notified_code = NULL WHERE id = @id AND notified_code = @code');
}

module.exports = { create, findById, claimNotification, releaseNotification };
