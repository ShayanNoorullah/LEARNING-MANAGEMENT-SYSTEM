/* SDC Learn AI — quizzes, practice, tutor drawer, summarizer (Phase 2). */

function openAiDrawer({ title, bodyHTML, onMount }) {
  document.querySelector('.ai-drawer')?.remove();
  const el = document.createElement('div');
  el.className = 'ai-drawer';
  el.innerHTML = `<div class="ai-drawer-backdrop" data-close></div><aside class="ai-drawer-panel" role="dialog" aria-label="${esc(title)}">
    <header class="ai-drawer-head"><div><span class="ai-badge">${icon('sparkles', 14)} SDC Learn AI</span><h2>${esc(title)}</h2></div><button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button></header>
    <div class="ai-drawer-body">${bodyHTML}</div>
  </aside>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 200); };
  el.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  onMount?.(el, close);
  return { el, close };
}

/* ---------------------------------- Tutor -------------------------------- */
function openTutorDrawer(course, session) {
  if (!feature('aiTutor') || !Domain.aiEnabled()) return toast('AI Tutor is disabled.', 'warning');
  if (!can('ai', 'use')) return toast('No permission to use SDC Learn AI.', 'error');
  const history = [];
  openAiDrawer({
    title: session ? `Ask about: ${session.title}` : `Ask about: ${course.title}`,
    bodyHTML: `<p class="help">Answers are grounded in this ${t('course', true)}'s outline and ${t('session', true)} materials. For official grading, ask your ${t('instructor', true)}.</p>
      <div class="ai-chat" data-chat></div>
      <form class="ai-compose" data-form><textarea class="input" name="q" rows="2" placeholder="Ask a question…" required></textarea>
        <button class="btn btn-primary" type="submit">${icon('sparkles', 16)} Ask</button></form>`,
    onMount(el) {
      const chat = el.querySelector('[data-chat]');
      const paint = () => {
        chat.innerHTML = history.map((m, i) => `<div class="ai-bubble ${m.role}"><div class="ai-bubble-text">${esc(m.text).replace(/\n/g, '<br>')}</div>
          ${m.role === 'assistant' ? `<div class="ai-bubble-meta">${m.citations?.length ? `<small class="muted">Sources: ${esc(m.citations.join(' · '))}</small>` : ''}<div class="row gap-sm"><button type="button" class="chip" data-rate="up" data-i="${i}">Helpful</button><button type="button" class="chip" data-rate="down" data-i="${i}">Unhelpful</button><button type="button" class="chip" data-esc="${i}">Escalate</button></div></div>` : ''}</div>`).join('') || `<p class="muted small pad">Try: “What are the learning outcomes for this ${t('session', true)}?”</p>`;
        chat.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => toast(b.dataset.rate === 'up' ? 'Thanks — marked helpful.' : 'Thanks — we’ll improve grounding.'));
        chat.querySelectorAll('[data-esc]').forEach(b => b.onclick = () => {
          const msg = history[Number(b.dataset.esc)];
          const instructors = (course.instructorIds || []);
          instructors.forEach(id => notify(id, 'AI Tutor escalation', `${App.user.name} needs help on ${course.title}: ${history[Number(b.dataset.esc) - 1]?.text || msg.text}`, 'AI', `#/course/${course.id}`));
          toast('Escalated to your instructor.');
        });
        chat.scrollTop = chat.scrollHeight;
      };
      paint();
      el.querySelector('[data-form]').onsubmit = async e => {
        e.preventDefault();
        const q = e.target.q.value.trim(); if (!q) return;
        history.push({ role: 'user', text: q }); e.target.q.value = ''; paint();
        const thinking = { role: 'assistant', text: 'Thinking…', citations: [] }; history.push(thinking); paint();
        try {
          const ground = [
            `Course: ${course.title}`,
            course.tagline || '',
            (course.outcomes || []).map(o => `- ${o}`).join('\n'),
            session ? `Session: ${session.title}\n${session.summary || ''}\nResources: ${(session.resources || []).map(r => r.title).join(', ')}` : Domain.courseSessions(course.id).slice(0, 12).map(s => `${s.title}: ${s.summary || ''}`).join('\n')
          ].join('\n');
          const out = await SDCAI.call('tutor', {
            system: `You are SDC Learn AI, a course-grounded tutor for Skill Development Council Karachi. English only. Answer ONLY from the provided course materials. If not covered, say exactly: "This topic is not covered in the approved course materials. Please consult your course instructor." Do not solve active graded assignments fully — give conceptual guidance. End with a line CITATIONS: comma-separated session or resource titles you used.`,
            prompt: `MATERIALS:\n${ground}\n\nSTUDENT QUESTION:\n${q}`,
            scrubNames: [App.user.name, App.user.email, App.user.regNo]
          });
          const parts = String(out.text || '').split(/CITATIONS:\s*/i);
          thinking.text = parts[0].trim();
          thinking.citations = (parts[1] || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
        } catch (err) { thinking.text = err.message || 'Tutor unavailable.'; }
        paint();
      };
    }
  });
}

function summarizeResource(course, session, resource) {
  if (!feature('aiSummarize') || !Domain.aiEnabled()) return toast('Summarizer is disabled.', 'warning');
  openAiDrawer({
    title: `Summarize: ${resource.title}`,
    bodyHTML: `<div class="pad" data-out><p class="muted">${icon('sparkles', 16)} Generating English key-concept summary…</p></div>
      ${Domain.canManageCourse(App.user, course) ? `<div class="form-foot"><button class="btn btn-secondary btn-sm" data-pin hidden>${icon('check', 14)} Pin as official summary</button></div>` : ''}`,
    async onMount(el) {
      try {
        const out = await SDCAI.call('summarize', {
          system: 'You are SDC Learn AI. Produce an English structured summary with sections: Learning Objectives, Key Technical Concepts, Practical Steps, Glossary. Keep industry terms in English. Be concise.',
          prompt: `Course: ${course.title}\nSession: ${session?.title || ''}\nResource: ${resource.title} (${resource.type})\nDescribe likely contents from the title/type and session summary: ${session?.summary || course.tagline || ''}. If you lack the file body, still produce a useful study-outline labelled as provisional.`
        });
        let summaryText = out.text;
        el.querySelector('[data-out]').innerHTML = `<div class="ai-summary">${SDCAI.badge()}<div class="prose">${esc(summaryText).replace(/\n/g, '<br>')}</div></div>`;
        const pin = el.querySelector('[data-pin]');
        if (pin) {
          pin.hidden = false;
          pin.onclick = () => {
            const d = db(), s = d.sessions.find(x => x.id === session.id);
            if (!s) return;
            s.aiPinnedSummary = { text: summaryText, resourceId: resource.id, at: new Date().toISOString(), by: App.user.id };
            saveDB(d); toast('Summary pinned on this session.');
          };
        }
      } catch (err) { el.querySelector('[data-out]').innerHTML = `<p class="danger">${esc(err.message)}</p>`; }
    }
  });
}

/* ------------------------- Practice + graded quizzes --------------------- */
function startPracticeQuiz(course, session) {
  if (!feature('aiPractice') || !Domain.aiEnabled()) return toast('Practice quizzes are disabled.', 'warning');
  openAiDrawer({
    title: 'Test my understanding',
    bodyHTML: `<form data-cfg class="stack-sm pad"><p class="help">Private practice — scores never enter the gradebook.</p>
      <div class="field"><label class="label">Questions</label><select class="input" name="n"><option>3</option><option selected>5</option><option>10</option></select></div>
      <div class="field"><label class="label">Difficulty</label><select class="input" name="diff"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></div>
      <button class="btn btn-primary" type="submit">${icon('sparkles', 16)} Generate practice quiz</button></form><div data-quiz></div>`,
    onMount(el) {
      el.querySelector('[data-cfg]').onsubmit = async e => {
        e.preventDefault();
        const n = e.target.n.value, diff = e.target.diff.value;
        const box = el.querySelector('[data-quiz]');
        box.innerHTML = `<p class="muted pad">${icon('sparkles', 16)} Generating…</p>`;
        try {
          const out = await SDCAI.call('practiceQuiz', {
            system: 'Return ONLY JSON array of questions: [{"type":"mcq_single"|"true_false","stem":"...","options":[{"id":"a","text":"...","correct":bool}],"rationale":"..."}]. English. Ground in the session materials described.',
            prompt: `Create ${n} ${diff} practice questions for session "${session.title}". Summary: ${session.summary || ''}. Course: ${course.title}. Outcomes: ${(course.outcomes || []).join('; ')}`,
            maxTokens: 2000
          });
          let items = [];
          try { items = JSON.parse(out.text.replace(/```json|```/g, '').trim()); } catch (err) { throw new Error('Could not parse practice questions. Try again.'); }
          box.innerHTML = `<form data-attempt class="stack-sm pad">${items.map((q, i) => `<fieldset class="card tight"><legend><b>Q${i + 1}.</b> ${esc(q.stem)}</legend>${(q.options || []).map(o => `<label class="check"><input type="radio" name="q${i}" value="${esc(o.id)}" required><span>${esc(o.text)}</span></label>`).join('')}</fieldset>`).join('')}<button class="btn btn-primary">Check answers</button></form><div data-res></div>`;
          box.querySelector('[data-attempt]').onsubmit = ev => {
            ev.preventDefault();
            let score = 0;
            const lines = items.map((q, i) => {
              const picked = ev.target[`q${i}`].value;
              const ok = (q.options || []).find(o => o.correct)?.id === picked;
              if (ok) score++;
              return `<li>${ok ? '✓' : '✗'} ${esc(q.stem)} ${q.rationale ? `<small class="muted block">${esc(q.rationale)}</small>` : ''}</li>`;
            });
            const percent = Math.round((score / items.length) * 100);
            addRecord('practiceAttempts', { learnerId: App.user.id, courseId: course.id, sessionId: session.id, score, maxScore: items.length, percent, at: new Date().toISOString() });
            box.querySelector('[data-res]').innerHTML = `<div class="card"><b>${score}/${items.length} (${percent}%)</b> — private study log only.${SDCAI.badge()}<ul class="mini-list">${lines.join('')}</ul></div>`;
          };
        } catch (err) { box.innerHTML = `<p class="danger pad">${esc(err.message)}</p>`; }
      };
    }
  });
}

/* ------------------------------ Graded quiz UI --------------------------- */
function renderQuizAttempt(ctx, course, quiz) {
  const u = ctx.user;
  const attempts = db().quizAttempts.filter(a => a.quizId === quiz.id && a.learnerId === u.id);
  if (quiz.attemptLimit && attempts.filter(a => a.status === 'Submitted').length >= quiz.attemptLimit) {
    ctx.root.innerHTML = pageHead(quiz.title) + emptyState('Attempt limit reached', `You have used all ${quiz.attemptLimit} attempts.`, 'lock', `<a class="btn btn-secondary" href="#/course/${course.id}">Back</a>`);
    return;
  }
  let questions = Domain.quizQuestions(quiz);
  if (quiz.shuffle) questions = [...questions].sort(() => Math.random() - 0.5);
  courseCrumbs(ctx, course, [{ label: quiz.title }]);
  ctx.root.innerHTML = `${pageHead(quiz.title, quiz.description || `Graded ${t('quiz', true)}. Objective items are scored instantly.`, badge('Graded', 'accent'))}
    <form class="card quiz-attempt" data-quiz novalidate>${questions.map((q, i) => `
      <fieldset class="quiz-q" data-qid="${q.id}"><legend><span class="muted">Q${i + 1}</span> ${esc(q.stem)} <small class="muted">(${q.points || 1} pt)</small></legend>
        ${q.type === 'short' ? `<textarea class="input" name="${q.id}" rows="3" required placeholder="Your answer"></textarea>` :
          (q.options || []).map(o => `<label class="check"><input type="${q.type === 'mcq_multi' ? 'checkbox' : 'radio'}" name="${q.id}" value="${esc(o.id)}" ${q.type === 'mcq_multi' ? '' : 'required'}><span>${esc(o.text)}</span></label>`).join('')}
      </fieldset>`).join('')}
      <div class="form-foot sticky-foot"><a class="btn btn-ghost" href="#/course/${course.id}">Cancel</a><button class="btn btn-primary" type="submit">${icon('check', 16)} Submit ${t('quiz', true)}</button></div>
    </form>`;
  ctx.root.querySelector('[data-quiz]').onsubmit = async e => {
    e.preventDefault();
    const answers = {};
    questions.forEach(q => {
      if (q.type === 'mcq_multi') answers[q.id] = [...e.target.querySelectorAll(`[name="${q.id}"]:checked`)].map(x => x.value);
      else answers[q.id] = e.target[q.id]?.value;
    });
    const aiReviews = {};
    for (const q of questions.filter(x => x.type === 'short')) {
      if (!feature('ai') || !Domain.aiEnabled()) continue;
      try {
        const out = await SDCAI.call('quizCheck', {
          system: 'Score a short answer. Return JSON {"points":number,"max":number,"rationale":"..."}. points between 0 and max.',
          prompt: `Max points: ${q.points || 1}\nModel answer: ${q.modelAnswer || ''}\nKeywords: ${(q.keywords || []).join(', ')}\nLearner answer: ${answers[q.id]}`
        });
        const parsed = JSON.parse(out.text.replace(/```json|```/g, '').trim());
        aiReviews[q.id] = { points: Math.min(Number(q.points) || 1, Math.max(0, Number(parsed.points) || 0)), rationale: parsed.rationale || '', ai: true };
      } catch (err) { aiReviews[q.id] = { points: null, rationale: 'Pending instructor review', ai: false }; }
    }
    const graded = Domain.gradeQuizAttempt(quiz, answers, aiReviews);
    addRecord('quizAttempts', {
      quizId: quiz.id, courseId: course.id, learnerId: u.id, startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(), answers, score: graded.score, maxScore: graded.maxScore,
      percent: graded.percent, detail: graded.detail, aiReviews, status: 'Submitted', pendingShort: graded.pending
    });
    toast(graded.pending ? `Submitted · ${graded.percent}% (short answers may be reviewed)` : `Submitted · ${graded.percent}%`);
    location.hash = `#/course/${course.id}/quizzes`;
  };
}

App.route('/course/:id/quizzes', { perm: ['learn', 'courses'], feature: 'quizzes', render(ctx) {
  const { course, error } = courseAccess(ctx.user, ctx.params.id);
  if (error) return deniedPage(ctx, error);
  const u = ctx.user, isLearner = kind(u) === 'student';
  courseCrumbs(ctx, course, [{ label: t('quizzes') }]);
  const quizzes = isLearner ? Domain.publishedQuizzes(course.id) : Domain.courseQuizzes(course.id);
  ctx.root.innerHTML = `${pageHead(t('quizzes'), isLearner ? `Graded checks for ${esc(course.title)}.` : `Manage ${t('quizzes', true)} in the course builder.`, !isLearner && Domain.canManageCourse(u, course) ? `<a class="btn btn-primary btn-sm" href="#/manage/course/${course.id}?tab=quizzes">${icon('edit', 15)} Builder</a>` : '')}
    ${quizzes.length ? `<div class="course-grid">${quizzes.map(q => {
      const best = isLearner ? db().quizAttempts.filter(a => a.quizId === q.id && a.learnerId === u.id && a.status === 'Submitted').sort((a, b) => b.percent - a.percent)[0] : null;
      return `<div class="card"><div class="row-between"><b>${esc(q.title)}</b>${badge(q.status)}</div><p class="small muted">${esc(q.description || '')}</p>
        <p class="small">${Domain.quizQuestions(q).length} questions${q.attemptLimit ? ` · max ${q.attemptLimit} attempts` : ''}</p>
        ${best ? `<p><b>Best: ${best.percent}%</b></p>` : ''}
        ${isLearner && q.status === 'published' ? `<a class="btn btn-primary btn-sm" href="#/course/${course.id}/quiz/${q.id}">${icon('play', 14)} Attempt</a>` : ''}</div>`;
    }).join('')}</div>` : emptyState(`No ${t('quizzes', true)} yet`, '', 'clipboard')}`;
} });

App.route('/course/:id/quiz/:qid', { perm: 'learn', feature: 'quizzes', base: 'student', render(ctx) {
  const { course, error } = courseAccess(ctx.user, ctx.params.id);
  if (error) return deniedPage(ctx, error);
  const quiz = findRecord('quizzes', ctx.params.qid);
  if (!quiz || quiz.courseId !== course.id || quiz.status !== 'published') return deniedPage(ctx, 'Quiz not available.');
  renderQuizAttempt(ctx, course, quiz);
} });

/* --------------------------- Course builder quizzes ---------------------- */
function builderQuizzes(pane, course, ctx) {
  const quizzes = Domain.courseQuizzes(course.id);
  pane.innerHTML = `<div class="card-head row-between wrap gap-sm"><h3>${t('quizzes')}</h3><div class="row gap-sm">${feature('aiQuizGen') && Domain.aiEnabled() && can('ai', 'use') ? `<button class="btn btn-secondary btn-sm" data-gen>${icon('sparkles', 14)} Generate with SDC Learn AI</button>` : ''}${can('quizzes', 'create') || can('courses', 'edit') ? `<button class="btn btn-primary btn-sm" data-new>${icon('plus', 14)} New ${t('quiz', true)}</button>` : ''}</div></div>
    <div class="card" data-t></div>`;
  dataTable(pane.querySelector('[data-t]'), {
    rows: () => Domain.courseQuizzes(course.id),
    columns: [
      { key: 'title', label: 'Title', primary: true, render: q => `<b>${esc(q.title)}</b><small class="muted block">${Domain.quizQuestions(q).length} questions</small>` },
      { key: 'status', label: 'Status', render: q => badge(q.status) },
      { key: 'attempts', label: 'Attempts', render: q => { const all = db().quizAttempts.filter(a => a.quizId === q.id), pending = all.filter(a => a.pendingShort).length; return all.length ? `<button class="btn btn-ghost btn-sm" data-att="${q.id}">${all.length} · Review${pending ? ` ${badge(`${pending} pending`, 'warning')}` : ''}</button>` : '0'; } }
    ],
    actions: q => `<button class="btn btn-ghost btn-sm" data-edit="${q.id}">Edit</button>${q.status !== 'published' ? `<button class="btn btn-primary btn-sm" data-pub="${q.id}">Publish</button>` : `<button class="btn btn-ghost btn-sm" data-un="${q.id}">Unpublish</button>`}<button class="btn btn-ghost btn-sm danger" data-del="${q.id}">${icon('trash', 14)}</button>`,
    emptyTitle: `No ${t('quizzes', true)}`, emptyIcon: 'clipboard',
    onDraw: body => {
      body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => quizEditorModal(course, findRecord('quizzes', b.dataset.edit), () => ctx.refresh()));
      body.querySelectorAll('[data-att]').forEach(b => b.onclick = () => quizAttemptsModal(findRecord('quizzes', b.dataset.att), () => ctx.refresh()));
      body.querySelectorAll('[data-pub]').forEach(b => b.onclick = () => { updateRecord('quizzes', b.dataset.pub, { status: 'published' }); toast('Published.'); ctx.refresh(); });
      body.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { updateRecord('quizzes', b.dataset.un, { status: 'draft' }); toast('Unpublished.'); ctx.refresh(); });
      body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (await confirmDialog('Delete this quiz?', { danger: true })) { deleteRecord('quizzes', b.dataset.del); ctx.refresh(); } });
    }
  });
  pane.querySelector('[data-new]')?.addEventListener('click', () => quizEditorModal(course, null, () => ctx.refresh()));
  pane.querySelector('[data-gen]')?.addEventListener('click', () => aiGenerateQuizModal(course, () => ctx.refresh()));
}

/* CHK: the instructor sees each short answer with the AI score and rationale, and the score they set is final. */
function quizAttemptsModal(quiz, done) {
  const shorts = Domain.quizQuestions(quiz).filter(q => q.type === 'short');
  const attempts = db().quizAttempts.filter(a => a.quizId === quiz.id).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const m = openModal({
    title: `${quiz.title} — attempts`, size: 'lg',
    body: attempts.map(a => `<div class="card tight mb" data-attempt="${a.id}"><div class="row-between"><b>${esc(userName(a.learnerId))}</b><span>${badge(`${a.percent}%`, a.pendingShort ? 'warning' : 'success')} <small class="muted">${esc(fmtDateTime(a.submittedAt))}</small></span></div>
      ${shorts.map(q => { const r = a.aiReviews?.[q.id] || {}; return `<div class="field mt-sm"><span class="label">${esc(q.stem)} <small class="muted">(max ${q.points || 1})</small></span>
        <p class="small">${esc(a.answers?.[q.id] || '—')}</p>
        ${r.rationale ? `<p class="small muted">${r.ai ? `${badge('SDC Learn AI', 'accent')} ` : r.by ? 'Reviewed by instructor · ' : ''}${esc(r.rationale)}</p>` : ''}
        <label class="row gap-sm small">Points <input class="input input-sm w-80" type="number" min="0" max="${q.points || 1}" step="0.5" data-q="${q.id}" value="${r.points ?? ''}" placeholder="Pending"></label></div>`; }).join('') || '<p class="small muted">No short-answer questions — objective items are scored automatically.</p>'}</div>`).join(''),
    footer: `<button class="btn btn-ghost" data-modal-close>Close</button>${shorts.length ? '<button class="btn btn-primary" data-save>Save reviews</button>' : ''}`
  });
  m.querySelector('[data-save]')?.addEventListener('click', () => {
    let changed = 0;
    m.querySelectorAll('[data-attempt]').forEach(card => {
      const a = findRecord('quizAttempts', card.dataset.attempt), reviews = { ...(a.aiReviews || {}) };
      card.querySelectorAll('[data-q]').forEach(inp => {
        if (inp.value === '') return;
        const q = shorts.find(x => x.id === inp.dataset.q), pts = Math.min(Number(q.points) || 1, Math.max(0, Number(inp.value)));
        if (reviews[q.id]?.points === pts && !reviews[q.id]?.ai) return;
        reviews[q.id] = { points: pts, rationale: reviews[q.id]?.ai ? `AI suggested ${reviews[q.id].points}; set by instructor.` : 'Set by instructor.', ai: false, by: App.user.id, at: new Date().toISOString() };
        changed++;
      });
      const g = Domain.gradeQuizAttempt(quiz, a.answers, reviews);
      updateRecord('quizAttempts', a.id, { aiReviews: reviews, score: g.score, maxScore: g.maxScore, percent: g.percent, detail: g.detail, pendingShort: g.pending });
    });
    m.close(); toast(changed ? `${changed} score${changed === 1 ? '' : 's'} updated.` : 'No changes.'); done?.();
  });
}

function quizEditorModal(course, quiz, done) {
  const qs = quiz ? Domain.quizQuestions(quiz) : [];
  const fields = [
    { name: 'title', label: 'Title', required: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
    { name: 'attemptLimit', label: 'Attempt limit (0 = unlimited)', type: 'number', min: 0 },
    { name: 'passPercent', label: 'Pass %', type: 'number', min: 0, max: 100 },
    { name: 'shuffle', label: 'Shuffle', type: 'checkbox', checkLabel: 'Shuffle questions per attempt' }
  ];
  const m = openModal({
    title: quiz ? `Edit ${t('quiz', true)}` : `New ${t('quiz', true)}`, size: 'lg',
    body: `<form data-f>${formHTML(fields, quiz || { attemptLimit: 2, passPercent: 50, shuffle: false })}
      <h3 class="mt">Questions</h3><div data-qs class="stack-sm">${qs.map(q => questionEditRow(q)).join('') || '<p class="muted small">No questions yet — add manually or generate with AI.</p>'}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-add-q>${icon('plus', 14)} Add question</button></form>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>`
  });
  const qsBox = m.querySelector('[data-qs]');
  qsBox.addEventListener('change', e => {
    const sel = e.target.closest('[data-type]'); if (!sel) return;
    const row = sel.closest('[data-qrow]');
    const keep = sel.value === 'true_false' || row.querySelector('[data-model]') ? [] : [...row.querySelectorAll('[data-opt]')].map(o => ({ id: o.dataset.oid, text: o.querySelector('input[type=text]').value, correct: o.querySelector('input[type=radio],input[type=checkbox]').checked }));
    row.querySelector('[data-opts]').innerHTML = questionOptsHTML({ id: row.dataset.qrow, type: sel.value, options: keep });
  });
  qsBox.addEventListener('click', e => {
    const row = e.target.closest('[data-qrow]'); if (!row) return;
    if (e.target.closest('[data-del-q]')) { row.remove(); return; }
    if (e.target.closest('[data-del-opt]')) { if (row.querySelectorAll('[data-opt]').length > 2) e.target.closest('[data-opt]').remove(); else toast('A question needs at least two options.', 'warning'); return; }
    if (e.target.closest('[data-add-opt]')) {
      const type = row.querySelector('[data-type]').value, ids = [...row.querySelectorAll('[data-opt]')].map(o => o.dataset.oid);
      const id = 'abcdefghij'.split('').find(c => !ids.includes(c)) || uid('o');
      e.target.closest('[data-add-opt]').insertAdjacentHTML('beforebegin', optionRow({ id: row.dataset.qrow, type }, { id, text: '', correct: false }));
    }
  });
  m.querySelector('[data-add-q]').onclick = () => {
    qsBox.querySelector(':scope > p')?.remove();
    qsBox.insertAdjacentHTML('beforeend', questionEditRow({ id: uid('QQ'), type: 'mcq_single', stem: '', points: 1, options: [{ id: 'a', text: '', correct: true }, { id: 'b', text: '', correct: false }] }));
  };
  m.querySelector('[data-save]').onclick = () => {
    const r = readForm(m.querySelector('[data-f]'), fields);
    if (!r.title) return toast('Title required.', 'error');
    const unanswered = [...qsBox.querySelectorAll('[data-qrow]')].find(row => row.querySelector('[data-stem]').value.trim() && row.querySelector('[data-type]').value !== 'short' && !row.querySelector('[data-opt] input:is([type=radio],[type=checkbox]):checked'));
    if (unanswered) return toast(`Mark the correct answer for: ${unanswered.querySelector('[data-stem]').value.trim()}`, 'error');
    const questionIds = [];
    qsBox.querySelectorAll('[data-qrow]').forEach(row => {
      const id = row.dataset.qrow;
      const type = row.querySelector('[data-type]').value;
      const stem = row.querySelector('[data-stem]').value.trim();
      const points = Number(row.querySelector('[data-pts]').value) || 1;
      if (!stem) return;
      let options = [], modelAnswer = '', keywords = [];
      if (type === 'short') {
        modelAnswer = row.querySelector('[data-model]')?.value || '';
        keywords = csvList(row.querySelector('[data-kw]')?.value || '');
      } else {
        options = [...row.querySelectorAll('[data-opt]')].map(o => ({
          id: o.dataset.oid, text: o.querySelector('input[type=text]').value, correct: o.querySelector('input[type=radio],input[type=checkbox]')?.checked
        })).filter(o => o.text);
      }
      const existing = findRecord('questions', id);
      const payload = { bankId: '', courseId: course.id, type, stem, options, modelAnswer, keywords, points, difficulty: 'medium', tags: [] };
      if (existing) updateRecord('questions', id, payload); else addRecord('questions', { ...payload, id });
      questionIds.push(id);
    });
    const data = { courseId: course.id, title: r.title, description: r.description || '', questionIds, attemptLimit: Number(r.attemptLimit) || 0, passPercent: Number(r.passPercent) || 50, shuffle: !!r.shuffle, status: quiz?.status || 'draft', timeLimitSec: 0 };
    if (quiz) updateRecord('quizzes', quiz.id, data); else addRecord('quizzes', data);
    m.close(); toast('Quiz saved.'); done?.();
  };
}

function optionRow(q, o) {
  return `<div class="opt-row" data-opt data-oid="${o.id}"><input type="${q.type === 'mcq_multi' ? 'checkbox' : 'radio'}" name="corr-${q.id}" ${o.correct ? 'checked' : ''} aria-label="Correct answer"><input class="input" type="text" value="${esc(o.text)}" placeholder="Option" ${q.type === 'true_false' ? 'readonly' : ''}>${q.type === 'true_false' ? '' : `<button type="button" class="icon-btn icon-btn-sm" data-del-opt aria-label="Remove option">${icon('x', 14)}</button>`}</div>`;
}
// The answer area depends on the type: model answer + keywords, fixed True/False, or editable options.
function questionOptsHTML(q) {
  if (q.type === 'short') return `<label class="label">Model answer</label><input class="input" data-model value="${esc(q.modelAnswer || '')}"><label class="label mt-sm">Keywords (comma separated)</label><input class="input" data-kw value="${esc((q.keywords || []).join(', '))}">`;
  if (q.type === 'true_false') {
    const correct = (q.options || []).find(o => o.correct)?.id === 'f' ? 'f' : 't';
    return `<span class="label">Correct answer</span>${[{ id: 't', text: 'True' }, { id: 'f', text: 'False' }].map(o => optionRow(q, { ...o, correct: o.id === correct })).join('')}`;
  }
  const opts = (q.options || []).length ? q.options : [{ id: 'a', text: '', correct: true }, { id: 'b', text: '', correct: false }];
  return `<span class="label">Options — tick the correct ${q.type === 'mcq_multi' ? 'answers' : 'answer'}</span>${opts.map(o => optionRow(q, o)).join('')}<button type="button" class="btn btn-ghost btn-sm" data-add-opt>${icon('plus', 14)} Add option</button>`;
}
function questionEditRow(q) {
  return `<div class="card tight" data-qrow="${q.id}"><div class="form-grid">
    <div class="field"><label class="label">Type</label><select class="input" data-type><option value="mcq_single" ${q.type === 'mcq_single' ? 'selected' : ''}>Multiple choice (one answer)</option><option value="mcq_multi" ${q.type === 'mcq_multi' ? 'selected' : ''}>Multiple choice (several answers)</option><option value="true_false" ${q.type === 'true_false' ? 'selected' : ''}>True / False</option><option value="short" ${q.type === 'short' ? 'selected' : ''}>Short answer</option></select></div>
    <div class="field"><label class="label">Points</label><input class="input" type="number" data-pts value="${q.points || 1}" min="1"></div>
    <div class="field full"><label class="label">Question</label><textarea class="input" data-stem rows="2">${esc(q.stem || '')}</textarea></div>
    <div class="field full stack-sm" data-opts>${questionOptsHTML(q)}</div>
  </div><div class="row-end"><button type="button" class="btn btn-ghost btn-sm danger" data-del-q>${icon('trash', 14)} Remove question</button></div></div>`;
}

function aiGenerateQuizModal(course, done) {
  const sessions = Domain.courseSessions(course.id);
  const m = openModal({
    title: 'SDC Learn AI — Generate quiz',
    body: `<form data-g class="stack-sm">
      <div class="field"><label class="label">Source ${t('session', true)}</label><select class="input" name="sid"><option value="">Whole course outline</option>${sessions.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></div>
      <div class="field"><label class="label">Count</label><input class="input" type="number" name="n" value="5" min="1" max="20"></div>
      <div class="field"><label class="label">Difficulty</label><select class="input" name="diff"><option>easy</option><option selected>medium</option><option>hard</option></select></div>
      <p class="help">Draft only — you choose what to keep. Never auto-published.</p></form><div data-draft></div>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-secondary" data-run>${icon('sparkles', 15)} Generate</button><button class="btn btn-primary" data-accept hidden>Add selected to new draft quiz</button>`
  });
  let draftItems = [];
  m.querySelector('[data-run]').onclick = async () => {
    const f = m.querySelector('[data-g]'); const sid = f.sid.value; const session = findRecord('sessions', sid);
    m.querySelector('[data-draft]').innerHTML = `<p class="muted">${icon('sparkles', 16)} Generating…</p>`;
    try {
      const out = await SDCAI.call('quizGenerate', {
        system: 'Return ONLY JSON array: [{"type":"mcq_single"|"true_false"|"short","stem":"...","options":[{"id":"a","text":"...","correct":bool}],"modelAnswer":"","keywords":[],"points":1,"rationale":""}]. English. Bloom-aware distractors.',
        prompt: `Generate ${f.n.value} ${f.diff.value} quiz items for ${course.title}. Session: ${session?.title || 'general'}. Summary: ${session?.summary || course.description || ''}. Outcomes: ${(course.outcomes || []).join('; ')}`,
        maxTokens: 2500
      });
      draftItems = JSON.parse(out.text.replace(/```json|```/g, '').trim());
      m.querySelector('[data-draft]').innerHTML = `<ul class="pick-list">${draftItems.map((q, i) => `<li><label class="check"><input type="checkbox" data-i="${i}" checked><span><b>${esc(q.stem)}</b><small class="muted block">${esc(q.type)}</small></span></label></li>`).join('')}</ul>`;
      m.querySelector('[data-accept]').hidden = false;
    } catch (err) { m.querySelector('[data-draft]').innerHTML = `<p class="danger">${esc(err.message)}</p>`; }
  };
  m.querySelector('[data-accept]').onclick = () => {
    const picked = [...m.querySelectorAll('[data-i]:checked')].map(x => draftItems[Number(x.dataset.i)]).filter(Boolean);
    if (!picked.length) return toast('Select at least one question.', 'warning');
    const questionIds = picked.map(q => {
      const id = uid('QQ');
      addRecord('questions', { id, courseId: course.id, type: q.type || 'mcq_single', stem: q.stem, options: q.options || [], modelAnswer: q.modelAnswer || '', keywords: q.keywords || [], points: q.points || 1, difficulty: 'medium', tags: [] });
      return id;
    });
    addRecord('quizzes', { courseId: course.id, title: `AI draft — ${course.code || course.title}`, description: 'Generated with SDC Learn AI — review before publishing.', questionIds, attemptLimit: 2, shuffle: false, status: 'draft', passPercent: 50, timeLimitSec: 0 });
    m.close(); toast('Draft quiz created — review in builder.'); done?.();
  };
}

// Wire builder tab from pages-manage (monkey-patch after load)
document.addEventListener('DOMContentLoaded', () => {});
window.builderQuizzes = builderQuizzes;
window.openTutorDrawer = openTutorDrawer;
window.summarizeResource = summarizeResource;
window.startPracticeQuiz = startPracticeQuiz;
