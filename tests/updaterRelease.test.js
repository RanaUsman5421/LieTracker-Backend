const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/updates');
const metadata = JSON.parse(fs.readFileSync(path.join(__dirname, '../updates/updater.json'), 'utf8'));
const handler = router.stack.find((layer) => layer.route?.path === '/:target/:arch/:currentVersion').route.stack.at(-1).handle;
async function request(version, target = 'windows') {
  const req = { params: { target, arch: 'x86_64', currentVersion: version }, protocol: 'http', baseUrl: '/updates', get: (name) => name === 'host' ? 'internal-proxy:8080' : '' };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send() { return this; } };
  await handler(req, res);
  return res;
}
test('packaged release advertises HTTPS download and its exact signature behind an HTTP proxy', async () => {
  const res = await request('0.0.0');
  assert.equal(res.code, 200);
  assert.equal(res.body.version, metadata.version);
  assert.equal(res.body.url, `${metadata.publicBaseUrl}/${encodeURIComponent(metadata.installer)}`);
  assert.ok(res.body.url.startsWith('https://'));
  assert.equal(res.body.signature, fs.readFileSync(path.join(__dirname, '../updates', metadata.signatureFile), 'utf8').trim());
});
test('current/newer client receives no update and invalid targets are rejected', async () => {
  assert.equal((await request(metadata.version)).code, 204);
  assert.equal((await request('999.0.0')).code, 204);
  assert.equal((await request('0.0.0', 'invalid')).code, 400);
});
