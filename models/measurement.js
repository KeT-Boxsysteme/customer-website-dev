const { getPool, sql } = require('../config/database');

async function create({ boxId, userId, o2Value, h2oValue, fridgeTemp }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId',     sql.Int,     boxId)
    .input('userId',    sql.Int,     userId)
    .input('o2Value',   sql.Decimal(10, 2), o2Value !== '' ? parseFloat(o2Value) : null)
    .input('h2oValue',  sql.Decimal(10, 2), h2oValue !== '' ? parseFloat(h2oValue) : null)
    .input('fridgeTemp', sql.Decimal(10, 2), fridgeTemp !== '' ? parseFloat(fridgeTemp) : null)
    .query(`INSERT INTO measurements (box_id, user_id, o2_value, h2o_value, fridge_temp, measured_at)
            OUTPUT INSERTED.id
            VALUES (@boxId, @userId, @o2Value, @h2oValue, @fridgeTemp, GETDATE())`);
  return result.recordset[0].id;
}

async function findByBox(boxId, monthsBack) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId',      sql.Int, boxId)
    .input('monthsBack', sql.Int, monthsBack || 6)
    .query(`SELECT m.*, u.username
            FROM measurements m
            LEFT JOIN users u ON m.user_id = u.id
            WHERE m.box_id = @boxId
              AND m.measured_at >= DATEADD(month, -@monthsBack, GETDATE())
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
