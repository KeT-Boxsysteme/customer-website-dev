/**
 * Password hashing cost (Betreiber 01.10.): new and changed passwords use bcrypt cost 10
 * (measured: cost 12 took ~2 s per login on Render). Existing cost-12 hashes stay valid.
 */
let mockInputs = {};
jest.mock('../config/database', () => ({
  getPool: jest.fn(async () => ({
    request() {
      const req = {
        input(name, type, value) { mockInputs[name] = value; return req; },
        query: async () => ({ recordset: [{ id: 1 }], rowsAffected: [1] })
      };
      return req;
    }
  })),
  sql: { Int: {}, NVarChar: jest.fn(() => ({})), Bit: {} }
}));

const bcrypt = require('bcryptjs');
const User = require('../models/user');

beforeEach(() => { mockInputs = {}; });

const costOf = hash => parseInt(hash.split('$')[2], 10);

describe('password hashing cost', () => {
  test('new user -> cost 10', async () => {
    await User.create({ companyId: 1, firstname: 'A', lastname: 'B', email: 'a@b.c', username: 'AB',
      department: 'x', role: 'user', password: 'Secret123!' });
    expect(costOf(mockInputs.passwordHash)).toBe(10);
  });

  test('changed password -> cost 10', async () => {
    await User.updatePassword(1, 'NewSecret1!');
    expect(costOf(mockInputs.passwordHash)).toBe(10);
  });

  test('existing cost-12 hashes keep working', async () => {
    const old = await bcrypt.hash('Secret123!', 12);
    expect(await User.verifyPassword('Secret123!', old)).toBe(true);
    expect(await User.verifyPassword('wrong', old)).toBe(false);
  });
});
