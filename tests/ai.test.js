/* ponytail: scrub + quiz scoring self-check */
const assert = require('assert');
const path = require('path');

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

console.log('ai.test.js OK');
