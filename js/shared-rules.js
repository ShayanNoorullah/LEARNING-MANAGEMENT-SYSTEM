/* SDC Learn — rules shared by the browser (js/core.js, js/pages-users.js) and the server gateway
   (backend/state-api.js), so both always decide the same way.
   - Quiz scoring: objective items are scored from the stored answer key; short answers use the
     AI or instructor review points (capped at the question's points).
   - Role ceiling: someone who is not the built-in admin can only grant what they hold themselves. */
const SharedRules = (() => {
  function scoreObjective(question, answer) {
    if (!question) return { correct: false, points: 0 };
    const pts = Number(question.points) || 1;
    if (question.type === 'mcq_single' || question.type === 'true_false') {
      const ok = String(answer) === String((question.options || []).find(o => o.correct)?.id);
      return { correct: ok, points: ok ? pts : 0 };
    }
    if (question.type === 'mcq_multi') {
      const correct = new Set((question.options || []).filter(o => o.correct).map(o => o.id));
      const picked = new Set(Array.isArray(answer) ? answer : (answer ? [answer] : []));
      const ok = correct.size === picked.size && [...correct].every(id => picked.has(id));
      return { correct: ok, points: ok ? pts : 0 };
    }
    return { correct: null, points: null }; // short — AI / instructor
  }
  function gradeAttempt(questions, answers, aiReviews = {}) {
    let score = 0, maxScore = 0, pending = false;
    const detail = {};
    questions.forEach(q => {
      const pts = Number(q.points) || 1;
      maxScore += pts;
      if (q.type === 'short') {
        const rev = aiReviews?.[q.id];
        if (rev && rev.points != null) { score += Number(rev.points); detail[q.id] = { ...rev, type: 'short' }; }
        else pending = true;
      } else {
        const r = scoreObjective(q, answers?.[q.id]);
        score += r.points || 0;
        detail[q.id] = r;
      }
    });
    return { score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 100) : 0, pending, detail };
  }
  /* Does the actor's role cover the target role? The built-in admin covers every role and is covered
     by none. Otherwise every permission of the target must be one the actor holds, or one of the
     built-in learner role (baseline), so learner-account managers can still create learners. Course
     access: "all" needs "all"; "selected" needs "all" or a superset of the courses; "assigned" and
     "enrolled" follow the person's own batches and enrollments, so any course access covers them. */
  function covers(actor, target, baseline) {
    if (!target) return true;
    if (actor?.id === 'admin') return true;
    if (!actor || target.id === 'admin') return false;
    const has = (r, m, a) => (r?.permissions?.[m] || []).includes(a);
    for (const [m, acts] of Object.entries(target.permissions || {})) {
      if ((Array.isArray(acts) ? acts : []).some(a => !has(actor, m, a) && !has(baseline, m, a))) return false;
    }
    const ts = target.courseScope || 'enrolled', as = actor.courseScope || 'enrolled';
    if (ts === 'all') return as === 'all';
    if (ts === 'selected') return as === 'all' || (as === 'selected' && (target.courseIds || []).every(id => (actor.courseIds || []).includes(id)));
    return true;
  }
  return { scoreObjective, gradeAttempt, covers };
})();
if (typeof module !== 'undefined') module.exports = SharedRules;
