const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const AdminSession = require('../models/AdminSession');
const { createAdminSession } = require('../services/adminSessions');
const { requireDashboardAuthenticatedAdmin } = require('../middleware/requireDashboardAuth');
const { JWT_SECRET } = require('../config/constants');
const router = require('../routes/dashboardAuth');

function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('independent admin sessions, scoped logout, expiry, and migration', async () => {
  const admin = { _id: '507f1f77bcf86cd799439011', username: 'admin', email: 'admin@example.com', activeSessionId: 'pre-upgrade' };
  const sessions = new Map();
  const originals = { findById: Admin.findById, updateOne: Admin.updateOne, create: AdminSession.create, exists: AdminSession.exists, deleteOne: AdminSession.deleteOne };
  Admin.findById = async (id) => id === admin._id ? admin : null;
  Admin.updateOne = async (query) => {
    if (query._id === admin._id && query.activeSessionId === admin.activeSessionId) admin.activeSessionId = null;
  };
  AdminSession.create = async (session) => { sessions.set(session.sessionId, session); return session; };
  AdminSession.exists = async (query) => {
    const found = sessions.get(query.sessionId);
    return found && found.adminId === query.adminId && found.expiresAt > query.expiresAt.$gt ? { _id: query.sessionId } : null;
  };
  AdminSession.deleteOne = async (query) => {
    if (sessions.get(query.sessionId)?.adminId === query.adminId) sessions.delete(query.sessionId);
  };
  const authenticate = async (token) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = response();
    let accepted = false;
    await requireDashboardAuthenticatedAdmin(req, res, () => { accepted = true; });
    return { req, res, accepted };
  };
  const logout = router.stack.find((layer) => layer.route?.path === '/logout').route.stack.at(-1).handle;
  try {
    const tokens = await Promise.all([createAdminSession(admin), createAdminSession(admin)]);
    assert.equal(sessions.size, 2);
    assert.notEqual(jwt.decode(tokens[0]).sessionId, jwt.decode(tokens[1]).sessionId);
    assert.equal(admin.activeSessionId, 'pre-upgrade');
    for (const token of tokens) {
      const decoded = jwt.decode(token);
      assert.equal(decoded.exp - decoded.iat, 6 * 60 * 60);
      assert.equal(sessions.get(decoded.sessionId).expiresAt.getTime(), decoded.exp * 1000);
      assert.equal((await authenticate(token)).accepted, true);
    }
    const first = await authenticate(tokens[0]);
    await logout(first.req, response());
    assert.equal((await authenticate(tokens[0])).accepted, false);
    assert.equal((await authenticate(tokens[1])).accepted, true);
    assert.equal(sessions.size, 1);

    const legacy = jwt.sign({ scope: 'dashboard-admin', adminId: admin._id, sessionId: 'pre-upgrade' }, JWT_SECRET, { expiresIn: '6h' });
    const legacyAuth = await authenticate(legacy);
    assert.equal(legacyAuth.accepted, true);
    await logout(legacyAuth.req, response());
    assert.equal((await authenticate(legacy)).accepted, false);
    assert.equal((await authenticate(tokens[1])).accepted, true);

    sessions.get(jwt.decode(tokens[1]).sessionId).expiresAt = new Date(Date.now() - 1000);
    assert.equal((await authenticate(tokens[1])).accepted, false);

    const now = Math.floor(Date.now() / 1000);
    const expired = jwt.sign({ scope: 'dashboard-admin', adminId: admin._id, sessionId: 'expired', iat: now - 21601 }, JWT_SECRET, { expiresIn: '6h' });
    sessions.set('expired', { adminId: admin._id, expiresAt: new Date(Date.now() + 60000) });
    assert.equal((await authenticate(expired)).accepted, false);
    const wrongAdmin = jwt.sign({ scope: 'dashboard-admin', adminId: 'other', sessionId: 'expired' }, JWT_SECRET, { expiresIn: '6h' });
    assert.equal((await authenticate(wrongAdmin)).accepted, false);
    assert.equal((await authenticate(null)).res.code, 401);

    // A deleted v2 session must not be resurrected through the legacy field.
    admin.activeSessionId = jwt.decode(tokens[0]).sessionId;
    assert.equal((await authenticate(tokens[0])).accepted, false);
  } finally {
    Admin.findById = originals.findById;
    Admin.updateOne = originals.updateOne;
    AdminSession.create = originals.create;
    AdminSession.exists = originals.exists;
    AdminSession.deleteOne = originals.deleteOne;
  }
});

test('expired session cleanup uses a TTL index', () => {
  assert.ok(AdminSession.schema.indexes().some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
});
