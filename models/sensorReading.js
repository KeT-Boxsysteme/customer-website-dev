const { getPool, sql } = require('../config/database');

// Speichert einen Live-Wert nur, wenn fuer diese Box im Sperrfenster noch keiner gespeichert ist
// (E-19). Pruefen und Einfuegen in EINER Anweisung mit Sperre — zwei Tablets an derselben Box
// koennen so nicht beide durchrutschen. Rueckgabe: true = gespeichert, false = noch nicht faellig.
async function createIfDue(boxId, sensorSerial, temp, windowSeconds) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId',         sql.Int,           boxId)
    .input('sensorSerial',  sql.NVarChar(6),   sensorSerial)
    .input('temp',          sql.Decimal(6, 1), temp)
    .input('windowSeconds', sql.Int,           windowSeconds)
    .query(`INSERT INTO sensor_readings (box_id, sensor_serial, temp, measured_at)
            SELECT @boxId, @sensorSerial, @temp, GETDATE()
            WHERE NOT EXISTS (
              SELECT 1 FROM sensor_readings WITH (UPDLOCK, HOLDLOCK)
              WHERE box_id = @boxId AND measured_at > DATEADD(second, -@windowSeconds, GETDATE())
            )`);
  return result.rowsAffected[0] === 1;
}

module.exports = { createIfDue };
