/* ponytail: scrub + quiz scoring self-check */
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
// Test-only key, set before the module reads it.
process.env.SDC_AI_SECRETS_KEY = 'test-only-ai-secrets-key';

const ai = require(path.join(__dirname, '..', 'backend', 'ai-api.js'));
const { scrubPii, maskKey } = ai._test;

assert.equal(scrubPii('Hello ali@example.com and 0300-1234567'), 'Hello [redacted] and [redacted]');
assert.ok(scrubPii('CNIC 42101-1234567-1').includes('[redacted]'));
assert.ok(scrubPii('Contact Sana Mirza please', ['Sana Mirza']).includes('[redacted]'));
assert.equal(maskKey('sk-abcdefghijklmnop'), 'sk-…mnop');
assert.equal(maskKey(''), '');

// Round-trip encrypt helpers via configure path is heavier; enc/dec smoke:
const { enc, dec } = ai._test;
const blob = enc({ profiles: { a: { apiKey: 'secret' } } });
const back = dec(blob);
assert.equal(back.profiles.a.apiKey, 'secret');
// The AES key is not sha256(secret), the value supabase/gateway.sql stores for SDC_STATE_SECRET.
assert.equal(blob.v, 2);
const plainHash = crypto.createHash('sha256').update(process.env.SDC_AI_SECRETS_KEY).digest();
const tryKey = (key, b) => { try { const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'base64')); d.setAuthTag(Buffer.from(b.tag, 'base64')); return Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()]).toString(); } catch (e) { return null; } };
assert.equal(tryKey(plainHash, blob), null, 'the stored secret hash cannot decrypt new blobs');
// Old (v1) blobs written with sha256(secret) are still read, so nothing is lost before the re-save.
const iv = crypto.randomBytes(12), c1 = crypto.createCipheriv('aes-256-gcm', plainHash, iv);
const ct = Buffer.concat([c1.update(JSON.stringify({ profiles: { old: { apiKey: 'k1' } } })), c1.final()]);
const v1 = { v: 1, iv: iv.toString('base64'), tag: c1.getAuthTag().toString('base64'), data: ct.toString('base64') };
assert.equal(dec(v1).profiles.old.apiKey, 'k1', 'v1 blobs still decrypt');
assert.equal(dec({ ...enc(dec(v1)), v: 1 }).profiles.old, undefined, 'a re-saved blob is v2 only');

console.log('ai.test.js OK');
