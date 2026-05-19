const { getPool, sql } = require('../config/database');

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

module.exports = { create, findById };
