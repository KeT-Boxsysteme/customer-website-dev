const { getPool, sql } = require('../config/database');

async function findAllByCompany(companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`SELECT * FROM boxes WHERE company_id = @companyId AND is_active = 1 ORDER BY box_alias`);
  return result.recordset;
}

async function findById(id, companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .input('companyId', sql.Int, companyId)
    .query('SELECT * FROM boxes WHERE id = @id AND company_id = @companyId AND is_active = 1');
  return result.recordset[0] || null;
}

async function create(data) {
  const pool = await getPool();
  const result = await pool.request()
    .input('companyId',               sql.Int,          data.companyId)
    .input('manufacturer',            sql.NVarChar(50),  data.manufacturer)
    .input('projectNumber',           sql.NVarChar(50),  data.projectNumber)
    .input('boxType',                 sql.NVarChar(100), data.boxType)
    .input('boxAlias',                sql.NVarChar(100), data.boxAlias)
    .input('hasDualFilter',           sql.Bit,           data.hasDualFilter ? 1 : 0)
    .input('hasSolventFilter',        sql.Bit,           data.hasSolventFilter ? 1 : 0)
    .input('solventFilterType',       sql.NVarChar(20),  data.solventFilterType || null)
    .input('charcoalCycleMonths',     sql.Int,           data.charcoalCycleMonths || null)
    .input('molecularSieveCycleMonths', sql.Int,         data.molecularSieveCycleMonths || null)
    .input('hasSolventSensor',        sql.Bit,           data.hasSolventSensor ? 1 : 0)
    .input('solventSensorCalibrated', sql.NVarChar(4),   data.solventSensorCalibrated || null)
    .input('hasO2Sensor',             sql.Bit,           data.hasO2Sensor ? 1 : 0)
    .input('o2SensorCalibrated',      sql.NVarChar(4),   data.o2SensorCalibrated || null)
    .input('hasH2oSensor',            sql.Bit,           data.hasH2oSensor ? 1 : 0)
    .input('h2oSensorCalibrated',     sql.NVarChar(4),   data.h2oSensorCalibrated || null)
    .input('lastCleaned',             sql.Date,          data.lastCleaned || null)
    .input('hasFridge',               sql.Bit,           data.hasFridge ? 1 : 0)
    .input('fridgeTemp',              sql.Int,           data.fridgeTemp || null)
    .input('hasOilPump',              sql.Bit,           data.hasOilPump ? 1 : 0)
    .input('lastOilChange',           sql.Date,          data.lastOilChange || null)
    .input('glovePorts',              sql.Int,           data.glovePorts)
    .input('usageType',               sql.NVarChar(20),  data.usageType)
    .input('buildYear',               sql.Int,           data.buildYear)
    .input('additionalNotes',         sql.NVarChar(sql.MAX), data.additionalNotes || null)
    .query(`INSERT INTO boxes (
              company_id, manufacturer, project_number, box_type, box_alias,
              has_dual_filter, has_solvent_filter, solvent_filter_type,
              charcoal_cycle_months, molecular_sieve_cycle_months,
              has_solvent_sensor, solvent_sensor_calibrated,
              has_o2_sensor, o2_sensor_calibrated,
              has_h2o_sensor, h2o_sensor_calibrated,
              last_cleaned, has_fridge, fridge_temp,
              has_oil_pump, last_oil_change, glove_ports,
              usage_type, build_year, additional_notes, is_active,
              last_h2o_cleaning, last_charcoal_done, last_sieve_done,
              last_solvent_test, last_oil_done
            ) OUTPUT INSERTED.id VALUES (
              @companyId, @manufacturer, @projectNumber, @boxType, @boxAlias,
              @hasDualFilter, @hasSolventFilter, @solventFilterType,
              @charcoalCycleMonths, @molecularSieveCycleMonths,
              @hasSolventSensor, @solventSensorCalibrated,
              @hasO2Sensor, @o2SensorCalibrated,
              @hasH2oSensor, @h2oSensorCalibrated,
              @lastCleaned, @hasFridge, @fridgeTemp,
              @hasOilPump, @lastOilChange, @glovePorts,
              @usageType, @buildYear, @additionalNotes, 1,
              GETDATE(), GETDATE(), GETDATE(), GETDATE(), GETDATE()
            )`);
  return result.recordset[0].id;
}

async function update(id, companyId, data) {
  const pool = await getPool();
  await pool.request()
    .input('id',           sql.Int,          id)
    .input('companyId',    sql.Int,          companyId)
    .input('manufacturer', sql.NVarChar(50),  data.manufacturer)
    .input('boxType',      sql.NVarChar(100), data.boxType)
    .input('boxAlias',     sql.NVarChar(100), data.boxAlias)
    .input('additionalNotes', sql.NVarChar(sql.MAX), data.additionalNotes || null)
    .query(`UPDATE boxes SET manufacturer=@manufacturer, box_type=@boxType,
            box_alias=@boxAlias, additional_notes=@additionalNotes
            WHERE id=@id AND company_id=@companyId`);
}

async function softDelete(id, companyId) {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .input('companyId', sql.Int, companyId)
    .query('UPDATE boxes SET is_active = 0 WHERE id = @id AND company_id = @companyId');
}

async function updateMaintenanceDate(id, field) {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .query(`UPDATE boxes SET ${field} = GETDATE() WHERE id = @id`);
}

module.exports = { findAllByCompany, findById, create, update, softDelete, updateMaintenanceDate };
