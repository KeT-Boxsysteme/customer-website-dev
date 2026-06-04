const { getPool, sql } = require('../config/database');
const bcrypt = require('bcryptjs');

async function findByEmail(email) {
  const pool = await getPool();
  const result = await pool.request()
    .input('email', sql.NVarChar(255), email)
    .query('SELECT * FROM users WHERE email = @email AND is_active = 1');
  return result.recordset[0] || null;
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM users WHERE id = @id AND is_active = 1');
  return result.recordset[0] || null;
}

async function findAllByCompany(companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`SELECT id, firstname, lastname, email, username, department, role, created_at
            FROM users WHERE company_id = @companyId AND is_active = 1
            ORDER BY lastname, firstname`);
  return result.recordset;
}

async function create({ companyId, firstname, lastname, email, phone, username, department, role, password }) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.request()
    .input('companyId', sql.Int, companyId)
    .input('firstname', sql.NVarChar(100), firstname)
    .input('lastname', sql.NVarChar(100), lastname)
    .input('email', sql.NVarChar(255), email)
    .input('phone', sql.NVarChar(50), phone || null)
    .input('username', sql.NVarChar(4), username)
    .input('department', sql.NVarChar(100), department)
    .input('role', sql.NVarChar(20), role)
    .input('passwordHash', sql.NVarChar(255), passwordHash)
    .query(`INSERT INTO users (company_id, firstname, lastname, email, phone, username, department, role, password_hash, is_active)
            OUTPUT INSERTED.id
            VALUES (@companyId, @firstname, @lastname, @email, @phone, @username, @department, @role, @passwordHash, 1)`);
  return result.recordset[0].id;
}

async function update(id, { firstname, lastname, email, username, department, role }) {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .input('firstname', sql.NVarChar(100), firstname)
    .input('lastname', sql.NVarChar(100), lastname)
    .input('email', sql.NVarChar(255), email)
    .input('username', sql.NVarChar(4), username)
    .input('department', sql.NVarChar(100), department)
    .input('role', sql.NVarChar(20), role)
    .query(`UPDATE users SET firstname=@firstname, lastname=@lastname, email=@email,
            username=@username, department=@department, role=@role WHERE id=@id`);
}

async function softDelete(id) {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .query('UPDATE users SET is_active = 0 WHERE id = @id');
}

async function updatePassword(id, newPassword) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.request()
    .input('id', sql.Int, id)
    .input('passwordHash', sql.NVarChar(255), passwordHash)
    .query('UPDATE users SET password_hash = @passwordHash WHERE id = @id');
}

async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

async function getUsernamesByCompany(companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`SELECT username FROM users WHERE company_id = @companyId AND is_active = 1 ORDER BY username`);
  return result.recordset.map(r => r.username);
}

module.exports = {
  findByEmail,
  findById,
  findAllByCompany,
  create,
  update,
  softDelete,
  updatePassword,
  verifyPassword,
  getUsernamesByCompany
};
