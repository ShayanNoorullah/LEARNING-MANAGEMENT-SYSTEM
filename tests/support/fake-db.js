// In-memory stand-in for the five gateway SQL functions, with the same rules as
// supabase/migrations/*.sql (secret hash, users check, compare-and-swap, strictly increasing
// versions). Used by `npm test` so the safe-write scenarios run without any database.
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function fakeBackend() {
  let row = null, secretHash = '', putIfPresent = true, micros = BigInt(Date.parse('2026-01-01T00:00:00Z')) * 1000n;
  const kv = {};
  // Microsecond timestamps formatted like PostgreSQL's to_jsonb(timestamptz).
  const stamp = () => { micros += 1n + BigInt(Math.floor(Math.random() * 5)); return new Date(Number(micros / 1000n)).toISOString().replace('Z', '') + String(micros % 1000n).padStart(3, '0') + '+00:00'; };
  const check = s => { if (typeof s !== 'string' || sha(s) !== secretHash) throw err(403, '42501', 'denied'); };
  const users = st => { if (!st || !Array.isArray(st.users) || !st.users.length) throw err(400, '22023', 'state must contain users'); };
  const write = st => { row = { state: clone(st), updated_at: stamp() }; return row.updated_at; };
  const fns = {
    sdc_state_get: a => { check(a.p_secret); return row ? { state: clone(row.state), updated_at: row.updated_at } : null; },
    sdc_state_put: a => { check(a.p_secret); users(a.p_state); return write(a.p_state); },
    sdc_state_put_if: a => {
      if (!putIfPresent) throw err(404, 'PGRST202', 'Could not find the function public.sdc_state_put_if');
      check(a.p_secret); users(a.p_state);
      if (a.p_expected === null || a.p_expected === undefined) return row ? null : write(a.p_state);
      return row && row.updated_at === a.p_expected ? write(a.p_state) : null;
    },
    sdc_kv_get: a => { check(a.p_secret); return kv[a.p_key] === undefined ? null : clone(kv[a.p_key]); },
    sdc_kv_put: a => { check(a.p_secret); kv[a.p_key] = clone(a.p_value); return true; }
  };
  return {
    label: 'in-memory fake',
    call: async (fn, a) => { if (!fns[fn]) throw err(404, 'PGRST202', 'Could not find the function'); return fns[fn](a || {}); },
    setSecret: async s => { secretHash = sha(s); },
    seed: async st => write(st),
    row: async () => row && clone(row),
    setPutIf: async v => { putIfPresent = v; }
  };
}
module.exports = { fakeBackend };
