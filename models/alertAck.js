const { getPool, sql } = require('../config/database');

/** Latest acknowledgement per alert key for a box: [{alert_key, acked_at}] */
async function latestAcks(boxId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId', sql.Int, boxId)
    .query(`SELECT alert_key, MAX(acked_at) AS acked_at
            FROM alert_acks
            WHERE box_id = @boxId
            GROUP BY alert_key`);
  return result.recordset;
}

async function insertAck(boxId, alertKey, userId) {
  const pool = await getPool();
  await pool.request()
    .input('boxId', sql.Int, boxId)
    .input('alertKey', sql.NVarChar(40), alertKey)
    .input('userId', sql.Int, userId || null)
    .query(`INSERT INTO alert_acks (box_id, alert_key, acked_by)
            VALUES (@boxId, @alertKey, @userId)`);
}

module.exports = { latestAcks, insertAck };
