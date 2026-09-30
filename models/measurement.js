const { getPool, sql } = require('../config/database');

// Fehlende Felder (Box ohne diesen Sensor -> Input existiert im Formular nicht) sind null,
// nicht NaN: parseFloat(undefined) wuerde die Decimal-Validierung von mssql sprengen.
const num = v => (v === undefined || v === null || v === '' || isNaN(parseFloat(v))) ? null : parseFloat(v);

async function create({ boxId, userId, o2Value, h2oValue, fridgeTemp, pressureValue }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId',     sql.Int,     boxId)
    .input('userId',    sql.Int,     userId)
    .input('o2Value',   sql.Decimal(10, 2), num(o2Value))
    .input('h2oValue',  sql.Decimal(10, 2), num(h2oValue))
    .input('fridgeTemp',    sql.Decimal(10, 2), num(fridgeTemp))
    .input('pressureValue', sql.Decimal(10, 3), num(pressureValue))
    .query(`INSERT INTO measurements (box_id, user_id, o2_value, h2o_value, fridge_temp, pressure_value, measured_at)
            OUTPUT INSERTED.id
            VALUES (@boxId, @userId, @o2Value, @h2oValue, @fridgeTemp, @pressureValue, GETDATE())`);
  return result.recordset[0].id;
}

// Manuelle Messwerte ab `since` (Zeitraum der Diagramm-Seite, services/diagramData.js)
async function findByBox(boxId, since) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId', sql.Int,       boxId)
    .input('since', sql.DateTime2, since)
    .query(`SELECT m.*, u.username
            FROM measurements m
            LEFT JOIN users u ON m.user_id = u.id
            WHERE m.box_id = @boxId
              AND m.measured_at >= @since
            ORDER BY m.measured_at DESC`);
  return result.recordset;
}

async function findLatestByBox(boxId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId', sql.Int, boxId)
    .query(`SELECT TOP 1 * FROM measurements WHERE box_id = @boxId ORDER BY measured_at DESC`);
  return result.recordset[0] || null;
}

module.exports = { create, findByBox, findLatestByBox };
