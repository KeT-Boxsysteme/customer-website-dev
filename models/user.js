const { getPool, sql } = require('../config/database');
const bcrypt = require('bcryptjs');

// Kostenstufe fuer neue/geaenderte Passwoerter (Betreiber 01.10.): Stufe 12 kostete auf Render ~2 s je
// Login (gemessen). 10 = OWASP-Mindestempfehlung. Bestehende Hashes (Stufe 12) bleiben gueltig.
const BCRYPT_COST = 10;

// Mit Status und Nutz-Nummer der Einrichtung (Login prueft beides, services/access.js)
async function findByEmail(email) {
  const pool = await getPool();
  const result = await pool.request()
    .input('email', sql.NVarChar(255), email)
    .query(`SELECT u.*, c.status AS company_status, c.access_code AS company_access_code
            FROM users u JOIN companies c ON c.id = u.company_id
            WHERE u.email = @email AND u.is_active = 1`);
  return result.recordset[0] || null;
}

// Laufende Sitzungen: Benutzer noch aktiv? Einrichtung aktiv, Nummer unveraendert? (middleware/auth.js)
async function sessionState(userId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, userId)
    .query(`SELECT u.is_active, c.status AS company_status, c.access_code AS company_access_code
            FROM users u JOIN companies c ON c.id = u.company_id
            WHERE u.id = @id`);
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

// Empfaenger der Mail mit der Nutz-Nummer (7.2): die admins der Einrichtung, nicht der service-Benutzer
async function findAdminEmailsByCompany(companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`SELECT email FROM users
            WHERE company_id = @companyId AND is_active = 1 AND role = 'admin'`);
  return result.recordset.map(r => r.email);
}

async function create({ companyId, firstname, lastname, email, phone, username, department, role, password }) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
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

// Aendern/Loeschen nur innerhalb der eigenen Einrichtung — der Riegel steht in der Abfrage (Fund 01.10.:
// vorher genuegte die id, ein admin haette Benutzer einer anderen Einrichtung aendern koennen).
// Gibt die Anzahl geaenderter Zeilen zurueck (0 = nicht gefunden / fremde Einrichtung).
async function update(id, companyId, { firstname, lastname, email, username, department, role }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .input('companyId', sql.Int, companyId)
    .input('firstname', sql.NVarChar(100), firstname)
    .input('lastname', sql.NVarChar(100), lastname)
    .input('email', sql.NVarChar(255), email)
    .input('username', sql.NVarChar(4), username)
    .input('department', sql.NVarChar(100), department)
    .input('role', sql.NVarChar(20), role)
    .query(`UPDATE users SET firstname=@firstname, lastname=@lastname, email=@email,
            username=@username, department=@department, role=@role
            WHERE id=@id AND company_id=@companyId AND is_active = 1`);
  return result.rowsAffected[0];
}

async function softDelete(id, companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .input('companyId', sql.Int, companyId)
    .query('UPDATE users SET is_active = 0 WHERE id = @id AND company_id = @companyId');
  return result.rowsAffected[0];
}

async function updatePassword(id, newPassword) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
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

// --- service-Benutzer je Einrichtung (7.5, 7.10) ---------------------------------------------------
async function findServiceUser(companyId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('companyId', sql.Int, companyId)
    .query(`SELECT id, email, is_active FROM users WHERE company_id = @companyId AND role = 'service'`);
  return result.recordset[0] || null;
}

// Legt den service-Benutzer an, falls es keinen gibt; Ergebnis 'created' | 'exists'.
// Doppelte Anlage verhindert der UNIQUE-Index auf email (gleicher Login-Name je Einrichtung).
async function ensureServiceUser(companyId, email, randomPassword) {
  if (await findServiceUser(companyId)) return 'exists';
  try {
    await create({
      companyId, firstname: 'KeT', lastname: 'Service', email, phone: null,
      username: 'KET', department: 'KeT Service', role: 'service', password: randomPassword
    });
    return 'created';
  } catch (err) {
    if (err && (err.number === 2627 || err.number === 2601)) return 'exists';   // parallel angelegt
    throw err;
  }
}

module.exports = {
  findByEmail,
  sessionState,
  findById,
  findAllByCompany,
  findAdminEmailsByCompany,
  create,
  update,
  softDelete,
  updatePassword,
  verifyPassword,
  getUsernamesByCompany,
  findServiceUser,
  ensureServiceUser,
  BCRYPT_COST
};
