const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const router = require('../routes/auth');

test('delayed desktop logout revokes only the authenticated session', async () => {
  const handler = router.stack.find((layer) => layer.route?.path === '/logout').route.stack.at(-1).handle;
  const original = User.updateOne;
  let currentSession = 'new-session';
  User.updateOne = async (query, update) => {
    assert.deepEqual(query, { _id: 'user', activeSessionId: 'old-session' });
    if (currentSession === query.activeSessionId) currentSession = update.$set.activeSessionId;
  };
  const req = { authUser: { _id: 'user', activeSessionId: 'old-session' } };
  const res = { status() { return this; }, json(value) { assert.equal(value.success, true); } };
  try {
    await handler(req, res);
    assert.equal(currentSession, 'new-session');
    currentSession = 'old-session';
    await handler(req, res);
    assert.equal(currentSession, null);
  } finally {
    User.updateOne = original;
  }
});
