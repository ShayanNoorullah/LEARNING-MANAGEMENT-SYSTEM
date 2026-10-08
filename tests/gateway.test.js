// Self-check for the server state gateway: hashing matches the browser and the merge rules hold. Run: npm test
const assert = require('assert'), vm = require('vm'), fs = require('fs'), path = require('path');
const t = require('../backend/state-api.js')._test;
const js = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const ctx = { localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null }, document: { querySelector: () => null }, location: {}, crypto: { getRandomValues: a => a } };
ctx.window = ctx; ctx.addEventListener = () => {}; vm.createContext(ctx);
vm.runInContext(js('seed.js') + ';' + js('core.js') + ';globalThis.__h=hashPassword', ctx);
assert.equal(t.hashPassword('Demo@123', 'ab12'), ctx.__h('Demo@123', 'ab12'), 'server hash = browser hash');
assert.equal(t.hashPassword('pässwörd', 'x'), ctx.__h('pässwörd', 'x'), 'unicode passwords hash the same');

const roles = [{ id: 'admin', base: 'admin' }, { id: 'student', base: 'student', permissions: {} }, { id: 'teacher', base: 'teacher', permissions: { courses: ['edit'] } }];
const prev = { roles, settings: { a: 1 }, users: [{ id: 'A', role: 'admin', passwordHash: 'ha', salt: 'sa' }, { id: 'L', role: 'student', passwordHash: 'hl', salt: 'sl', name: 'L' }, { id: 'T', role: 'teacher', passwordHash: 'ht', salt: 'st' }] };
const client = t.forClient(prev, 'L');
assert.ok(!client.users.find(u => u.id === 'A').passwordHash && client.users.find(u => u.id === 'L').passwordHash, 'only your own hash is sent');

let out = t.merge(prev, { roles: [], settings: { a: 2 }, users: [{ id: 'L', role: 'admin', name: 'New', passwordHash: 'hl' }] }, prev.users[1]);
assert.equal(out.users.length, 3, 'learner cannot delete accounts');
assert.equal(out.users.find(u => u.id === 'L').role, 'student', 'learner cannot change own role');
assert.equal(out.users.find(u => u.id === 'L').name, 'New', 'learner can edit own profile');
assert.deepEqual(out.settings, { a: 1 }); assert.equal(out.roles, roles, 'roles/settings need permission');
out = t.merge(prev, { ...client, users: client.users.map(u => u.id === 'A' ? { ...u, passwordHash: 'evil', salt: 'x' } : u) }, prev.users[1]);
assert.equal(out.users.find(u => u.id === 'A').passwordHash, 'ha', "learner cannot set another user's password");

const adminView = t.forClient(prev, 'A');
out = t.merge(prev, { ...adminView, users: adminView.users.map(u => u.id === 'T' ? { ...u, passwordHash: 'new', salt: 'n' } : u) }, prev.users[0]);
assert.equal(out.users.find(u => u.id === 'L').passwordHash, 'hl', 'missing hash = unchanged');
assert.equal(out.users.find(u => u.id === 'T').passwordHash, 'new', 'account managers can reset passwords');
// Phase 2 upgrade: built-in roles gain ai/quizzes once; existing choices and later edits are kept.
const old = { roles: [{ id: 'student', permissions: { learn: ['view'] } }, { id: 'teacher', permissions: { ai: ['view'] } }] };
t.migrate(old);
assert.deepEqual(old.roles[0].permissions.ai, ['view', 'use']); assert.deepEqual(old.roles[1].permissions.ai, ['view'], 'existing ai permissions kept');
delete old.roles[0].permissions.ai; t.migrate(old); assert.equal(old.roles[0].permissions.ai, undefined, 'upgrade runs only once');
console.log('gateway.test.js: all checks passed');
