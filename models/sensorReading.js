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

// Verlauf fuer /diagrams: je Stunde Mittel, Minimum und Maximum (1 Jahr im Minutentakt waeren
// > 500 000 Punkte; Min/Max halten kurze Ausreisser sichtbar). Index idx_sensor_readings_box_time.
async function hourlyByBox(boxId, monthsBack) {
  const pool = await getPool();
  const result = await pool.request()
    .input('boxId',      sql.Int, boxId)
    .input('monthsBack', sql.Int, monthsBack || 6)
    .query(`SELECT DATEADD(hour, DATEDIFF(hour, 0, measured_at), 0) AS bucket,
                   CAST(AVG(temp) AS DECIMAL(6,1)) AS avg_temp, MIN(temp) AS min_temp, MAX(temp) AS max_temp
            FROM sensor_readings
            WHERE box_id = @boxId AND measured_at >= DATEADD(month, -@monthsBack, GETDATE())
            GROUP BY DATEADD(hour, DATEDIFF(hour, 0, measured_at), 0)
            ORDER BY bucket`);
  return result.recordset;
}

module.exports = { createIfDue, hourlyByBox };
