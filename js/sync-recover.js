/* SDC Learn — recovery of changes that were never confirmed by the server. Pure logic, no browser or
   network access, shared by js/cloud-sync.js and the tests (loaded with a `typeof module` guard).

   A browser copy carries a sync base (state._sync): for every record of every collection, a hash of the
   record as the server last confirmed it. From that base, `delta` lists what this copy changed since
   (records added or edited, records deleted, whole objects such as settings) together with the base hash
   of each, and `apply` replays that list onto a fresh copy of the server's state:
     - the server still has the record as it was in the base -> the change is applied;
     - the server already has the same record -> nothing to do;
     - the server's record changed (or was deleted) meanwhile -> a conflict: the server's version stays
       and the person's version is kept aside to decide, never written over it.
   Hashes ignore key order (the database reorders keys), so a record that was saved and read back is
   never mistaken for a changed one. Copies stored before this file existed carry order-sensitive hashes
   (no `_v`); `hashOf(state, base)` picks the matching function for them. */
(function (root) {
  const SYNC = '_sync', VERSION = 2;
  const isRec = r => !!r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string';
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
    : JSON.stringify(v) ?? 'null';
  const mix = s => { let a = 0xdeadbeef, b = 0x41c6ce57; for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); a = Math.imul(a ^ ch, 2654435761); b = Math.imul(b ^ ch, 1597334677); } a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909); return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36); };
  const hash = r => mix(stable(r));
  const legacyHash = r => mix(JSON.stringify(r)); // copies stored before sync base version 2
  const hashFor = base => base && base._v === VERSION ? hash : legacyHash;

  // id -> hash for an array of records, {'#': hash} for an object (settings), null for anything else.
  function unitsOf(v, h = hash) {
    if (Array.isArray(v)) { const o = {}; v.forEach(r => { if (isRec(r)) o[r.id] = h(r); }); return o; }
    if (v && typeof v === 'object') return { '#': h(v) };
    return null;
  }
  function baseOf(state, h = hash) {
    const o = { _v: VERSION };
    Object.keys(state || {}).forEach(k => { if (k === SYNC) return; const u = unitsOf(state[k], h); if (u) o[k] = u; });
    return o;
  }

  // What `state` changed since `base`. count = number of changed records/objects.
  function delta(state, base) {
    const changes = {}; let count = 0;
    if (!state || !base) return { changes, count, kind: 'none' };
    const h = hashFor(base);
    Object.keys(state).forEach(k => {
      if (k === SYNC || k === '_v') return;
      const b = base[k], v = state[k];
      if (!b) return; // no base for this key (copy from an older version): what changed is unknown
      if (Array.isArray(v)) {
        const cur = unitsOf(v, h), put = {}, del = [], from = {};
        v.forEach(r => { if (isRec(r) && cur[r.id] !== b[r.id]) { put[r.id] = r; from[r.id] = b[r.id] ?? null; } });
        Object.keys(b).forEach(id => { if (!Object.prototype.hasOwnProperty.call(cur, id)) { del.push(id); from[id] = b[id]; } });
        const n = Object.keys(put).length + del.length;
        if (n) { changes[k] = { put, del, from }; count += n; }
      } else if (v && typeof v === 'object' && b['#'] !== undefined && h(v) !== b['#']) {
        changes[k] = { value: v, from: { '#': b['#'] } }; count++;
      }
    });
    return { changes, count, kind: base._v === VERSION ? 'v2' : 'legacy' };
  }

  // Replays `changes` onto `server` (a normalized state; modified in place). Returns what happened.
  function apply(changes, server, kind = 'v2') {
    const h = kind === 'legacy' ? legacyHash : hash, applied = [], already = [], conflicts = [];
    Object.keys(changes || {}).forEach(k => {
      const c = changes[k];
      if (c.value !== undefined) {
        const sv = server[k], sh = sv && typeof sv === 'object' ? h(sv) : null;
        if (sh === h(c.value)) already.push({ collection: k, id: '#' });
        else if (sh !== null && sh === c.from['#']) { server[k] = c.value; applied.push({ collection: k, id: '#' }); }
        else conflicts.push({ collection: k, id: '#', op: 'edit', kind: 'changed', mine: c.value });
        return;
      }
      const arr = Array.isArray(server[k]) ? server[k] : (server[k] = []);
      const at = new Map(); arr.forEach((r, i) => { if (isRec(r)) at.set(r.id, i); });
      Object.keys(c.put || {}).forEach(id => {
        const mine = c.put[id], b = c.from?.[id] ?? null, i = at.get(id), sv = i === undefined ? undefined : arr[i];
        if (sv === undefined) {
          if (b === null) { arr.push(mine); at.set(id, arr.length - 1); applied.push({ collection: k, id, op: 'create' }); }
          else conflicts.push({ collection: k, id, op: 'edit', kind: 'deleted', mine }); // edited here, deleted by someone else
        } else {
          const sh = h(sv);
          if (sh === h(mine)) already.push({ collection: k, id });
          else if (b !== null && sh === b) { arr[i] = mine; applied.push({ collection: k, id, op: 'edit' }); }
          else conflicts.push({ collection: k, id, op: b === null ? 'create' : 'edit', kind: 'changed', mine });
        }
      });
      const gone = new Set();
      (c.del || []).forEach(id => {
        const i = at.get(id);
        if (i === undefined) already.push({ collection: k, id });
        else if (h(arr[i]) === c.from?.[id]) { gone.add(id); applied.push({ collection: k, id, op: 'delete' }); }
        else conflicts.push({ collection: k, id, op: 'delete', kind: 'changed', mine: null, theirs: arr[i] });
      });
      if (gone.size) server[k] = arr.filter(r => !(isRec(r) && gone.has(r.id)));
    });
    return { state: server, applied, already, conflicts };
  }

  // A conflict decided in favour of the person's version: put it into `state` (modified in place).
  function useMine(state, conflict) {
    const k = conflict.collection;
    if (conflict.id === '#') { state[k] = conflict.mine; return true; }
    const arr = Array.isArray(state[k]) ? state[k] : (state[k] = []), i = arr.findIndex(r => isRec(r) && r.id === conflict.id);
    if (conflict.op === 'delete') { if (i >= 0) arr.splice(i, 1); return true; }
    if (!conflict.mine) return false;
    if (i >= 0) arr[i] = conflict.mine; else arr.push(conflict.mine);
    return true;
  }

  // A short human label for a record in a list of conflicts.
  const labelOf = (rec, id) => String(rec?.title || rec?.name || rec?.code || rec?.subject || id || '').slice(0, 80);

  const api = { SYNC, VERSION, hash, legacyHash, stable, unitsOf, baseOf, delta, apply, useMine, labelOf, isRec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncRecover = api;
})(typeof window !== 'undefined' ? window : globalThis);
