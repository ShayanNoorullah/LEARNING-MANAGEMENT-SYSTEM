/* SDC Learn — one-time data upgrades, shared by the browser (normalizeState in core.js) and the
   server gateway (backend/state-api.js), so both always agree. state.schema records the last step. */
function migrateState(state, seedRoles) {
  const v = state.schema || 1;
  // 2 · Phase 2: built-in roles get the ai/quizzes defaults once; later admin edits are left alone.
  if (v < 2) {
    (state.roles || []).forEach(r => { const s = (seedRoles || []).find(x => x.id === r.id); if (!s || !r.permissions) return; ['ai', 'quizzes'].forEach(m => { if (!r.permissions[m] && s.permissions?.[m]) r.permissions[m] = [...s.permissions[m]]; }); });
  }
  // 3 · Courses are blueprints; assignments and quizzes belong to a batch. Course-level items are copied
  //     to every batch of the course (copy ids are deterministic, so running twice is harmless) and each
  //     submission / attempt moves to the copy for its learner's batch.
  if (v < 3) {
    const batchesOf = courseId => (state.batches || []).filter(b => b.courseId === courseId).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const batchOf = (learnerId, courseId) => (state.enrollments || []).find(e => e.learnerId === learnerId && e.courseId === courseId && e.status !== 'Withdrawn')?.batchId;
    const spread = (list, link, linkKey) => {
      const copies = [];
      list.forEach(item => {
        if (item.batchId) return;
        // Only batches still running when the item was created; work added after a batch finished never
        // reaches that batch's learners (items with no creation date predate this and go to every batch).
        const day = String(item.createdAt || '').slice(0, 10);
        const bs = batchesOf(item.courseId).filter(b => !day || (b.endDate ? day <= b.endDate : b.status !== 'Completed'));
        if (!bs.length) { item.batchId = ''; return; } // unassigned: hidden from learners; staff can copy it into a batch
        item.batchId = bs[0].id;
        bs.slice(1).forEach(b => copies.push({ ...item, id: `${item.id}-${b.id}`, batchId: b.id }));
      });
      copies.forEach(c => { if (!list.some(x => x.id === c.id)) list.push(c); });
      link.forEach(rec => {
        const item = list.find(x => x.id === rec[linkKey]), b = item && batchOf(rec.learnerId, item.courseId);
        const base = item && item.id.replace(new RegExp(`-${item.batchId}$`), '');
        if (b && b !== item.batchId && list.some(x => x.id === `${base}-${b}`)) rec[linkKey] = `${base}-${b}`;
      });
    };
    spread(state.assignments || [], state.submissions || [], 'assignmentId');
    spread(state.quizzes || [], state.quizAttempts || [], 'quizId');
  }
  state.schema = 3;
  return state;
}
if (typeof module !== 'undefined') module.exports = { migrateState };
