const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('mingo');
const { manualTimeOverlayStages } = require('../services/manualTimeOverlay');
const { parseManualRange } = require('../utils/manualTime');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const routeSource = fs.readFileSync(path.join(__dirname, '../routes/tracking.js'), 'utf8');
const timeline = vm.createContext({ ONLINE_WINDOW_MS: 300000, SCREENSHOT_SEGMENT_MS: 900000, EXPECTED_EVENTS_PER_SEGMENT: 15, TRACKING_INTERVAL_JITTER_MS: 5000 });
vm.runInContext(routeSource.slice(routeSource.indexOf('function normalizeTimelineDate'), routeSource.indexOf("router.post('/'")), timeline);
const hour = 3600000;
const at = (h) => new Date(Date.UTC(2026, 9, 12, h));
function entry(id, start, end, active = false, extra = {}) {
  return { _id: id, userId: 'user', adminId: 'admin', timestamp: at(start), duration: (end - start) * hour,
    activeDuration: active ? (end - start) * hour : 0, inactiveDuration: active ? 0 : (end - start) * hour,
    classification: active ? 'active' : 'idle', sessionId: null, ...extra };
}
const manual = (id, start, end, extra) => entry(id, start, end, true, { sessionId: 'manual-entry', ...extra });
function resolve(entries) {
  return aggregate(entries, [...manualTimeOverlayStages('entries'), { $match: { manualTimeType: { $ne: 'offline' } } }], { collectionResolver: () => entries });
}
const total = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / hour;

test('manual replaces only the selected inactive interval', () => {
  const rows = resolve([entry(1, 14, 18), manual(2, 15, 17)]);
  assert.equal(total(rows, 'duration'), 4);
  assert.equal(total(rows, 'activeDuration'), 2);
  assert.equal(total(rows, 'inactiveDuration'), 2);
  const idle = rows.filter((row) => row.inactiveDuration);
  assert.deepEqual(idle.map((row) => [row.timestamp, row.duration]), [[at(14), hour], [at(17), hour]]);
});
test('offline becomes active without changing other tracked intervals', () => {
  const original = entry(1, 9, 10, true);
  const rows = resolve([original, manual(2, 15, 17)]);
  assert.equal(total(rows, 'activeDuration'), 3);
  assert.deepEqual(rows.find((row) => row._id === 1), original);
});
test('overlapping and repeated manual entries do not double count', () => {
  const rows = resolve([entry(1, 14, 20), manual(2, 15, 17), manual(3, 16, 18), manual(4, 16, 18)]);
  assert.equal(total(rows, 'activeDuration'), 3);
  assert.equal(total(rows, 'inactiveDuration'), 3);
  assert.equal(total(rows, 'duration'), 6);
});
test('existing active time is replaced once, and mixed intervals retain outside activity', () => {
  const rows = resolve([entry(1, 14, 18, true, { activeDuration: 2 * hour, inactiveDuration: 2 * hour }), manual(2, 15, 17)]);
  assert.equal(total(rows, 'activeDuration'), 3);
  assert.equal(total(rows, 'inactiveDuration'), 1);
});
test('end-anchored bucket samples are clipped using their actual interval', () => {
  const rows = resolve([entry(1, 18, 22, false, { batchId: 'batch', clientEntryId: 'sample' }), manual(2, 15, 17)]);
  assert.equal(total(rows, 'duration'), 4);
  assert.equal(total(rows, 'inactiveDuration'), 2);
});
test('manual corrections never cross user or admin scope', () => {
  const original = entry(1, 14, 18);
  assert.deepEqual(resolve([original, manual(2, 15, 17, { userId: 'other' })])[0], original);
  assert.deepEqual(resolve([original, manual(2, 15, 17, { adminId: 'other' })])[0], original);
});
test('selected Karachi date supports the entire day and rejects invalid inputs', () => {
  const full = parseManualRange('2026-10-12', '00:00', '24:00');
  assert.equal(full.startedAt.toISOString(), '2026-10-11T19:00:00.000Z');
  assert.equal(full.endedAt.toISOString(), '2026-10-12T19:00:00.000Z');
  assert.equal(parseManualRange('2026-10-12', '15:00', '17:00').endedAt - parseManualRange('2026-10-12', '15:00', '17:00').startedAt, 2 * hour);
  for (const [date, from, to] of [['2026-02-30', '15:00', '17:00'], ['2026-10-12', '24:00', '24:00'], ['2026-10-12', '17:00', '15:00'], ['2026-10-12', '15:00', '15:00'], ['2026-10-12', '15:00', '25:00']]) {
    assert.throws(() => parseManualRange(date, from, to));
  }
});

test('daily activity bar changes only the chosen range, including offline gaps', () => {
  const original = [entry(1, 9, 10, true), entry(2, 14, 18)];
  const build = (entries) => JSON.parse(JSON.stringify(timeline.buildActivityRoute({ trackingEntries: entries, rangeStart: at(0), rangeEnd: at(24) })));
  const baseline = build(original);
  const corrected = build([...original, manual(3, 15, 17)]);
  const labelAt = (route, h) => route.find((part) => new Date(part.startedAt) <= at(h) && new Date(part.endedAt) > at(h))?.label;
  for (let h = 0; h < 24; h += 0.25) {
    // at() uses integer UTC hours; use a direct timestamp for fractional samples.
    const timestamp = at(0).getTime() + h * hour;
    const partAt = (route) => route.find((part) => Date.parse(part.startedAt) <= timestamp && Date.parse(part.endedAt) > timestamp);
    assert.equal(partAt(corrected)?.label, h >= 15 && h < 17 ? 'Work' : partAt(baseline)?.label);
  }
  assert.equal(labelAt(corrected, 14), 'Inactive');
  assert.equal(labelAt(corrected, 17), 'Inactive');
  assert.ok(corrected.some((part) => part.manual && part.label === 'Work'));
  const offline = build([manual(4, 15, 17)]);
  assert.equal(labelAt(offline, 15), 'Work');
  assert.equal(labelAt(offline, 18), 'Offline');
});

test('complete day correction is exactly 24 active hours', () => {
  const rows = resolve([entry(1, 0, 24), manual(2, 0, 24)]);
  assert.equal(total(rows, 'activeDuration'), 24);
  assert.equal(total(rows, 'inactiveDuration'), 0);
});

test('inactive correction replaces active time only inside the chosen interval', () => {
  const correction = manual(2, 15, 17, { manualTimeType: 'inactive', activeDuration: 0, inactiveDuration: 2 * hour, classification: 'idle' });
  const rows = resolve([entry(1, 14, 18, true), correction]);
  assert.equal(total(rows, 'activeDuration'), 2);
  assert.equal(total(rows, 'inactiveDuration'), 2);
  assert.equal(total(rows, 'duration'), 4);
  const route = timeline.buildActivityRoute({ trackingEntries: [entry(1, 14, 18, true), correction], rangeStart: at(0), rangeEnd: at(24) });
  assert.equal(route.find((part) => part.manual).label, 'Inactive');
});

test('offline correction masks tracked time without adding active or inactive hours', () => {
  const correction = manual(2, 15, 17, { manualTimeType: 'offline', activeDuration: 0, inactiveDuration: 0, classification: 'idle' });
  const rows = resolve([entry(1, 14, 18, true), correction]);
  assert.equal(total(rows, 'duration'), 2);
  assert.equal(total(rows, 'activeDuration'), 2);
  assert.equal(total(rows, 'inactiveDuration'), 0);
  const route = timeline.buildActivityRoute({ trackingEntries: [entry(1, 14, 18, true), correction], rangeStart: at(0), rangeEnd: at(24) });
  const offline = route.find((part) => part.manual);
  assert.equal(offline.label, 'Offline');
  assert.equal(offline.startedAt, at(15).toISOString());
  assert.equal(offline.endedAt, at(17).toISOString());
});

test('inactive/offline categories cannot inherit stale active-duration values', () => {
  const inactive = resolve([manual(1, 15, 17, { manualTimeType: 'inactive' })]);
  assert.equal(total(inactive, 'activeDuration'), 0);
  assert.equal(total(inactive, 'inactiveDuration'), 2);
  const offline = resolve([manual(1, 15, 17, { manualTimeType: 'offline' })]);
  assert.equal(offline.length, 0);
  const mixed = resolve([
    manual(1, 9, 10, { manualTimeType: 'active' }),
    manual(2, 12, 13, { manualTimeType: 'inactive' }),
    manual(3, 15, 17, { manualTimeType: 'offline' }),
  ]);
  assert.equal(total(mixed, 'activeDuration'), 1);
  assert.equal(total(mixed, 'inactiveDuration'), 1);
});

test('latest correction wins across types regardless of input timestamp order', () => {
  const offline = manual(3, 15, 17, { manualTimeType: 'offline', activeDuration: 0, inactiveDuration: 0, classification: 'idle' });
  const active = manual(2, 16, 18);
  const rows = resolve([entry(1, 14, 20, true), offline, active]);
  assert.equal(total(rows, 'activeDuration'), 4);
  const route = timeline.buildActivityRoute({ trackingEntries: [offline, active], rangeStart: at(0), rangeEnd: at(24) });
  const at16 = route.find((part) => Date.parse(part.startedAt) <= at(16) && Date.parse(part.endedAt) > at(16));
  assert.equal(at16.label, 'Offline');
});

test('empty day and screenshots alone never generate default active minutes', () => {
  for (const screenshots of [[], [{ timestamp: at(0) }, { timestamp: at(12) }]]) {
    const route = timeline.buildActivityRoute({ trackingEntries: [], screenshots, rangeStart: at(0), rangeEnd: at(24) });
    assert.equal(route.length, 1);
    assert.equal(route[0].label, 'Offline');
    assert.equal(route[0].startedAt, at(0).toISOString());
    assert.equal(route[0].endedAt, at(24).toISOString());
  }
});

test('midnight, between-entry and trailing gaps remain offline without five-minute padding', () => {
  const route = timeline.buildActivityRoute({
    trackingEntries: [entry(1, 9, 10, true), entry(2, 12, 13, true)],
    rangeStart: at(0), rangeEnd: at(24),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(route.map(({ label, startedAt, endedAt }) => [label, startedAt, endedAt]))), [
    ['Offline', at(0).toISOString(), at(9).toISOString()],
    ['Work', at(9).toISOString(), at(10).toISOString()],
    ['Offline', at(10).toISOString(), at(12).toISOString()],
    ['Work', at(12).toISOString(), at(13).toISOString()],
    ['Offline', at(13).toISOString(), at(24).toISOString()],
  ]);
});

test('manual-only day shows exactly its selected work interval', () => {
  const route = timeline.buildActivityRoute({ trackingEntries: [manual(1, 15, 17)], rangeStart: at(0), rangeEnd: at(24) });
  assert.deepEqual(Array.from(route, (part) => part.label), ['Offline', 'Work', 'Offline']);
  const work = route.find((part) => part.label === 'Work');
  assert.equal(work.startedAt, at(15).toISOString());
  assert.equal(work.endedAt, at(17).toISOString());
});

test('manual endpoint validates user scope, saves selected date, and does not mark the user online', async () => {
  const User = require('../models/User');
  const TrackingEntry = require('../models/TrackingEntry');
  const router = require('../routes/tracking');
  const handler = router.stack.find((layer) => layer.route?.path === '/manual').route.stack.at(-1).handle;
  const original = { findOne: User.findOne, create: TrackingEntry.create, update: User.findByIdAndUpdate };
  const userId = '507f1f77bcf86cd799439011';
  let query, saved, updated = false;
  User.findOne = (value) => { query = value; return { lean: async () => ({ _id: userId, email: 'user@example.com' }) }; };
  TrackingEntry.create = async (value) => { saved = value; return { ...value, _id: 'manual' }; };
  User.findByIdAndUpdate = async () => { updated = true; };
  const invoke = async (body, manualTimeType) => {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ body, adminId: 'admin', manualTimeType }, response);
    return response;
  };
  try {
    const payload = { userId, userEmail: 'user@example.com', date: '2026-10-12', fromTime: '15:00', toTime: '17:00', project: 'Project', taskName: 'Task' };
    assert.equal((await invoke({ ...payload, userId: 'invalid' })).code, 400);
    const response = await invoke(payload);
    assert.equal(response.code, 201);
    assert.deepEqual(query, { adminId: 'admin', _id: userId, email: 'user@example.com' });
    assert.equal(saved.timestamp.toISOString(), '2026-10-12T10:00:00.000Z');
    assert.equal(saved.activeDuration, 2 * hour);
    assert.equal(saved.inactiveDuration, 0);
    assert.equal(updated, false);
    assert.equal(saved.manualTimeType, 'active');
    assert.equal((await invoke({ ...payload, timeType: 'inactive' })).code, 201);
    assert.equal(saved.activeDuration, 0);
    assert.equal(saved.inactiveDuration, 2 * hour);
    assert.equal(saved.manualTimeType, 'inactive');
    assert.equal((await invoke({ ...payload, timeType: 'offline' })).code, 201);
    assert.equal(saved.activeDuration, 0);
    assert.equal(saved.inactiveDuration, 0);
    assert.equal(saved.manualTimeType, 'offline');
    assert.equal((await invoke({ ...payload, timeType: 'invalid' })).code, 400);
    for (const type of ['inactive', 'offline']) {
      assert.ok(router.stack.some((layer) => layer.route?.path === `/manual/${type}`));
      assert.equal((await invoke({ ...payload, project: '', taskName: '' }, type)).code, 201);
      assert.equal(saved.manualTimeType, type);
      assert.equal(saved.activeDuration, 0);
      assert.equal(saved.inactiveDuration, type === 'inactive' ? 2 * hour : 0);
      assert.equal((await invoke({ ...payload, timeType: 'active' }, type)).code, 400);
    }
  } finally {
    User.findOne = original.findOne;
    TrackingEntry.create = original.create;
    User.findByIdAndUpdate = original.update;
  }
});
