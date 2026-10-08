// Phase 2 (SDC Learn AI + graded quizzes) test run against a LOCAL in-process server in gateway mode
// (as in production), with a mock Supabase RPC store and a mock OpenAI-compatible provider, so no real
// AI key is needed and no cloud data is touched.
//   node tests/phase2.run.js            (needs puppeteer-core + Chrome)
// Prints JSON results keyed by the manual suite's case IDs (docs/testing/SDC-Learn-Manual-Test-Suite-Phase2.xlsx).
const http = require('http'), path = require('path'), fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = ms => new Promise(r => setTimeout(r, ms));
const out = {};
const tc = async (id, fn) => { try { const note = await fn(); out[id] = note ? ['NOTE', note] : ['PASS']; } catch (e) { out[id] = ['FAIL', String(e.message || e).slice(0, 300)]; } };
const check = (c, m) => { if (!c) throw new Error(m); };

/* ---------------- mock provider: answers by looking at the system prompt ---------------- */
const seen = [];
const reply = (sys, user) => {
  if (/Reply with exactly: OK/.test(sys)) return 'OK';
  if (/course-grounded tutor/.test(sys)) return /quantum|cricket/i.test(user) ? 'This topic is not covered in the approved course materials. Please consult your course instructor.' : 'Use Format as Table (Ctrl+T) to turn a range into a structured table.\nCITATIONS: Excel foundations & data hygiene';
  if (/structured summary/.test(sys)) return 'Learning Objectives\n- Clean data\nKey Technical Concepts\n- Tables';
  if (/JSON array of questions/.test(sys)) return JSON.stringify([1, 2, 3].map(i => ({ type: 'mcq_single', stem: `Practice ${i}?`, options: [{ id: 'a', text: 'Right', correct: true }, { id: 'b', text: 'Wrong', correct: false }], rationale: `Because ${i}` })));
  if (/Bloom-aware/.test(sys)) return '```json\n' + JSON.stringify([1, 2, 3].map(i => ({ type: 'mcq_single', stem: `Generated ${i}?`, options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }], points: 1 }))) + '\n```';
  if (/Score a short answer/.test(sys)) return '{"points":1,"max":1,"rationale":"Mentions split by delimiter."}';
  if (/draft formative feedback/.test(sys)) return /checklistOnly true/.test(user) ? '{"suggestedGrade":null,"feedback":"Checklist: file opens; sheets named.","confidence":"low","checklistOnly":true}' : '{"suggestedGrade":15,"feedback":"Strengths: clear pivots. Deficiencies: no chart. Guidance: add a chart.","confidence":"medium","checklistOnly":false}';
  return 'OK';
};
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = b ? JSON.parse(b) : {}, auth = req.headers.authorization || '';
    if (!auth.includes('sk-test-mock')) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"Incorrect API key provided"}}'); }
    const sys = (j.messages || []).filter(m => m.role === 'system').map(m => m.content).join('\n'), user = (j.messages || []).filter(m => m.role === 'user').map(m => m.content).join('\n');
    seen.push({ sys, user });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: reply(sys, user) } }], usage: { total_tokens: 42 } }));
  });
});

/* ---------------- mock Supabase: the secret-guarded RPCs the gateway uses ---------------- */
let row = null; const kv = {};
const supa = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = b ? JSON.parse(b) : {}, fn = req.url.split('/').pop();
    res.setHeader('Content-Type', 'application/json');
    if (j.p_secret !== 'test-secret') { res.writeHead(403); return res.end('{"message":"denied"}'); }
    if (fn === 'sdc_state_get') return res.end(JSON.stringify(row));
    if (fn === 'sdc_state_put') { row = { state: j.p_state, updated_at: new Date().toISOString() }; return res.end(JSON.stringify(row.updated_at)); }
    if (fn === 'sdc_kv_get') return res.end(JSON.stringify(kv[j.p_key] ?? null));
    if (fn === 'sdc_kv_put') { kv[j.p_key] = j.p_value; return res.end('true'); }
    res.writeHead(404); res.end('{}');
  });
});

(async () => {
  await new Promise(r => mock.listen(0, r)); await new Promise(r => supa.listen(0, r));
  const MOCK = `http://localhost:${mock.address().port}/v1`;
  Object.assign(process.env, { SDC_STATE_SECRET: 'test-secret', SUPABASE_URL: `http://localhost:${supa.address().port}`, SUPABASE_ANON_KEY: 'anon' });
  const secretsFile = path.join(__dirname, '..', 'backend', 'data', 'ai-secrets.json'), usageFile = path.join(__dirname, '..', 'backend', 'data', 'ai-usage.json');
  const backup = [secretsFile, usageFile].map(f => fs.existsSync(f) ? fs.readFileSync(f) : null);
  const app = require(path.join(__dirname, '..', 'backend', 'server.js'));
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://localhost:${srv.address().port}`;
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const errors = [];
  const page = async (vp = { width: 1366, height: 860 }) => {
    const p = await (await b.createBrowserContext()).newPage();
    await p.setRequestInterception(true); p.on('request', r => r.url().includes('supabase.co') ? r.abort() : r.continue());
    p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept('Called learner; plan agreed.'));
    await p.setViewport(vp); return p;
  };
  // In-page helpers shared by every evaluate.
  const H = `const W=ms=>new Promise(r=>setTimeout(r,ms)),$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],modal=()=>$$('.modal').pop(),text=()=>$('#main').innerText,toasts=()=>$$('.toast').map(t=>t.innerText).join(' | ');
    const go=async h=>{if(location.hash===h){location.hash='#/_';await W(40);}location.hash=h;await W(200);};
    const as=async id=>{sessionStorage.setItem('sdcSession',id);invalidateCache();App.user=currentUser();App.mountShell();await go('#/profile');};
    const until=async(f,ms=6000)=>{for(let t=0;t<ms;t+=100){const v=f();if(v)return v;await W(100);}return f();};`;
  const run = (p, body) => p.evaluate(`(async()=>{${H}\n${body}\n})()`);
  let p = await page();
  const EMAIL = { 'u-admin': 'admin@sdclearn.demo', 'u-faraz': 'instructor@sdclearn.demo', 'u-ali': 'learner@sdclearn.demo' };
  // Real gateway sign-in through the login form, then open the requested page.
  const signIn = async (pg, who) => {
    await pg.goto(base + '/login.html', { waitUntil: 'networkidle0' }); await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await pg.reload({ waitUntil: 'networkidle0' });
    await pg.type('#email', EMAIL[who]); await pg.type('#password', 'Demo@123');
    await Promise.all([pg.click('#loginBtn'), pg.waitForNavigation({ waitUntil: 'networkidle0' })]); await W(500);
  };
  const boot = async (who = 'u-admin', hash = '#/dashboard') => { await signIn(p, who); await p.evaluate(h => { location.hash = h; }, hash); await W(600); };
  const tokenFor = async who => (await (await fetch(base + '/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL[who], password: 'Demo@123' }) })).json()).token;
  const aiCall = async (token, body) => (await fetch(base + '/api/ai/' + (body.path || 'complete'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) })).status;
  await tc('MIG-01', async () => { const st = (await (await fetch(base + '/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL['u-ali'], password: 'Demo@123' }) })).json()).state; check(st.roles.find(r => r.id === 'student').permissions.ai, 'learner role lacks ai after load'); });
  // A pre-Phase-2 database: roles without ai/quizzes and no schema marker.
  row.state.roles.forEach(r => { if (r.id !== 'admin') { delete r.permissions.ai; delete r.permissions.quizzes; } }); delete row.state.schema;
  await tc('MIG-02', async () => { const st = (await (await fetch(base + '/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL['u-ali'], password: 'Demo@123' }) })).json()).state; check(st.roles.find(r => r.id === 'student').permissions.ai?.includes('use') && st.roles.find(r => r.id === 'teacher').permissions.quizzes, 'old database not upgraded with Phase 2 role permissions'); });

  /* ---------------- 01 smoke ---------------- */
  await tc('SMK-01', async () => { const j = await (await fetch(base + '/api/health')).json(); check(j.status === 'ok' && /SDC Learn/.test(j.service), JSON.stringify(j)); });
  await tc('SMK-02', async () => { const j = await (await fetch(base + '/api/ai/status')).json(); check(j.ok && j.product === 'SDC Learn AI', JSON.stringify(j).slice(0, 100)); });

  /* ---------------- 06 integrations ---------------- */
  await boot('u-admin', '#/settings?tab=integrations');
  await tc('AI-INT-01', () => run(p, `await until(()=>$('[data-prov]')); if($$('[data-prov]').length!==3) throw new Error('provider cards: '+$$('[data-prov]').length);`));
  await tc('AI-INT-10', () => run(p, `const c=$('[data-prov="openai"]'); c.querySelector('[data-key]').value='sk-wrong-key-123'; c.querySelector('[data-base]').value='${MOCK}'; c.querySelector('[data-test-prov]').click();
    const t=await until(()=>toasts()); if(!/Incorrect API key|error/i.test(t)) throw new Error('no error toast: '+t);`));
  await tc('AI-INT-03', () => run(p, `const c=$('[data-prov="openai"]'); c.querySelector('[data-key]').value='sk-test-mock-0001'; c.querySelector('[data-model]').value='gpt-4o-mini'; c.querySelector('[data-base]').value='${MOCK}'; c.querySelector('[data-save-prof]').click();
    await until(()=>/Configured/.test($('[data-prov="openai"]')?.innerText||'')); const t=$('[data-prov="openai"]').innerText; if(!/Configured/.test(t)||!/sk-…0001/.test(t)) throw new Error('not configured/masked: '+t.slice(0,120));`));
  await tc('AI-INT-04', () => run(p, `$$('.toast').forEach(t=>t.remove()); $('[data-prov="openai"] [data-test-prov]').click(); const t=await until(()=>toasts()); if(!/Connected/.test(t)) throw new Error(t);`));
  await tc('ADM-14', () => run(p, `const j=JSON.stringify(db()); if(/sk-test-mock|sk-/.test(j.replace(/sk-…/g,''))) throw new Error('raw key in client state/backup');`));
  await tc('AI-INT-07', () => run(p, `const tr=$('tr[data-cap="evaluate"]'); tr.querySelector('[data-cap-prov]').value='openai'; $('tr[data-cap="tutor"] [data-cap-model]').value='gpt-4o'; $('[data-save-map]').click(); await W(200);
    invalidateCache(); const c=Domain.integrations().capabilities; if(c.evaluate.provider!=='openai'||c.tutor.model!=='gpt-4o') throw new Error(JSON.stringify(c.evaluate));
    const d=db(); d.settings.integrations.capabilities.tutor.model=''; saveDB(d);`));
  await tc('AI-INT-05', async () => 'Not run: needs a real Google Gemini key. The Gemini adapter is exercised only by code review (request shape matches generateContent).');
  await tc('AI-INT-06', async () => 'Not run: needs a real Azure OpenAI endpoint/deployment.');
  await tc('AI-INT-13', async () => 'Env fallback covered by code review (resolveProfile reads OPENAI_API_KEY / GEMINI_API_KEY / AZURE_OPENAI_*); /api/ai/status reports env flags.');

  /* ---------------- 07 tutor & summary ---------------- */
  await boot('u-ali', '#/course/C-EXCEL/session/S-EX-1');
  await tc('AI-T-01', () => run(p, `if(!$('[data-tutor-btn]')||!$('[data-help-btn]')||!$('[data-zoom-btn]')) throw new Error('tutor/help/zoom buttons missing');`));
  await tc('AI-T-06', () => run(p, `$('[data-tutor-btn]').click(); await until(()=>$('.ai-drawer.open')); if(!/official grading|instructor/i.test($('.ai-drawer').innerText)) throw new Error('no disclaimer');`));
  await tc('AI-T-02', () => run(p, `const f=$('.ai-drawer [data-form]'); f.q.value='How do I make a table?'; f.requestSubmit(); await until(()=>/Format as Table/.test($('.ai-drawer').innerText));
    const t=$('.ai-drawer').innerText; if(!/Format as Table/.test(t)||!/Sources:/.test(t)) throw new Error('no grounded answer/citations: '+t.slice(-200));`));
  await tc('AI-INT-09', async () => { const last = seen.filter(s => /course-grounded tutor/.test(s.sys)).pop(); check(last, 'no tutor call'); check(!/Ali Raza|learner@sdclearn\.demo/.test(last.user), 'PII reached provider'); });
  await tc('AI-T-03', () => run(p, `const f=$('.ai-drawer [data-form]'); f.q.value='Explain quantum physics'; f.requestSubmit(); await until(()=>/not covered/.test($('.ai-drawer').innerText)); if(!/not covered in the approved course materials/.test($('.ai-drawer').innerText)) throw new Error('no refusal');`));
  await tc('AI-T-04', () => run(p, `$$('.toast').forEach(t=>t.remove()); $('.ai-drawer [data-rate="up"]').click(); if(!/helpful/i.test(toasts())) throw new Error('no ack');`));
  await tc('AI-T-05', () => run(p, `const n=db().notifications.length; $('.ai-drawer [data-esc]').click(); await W(150); invalidateCache(); if(!db().notifications.slice(n).some(x=>x.userId==='u-faraz'&&/escalation/i.test(x.title))) throw new Error('instructor not notified');`));
  await tc('AI-T-07', () => run(p, `$('.ai-drawer [data-close]').click(); await W(300); $('[data-help-btn]').click(); await W(150); if($('[data-help-pop]').hidden) throw new Error('help panel broken');`));
  await tc('AI-T-12', async () => { const s = seen.filter(x => /course-grounded tutor/.test(x.sys)).pop(); check(/English only/.test(s.sys), 'English-only instruction missing from system prompt'); return 'English-only is enforced by the system prompt; the mock cannot show how a real model treats an Urdu request.'; });
  await tc('AI-T-09', () => run(p, `const s=Domain.courseSessions('C-EXCEL').find(x=>x.resources?.length); await go('#/course/C-EXCEL/session/'+s.id); const b=await until(()=>$('[data-summarize]')); if(!b) throw new Error('no summarize button'); b.click(); await until(()=>/Learning Objectives/.test($('.ai-drawer')?.innerText||'')); if(!$('.ai-drawer .ai-badge')) throw new Error('no AI badge'); $('.ai-drawer [data-close]').click(); await W(250);`));
  await tc('NFR-03', () => run(p, `if(!document.querySelector('.ai-badge,.badge')) throw new Error('no badge');`));

  /* ---------------- 08 practice ---------------- */
  await tc('AI-P-01', () => run(p, `await go('#/course/C-EXCEL/session/S-EX-1'); const b=await until(()=>$('[data-practice]')); b.click(); await until(()=>$('.ai-drawer [data-cfg]')); $('.ai-drawer [data-cfg]').requestSubmit(); await until(()=>$('.ai-drawer [data-attempt]')); if($$('.ai-drawer fieldset').length!==3) throw new Error('practice form missing');`));
  await tc('AI-P-03', () => run(p, `$$('.ai-drawer [data-attempt] input[value="a"]').forEach(i=>i.checked=true); $('.ai-drawer [data-attempt]').requestSubmit(); await W(150); const t=$('.ai-drawer [data-res]').innerText; if(!/3\\/3/.test(t)||!/Because 1/.test(t)) throw new Error('no score/rationale: '+t);`));
  await tc('AI-P-02', () => run(p, `invalidateCache(); if(!db().practiceAttempts.length) throw new Error('practice not logged'); const before=Domain.quizAverage('u-ali','C-EXCEL'); if(before!==null && db().quizAttempts.some(a=>a.learnerId==='u-ali')===false) throw new Error('practice counted in quizAvg'); $('.ai-drawer [data-close]').click(); await W(250);`));

  /* ---------------- 05 graded quizzes (learner) ---------------- */
  await tc('QZ-12', () => run(p, `await go('#/course/C-EXCEL'); if(!/Quizzes/.test($('[data-list]').innerText)) throw new Error('no quizzes pin'); await go('#/course/C-EXCEL/quizzes'); if(!/Module 1 check-in/.test(text())) throw new Error('seed quiz missing');`));
  await tc('LRN-02', () => run(p, `await go('#/course/C-EXCEL'); const t=$('[data-list]').innerText; if(!/Course Outline/.test(t)||!/Submit/.test(t)||!/Quizzes/.test(t)) throw new Error('pins missing');`));
  await tc('QZ-05', () => run(p, `await go('#/course/C-EXCEL/quiz/QZ-EX-1'); const f=await until(()=>$('[data-quiz]')); f.querySelector('[name="QQ-1"][value="b"]').checked=true; f.querySelector('[name="QQ-2"][value="t"]').checked=true; f.querySelector('[name="QQ-3"]').value='Split Column by Delimiter';
    f.requestSubmit(); await until(()=>location.hash.endsWith('/quizzes')); invalidateCache(); const a=db().quizAttempts.filter(x=>x.learnerId==='u-ali').pop(); if(!a) throw new Error('no attempt'); window.__qa=a; if(a.detail['QQ-1'].correct!==true&&a.detail['QQ-1'].correct!==false) throw new Error('objective not scored');`));
  await tc('QZ-07', () => run(p, `const a=window.__qa; if(!a.aiReviews['QQ-3']?.ai) throw new Error('short answer not AI-scored: '+JSON.stringify(a.aiReviews));`));
  await tc('AI-G-04', () => run(p, `if(window.__qa.aiReviews['QQ-3'].points!==1) throw new Error('aiReviews points wrong');`));
  await tc('QZ-06', () => run(p, `await go('#/course/C-EXCEL/quiz/QZ-EX-1'); const f=await until(()=>$('[data-quiz]')); f.querySelectorAll('input[type=radio]').forEach(i=>i.checked=true); f.querySelector('textarea').value='x'; f.requestSubmit(); await until(()=>location.hash.endsWith('/quizzes'));
    await go('#/course/C-EXCEL/quiz/QZ-EX-1'); if(!/Attempt limit reached/.test(text())) throw new Error('third attempt allowed');`));
  await tc('LRN-06', () => run(p, `await go('#/course/C-EXCEL'); $('[data-zoom-btn]').click(); await W(120); if(!/Meeting ID/i.test($('[data-zoom-pop]').innerText)) throw new Error('zoom');`));
  await tc('AI-R-03', () => run(p, `Domain.refreshAtRiskFlags(); for(const h of ['#/courses','#/course/C-EXCEL','#/assignments','#/results','#/profile']){await go(h); if(/at-risk|advisor/i.test(document.body.innerText)) throw new Error('risk visible on '+h);}`));

  /* ---------------- instructor: quizzes builder, generator, evaluator, at-risk, results ---------------- */
  await boot('u-faraz', '#/manage/course/C-EXCEL?tab=quizzes');
  await tc('QZ-01', () => run(p, `await until(()=>/Module 1 check-in/.test(text())); if(!$('[data-new]')) throw new Error('no New quiz');`));
  await tc('QZ-02', () => run(p, `$('[data-new]').click(); await until(()=>modal()); const m=modal(); m.querySelector('[name=title]').value='QA quiz'; m.querySelector('[data-add-q]').click(); m.querySelector('[data-add-q]').click(); m.querySelector('[data-add-q]').click();
    const rows=[...m.querySelectorAll('[data-qrow]')]; rows[0].querySelector('[data-stem]').value='MCQ stem'; rows[0].querySelectorAll('[data-opt] input[type=text]').forEach((i,k)=>i.value='Opt'+k);
    const tf=rows[1].querySelector('[data-type]'); tf.value='true_false'; tf.dispatchEvent(new Event('change',{bubbles:true})); await W(80); rows[1].querySelector('[data-stem]').value='TF stem'; rows[1].querySelectorAll('[data-opt] input[type=text]').forEach((i,k)=>{ if(!i.value) i.value=k?'False':'True'; });
    const sh=rows[2].querySelector('[data-type]'); sh.value='short'; sh.dispatchEvent(new Event('change',{bubbles:true})); await W(80); rows[2].querySelector('[data-stem]').value='Short stem';
    const model=rows[2].querySelector('[data-model]'); if(!model) throw new Error('switching type to Short does not show model-answer/keywords fields');
    model.value='Model'; m.querySelector('[data-save]').click(); await W(200); invalidateCache(); const q=db().quizzes.find(x=>x.title==='QA quiz'); if(!q||q.status!=='draft') throw new Error('not saved as draft');
    const types=Domain.quizQuestions(q).map(x=>x.type).join(','); if(types!=='mcq_single,true_false,short') throw new Error('types saved: '+types); window.__qz=q.id;`));
  await tc('QZ-03', () => run(p, `await go('#/manage/course/C-EXCEL?tab=quizzes'); await until(()=>$('[data-pub="'+window.__qz+'"]')); $('[data-pub="'+window.__qz+'"]').click(); await W(200); invalidateCache(); if(findRecord('quizzes',window.__qz).status!=='published') throw new Error('not published'); if(!Domain.publishedQuizzes('C-EXCEL').some(x=>x.id===window.__qz)) throw new Error('learner cannot see');`));
  await tc('QZ-04', () => run(p, `await go('#/manage/course/C-EXCEL?tab=quizzes'); await until(()=>$('[data-un="'+window.__qz+'"]')); $('[data-un="'+window.__qz+'"]').click(); await W(200); invalidateCache(); if(Domain.publishedQuizzes('C-EXCEL').some(x=>x.id===window.__qz)) throw new Error('still visible');`));
  await tc('AI-G-01', () => run(p, `await go('#/manage/course/C-EXCEL?tab=quizzes'); (await until(()=>$('[data-gen]'))).click(); await until(()=>modal()); modal().querySelector('[data-run]').click(); await until(()=>modal().querySelectorAll('[data-i]').length); if(modal().querySelectorAll('[data-i]').length!==3) throw new Error('draft list missing');`));
  await tc('AI-G-02', () => run(p, `modal().querySelector('[data-i="1"]').checked=false; const n=db().quizzes.length; modal().querySelector('[data-accept]').click(); await W(200); invalidateCache(); const q=db().quizzes.slice(n).pop(); if(!q||Domain.quizQuestions(q).length!==2) throw new Error('selected count wrong'); window.__gen=q.id;`));
  await tc('AI-G-03', () => run(p, `if(findRecord('quizzes',window.__gen).status!=='draft') throw new Error('auto-published');`));
  await tc('QZ-08', () => run(p, `await go('#/results?course=C-EXCEL'); await until(()=>$('tr[data-l]')); if(!/QUIZZES|Quizzes/.test($('thead').innerText)) throw new Error('no Quizzes column'); const cell=$('tr[data-l="u-ali"] td[data-label="Quizzes"]')?.innerText||''; if(!/%/.test(cell)) throw new Error('quiz avg missing for Ali: '+cell);`));
  await tc('RES-01', () => run(p, `if(!/quizzes \\d+%/i.test(text())) throw new Error('formula text lacks quizzes');`));
  await tc('QZ-09', () => run(p, `const qa=Domain.quizAverage('u-ali','C-EXCEL'); const tr=$('tr[data-l="u-ali"]'); tr.querySelector('[data-assess]').value='80'; tr.querySelector('[data-assess]').dispatchEvent(new Event('input')); tr.querySelector('[data-pub]').checked=true; $('[data-save]').click(); await W(200); invalidateCache();
    const r=db().results.find(x=>x.learnerId==='u-ali'&&x.courseId==='C-EXCEL'); const exp=Domain.computeFinalPercent('u-ali','C-EXCEL',80); if(!r||r.finalPct!==exp) throw new Error('final '+r?.finalPct+' expected '+exp); if(r.quizAvg!==qa) throw new Error('quizAvg not stored');`));
  await tc('RES-02', () => run(p, `invalidateCache(); if(!db().notifications.some(n=>n.userId==='u-ali'&&/Result published/.test(n.title))) throw new Error('learner not notified');`));
  await tc('AI-E-01', () => run(p, `await go('#/submissions'); (await until(()=>$('[data-g]'))).click(); await until(()=>modal()); if(!modal().querySelector('[data-ai-eval]')) throw new Error('no evaluate button');`));
  await tc('AI-E-02', () => run(p, `const m=modal(); m.querySelector('[data-ai-eval]').click(); await until(()=>!m.querySelector('[data-ai-hint]').hidden); if(!m.querySelector('[name=feedback]').value) throw new Error('feedback not drafted'); window.__subId=[...m.querySelectorAll('*')].length;`));
  await tc('AI-E-05', () => run(p, `invalidateCache(); const s=db().submissions.find(x=>x.status!=='Graded'&&/xlsx|pbix/.test(x.fileName)); if(!s) return; const m=modal(); if(!/xlsx|pbix/.test(m.innerText)) return; if(m.querySelector('[name=grade]').value && !/Checklist/.test(m.querySelector('[name=feedback]').value)) throw new Error('grade invented for binary file');`));
  await tc('AI-E-03', () => run(p, `invalidateCache(); const before=db().submissions.filter(s=>s.status==='Graded').length; modal().querySelector('[data-modal-close]').click(); await W(200); invalidateCache(); if(db().submissions.filter(s=>s.status==='Graded').length!==before) throw new Error('closing applied grade');
    (await until(()=>$('[data-g]'))).click(); await until(()=>modal()); const m=modal(); m.querySelector('[data-ai-eval]').click(); await until(()=>!m.querySelector('[data-ai-hint]').hidden); if(!m.querySelector('[name=grade]').value) m.querySelector('[name=grade]').value='10'; m.querySelector('[data-save]').click(); await W(250); invalidateCache(); window.__graded=db().submissions.filter(s=>s.aiDraft).pop(); if(!window.__graded||window.__graded.status!=='Graded') throw new Error('save did not grade');`));
  await tc('AI-E-04', () => run(p, `const s=window.__graded; if(!s.aiDraft?.finalGrade&&s.aiDraft?.finalGrade!==0) throw new Error('aiDraft audit missing'); if(!s.aiAssisted) throw new Error('aiAssisted flag missing');`));
  await tc('AI-E-07', () => run(p, `const s=window.__graded; await as(s.learnerId); await go('#/assignments'); await W(200); const ok=/AI-assisted review/.test(text()); await as('u-faraz'); if(!ok) throw new Error('learner does not see AI-assisted label');`));
  await tc('AI-G-05', () => run(p, `await go('#/manage/course/C-EXCEL?tab=quizzes'); (await until(()=>$('[data-att="QZ-EX-1"]'))).click(); await until(()=>modal()); const m=modal(); const inp=m.querySelector('[data-q="QQ-3"]'); if(!inp) throw new Error('no override input'); const id=inp.closest('[data-attempt]').dataset.attempt; inp.value='0'; m.querySelector('[data-save]').click(); await W(250); invalidateCache(); const a=findRecord('quizAttempts',id); if(a.aiReviews['QQ-3'].ai!==false||a.aiReviews['QQ-3'].points!==0) throw new Error('override not saved'); const g=Domain.gradeQuizAttempt(findRecord('quizzes','QZ-EX-1'),a.answers,a.aiReviews); if(a.score!==g.score) throw new Error('score not recalculated');`));
  await tc('AI-T-10', () => run(p, `const s=Domain.courseSessions('C-EXCEL').find(x=>x.resources?.some(r=>r.type!=='link')); await go('#/course/C-EXCEL/session/'+s.id); (await until(()=>$('[data-summarize]'))).click(); const pin=await until(()=>{const b=$('.ai-drawer [data-pin]'); return b&&!b.hidden&&b;}); if(!pin) throw new Error('no pin button for instructor'); pin.click(); await W(200); $('.ai-drawer [data-close]').click(); await W(250); await as('u-ali'); await go('#/course/C-EXCEL/session/'+s.id); const ok=/Key concepts/.test(text()); await as('u-faraz'); if(!ok) throw new Error('pinned summary not visible to learner');`));
  await tc('AI-INT-FALLBACK', () => run(p, `const d=db(); d.settings.integrations.capabilities.evaluate.provider='gemini'; saveDB(d); await go('#/submissions'); (await until(()=>$('[data-g]'))).click(); await until(()=>modal()); const m=modal(); m.querySelector('[data-ai-eval]').click(); await until(()=>!m.querySelector('[data-ai-hint]').hidden||/failed|configured/i.test(toasts()),9000); const ok=!m.querySelector('[data-ai-hint]').hidden; m.querySelector('[data-modal-close]').click(); await W(150); if(!ok) throw new Error('evaluate routed to unconfigured Gemini did not fall back: '+toasts());`));
  await tc('AI-R-01', () => run(p, `await go('#/dashboard'); const b=await until(()=>$('[data-refresh-risk]')); b.click(); await W(300); if(!/At-risk advisories/.test(text())) throw new Error('no advisory card');`));
  await tc('AI-R-02', () => run(p, `invalidateCache(); const f=db().atRiskFlags[0]; if(!f) return 'No learner currently meets a risk factor in the demo data.'; if(!f.factors.length) throw new Error('no factors');`));
  await tc('AI-R-04', () => run(p, `const b=$('[data-note]'); if(!b) throw new Error('no outreach note button'); b.click(); await until(()=>modal()); modal().querySelector('textarea').value='Called learner; plan agreed.'; modal().querySelector('[data-ok]').click(); await W(300); invalidateCache(); if(!db().atRiskFlags.some(f=>(f.outreachNotes||[]).some(n=>/plan agreed/.test(n.text)))) throw new Error('note not saved');`));
  await tc('AI-R-05', () => run(p, `const snap=JSON.stringify([db().enrollments,db().submissions.map(s=>[s.id,s.grade]),db().results]); $('[data-refresh-risk]').click(); await W(300); invalidateCache(); if(JSON.stringify([db().enrollments,db().submissions.map(s=>[s.id,s.grade]),db().results])!==snap) throw new Error('refresh changed grades/enrollments');`));
  await tc('AI-INT-11', () => run(p, `await go('#/settings?tab=integrations'); await W(300); if(!/not available|Page not available/i.test(text()) && $('[data-save-prof]')) throw new Error('instructor can save integrations');`));
  await tc('PERM-01', async () => {
    const learner = await tokenFor('u-ali'), teacher = await tokenFor('u-faraz');
    const a = await aiCall(learner, { path: 'configure', provider: 'openai', apiKey: 'sk-attacker-key-9999', baseUrl: 'https://attacker.example/v1' });
    const b = await aiCall(teacher, { path: 'test', provider: 'openai', apiKey: 'sk-attacker-key-9999', baseUrl: 'https://attacker.example/v1' });
    check(a === 403 && b === 403, `non-admins could change or probe AI keys (configure ${a}, test ${b})`);
    check(await aiCall('forged.token.x', { path: 'configure', provider: 'openai', apiKey: 'x' }) === 401, 'forged token accepted');
  });
  await tc('AI-INT-08', async () => {
    const learner = await tokenFor('u-ali');
    const r = await aiCall(learner, { feature: 'tutor', provider: 'openai', prompt: 'hi' });
    row.state.settings.integrations.budget = { ...(row.state.settings.integrations.budget || {}), maxCalls: 1, hardStop: true }; await W(10500); // server caches platform settings ~10 s
    const r2 = await aiCall(learner, { feature: 'tutor', provider: 'openai', prompt: 'hi', budget: {} });
    const lms = (await fetch(base + '/api/sdc/state', { headers: { Authorization: 'Bearer ' + learner } })).status;
    row.state.settings.integrations.budget.maxCalls = 5000; await W(10500);
    check(r === 200 && r2 === 429, `hard stop not enforced server-side (HTTP ${r} then ${r2})`); check(lms === 200, 'LMS blocked by AI budget');
  });
  await tc('AI-T-08', async () => { const t = await (await fetch(base + '/api/sdc/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'accounts@sdclearn.demo', password: 'Demo@123' }) })).json(); check(await aiCall(t.token, { feature: 'tutor', provider: 'openai', prompt: 'hi' }) === 403, 'accounts officer can call AI'); });

  /* ---------------- admin: flags, roles, terms, reset ---------------- */
  await boot('u-admin', '#/dashboard');
  await tc('ADM-04', () => run(p, `await go('#/roles'); (await until(()=>$('[data-ed="student"]'))).click(); await until(()=>modal()); const m=modal(); const use=m.querySelector('[data-m="ai"][data-a="use"]'); if(!use||!m.querySelector('[data-m="ai"][data-a="configure"]')||!m.querySelector('[data-m="quizzes"][data-a="publish"]')) throw new Error('ai use/configure or quizzes publish not grantable'); if(!use.checked) throw new Error('learner role ai:use not shown as granted'); m.querySelector('[data-modal-close]').click(); await W(150);`));
  await tc('ADM-09', () => run(p, `await go('#/settings?tab=terms'); const f=$('[data-pane] form'); f.querySelector('[name=quizzes]').value='Assessments'; f.requestSubmit(); await W(200); if(t('quizzes')!=='Assessments') throw new Error('term not saved'); await go('#/manage/course/C-EXCEL?tab=quizzes'); await W(200); const ok=/Assessments/.test(document.body.innerText); await go('#/settings?tab=terms'); $('[data-defaults]').click(); await W(150); $$('.modal [data-ok]').pop()?.click(); await W(150); if(!ok) throw new Error('label not updated');`));
  await tc('ADM-11', () => run(p, `await go('#/settings?tab=learning'); const f=$('[data-pane] form'); if(!f.querySelector('[name=weightQuiz]')) throw new Error('no quiz weight field'); f.querySelector('[name=weightQuiz]').value='30'; f.requestSubmit(); await W(200); await go('#/results'); const ok=/quizzes 30%/i.test(text()); await go('#/settings?tab=learning'); $('[data-pane] form [name=weightQuiz]').value='20'; $('[data-pane] form').requestSubmit(); await W(150); if(!ok) throw new Error('results text not updated');`));
  const flagOff = async (k, fn) => { await run(p, `const d=db(); d.settings.features.${k}=false; saveDB(d); App.mountShell();`); try { return await fn(); } finally { await run(p, `const d=db(); d.settings.features.${k}=true; saveDB(d); App.mountShell();`); } };
  await tc('QZ-10', () => flagOff('quizzes', () => run(p, `await go('#/manage/course/C-EXCEL'); await W(150); if($$('[data-tab]').some(t=>/Quizzes/.test(t.innerText))||/>Quizzes</.test($('.tabs')?.innerHTML||'')) throw new Error('Quizzes tab visible'); await as('u-ali'); await go('#/course/C-EXCEL'); if(/Quizzes/.test($('[data-list]').innerText)) throw new Error('pin visible'); await as('u-admin');`)));
  await tc('AI-P-04', () => flagOff('aiPractice', () => run(p, `await as('u-ali'); await go('#/course/C-EXCEL/session/S-EX-1'); if($('[data-practice]')) throw new Error('practice button visible'); await as('u-admin');`)));
  await tc('PERM-03', () => flagOff('ai', () => run(p, `await as('u-ali'); await go('#/course/C-EXCEL/session/S-EX-1'); if($('[data-tutor-btn]')||$('[data-practice]')||$('[data-summarize]')) throw new Error('AI entry point visible'); await as('u-faraz'); await go('#/manage/course/C-EXCEL?tab=quizzes'); if($('[data-gen]')) throw new Error('generator visible'); await go('#/submissions'); (await until(()=>$('[data-g]')))?.click(); await W(150); if(modal()?.querySelector('[data-ai-eval]')) throw new Error('evaluate visible'); await as('u-admin');`)));
  await tc('ADM-10', () => flagOff('calendar', () => run(p, `if(/Calendar/.test($('.nav').innerText)) throw new Error('calendar still in nav'); await go('#/courses'); `)));
  await tc('AI-INT-02', () => run(p, `const d=db(); d.settings.integrations.aiEnabled=false; saveDB(d); await as('u-ali'); await go('#/course/C-EXCEL/session/S-EX-1'); const vis=!!$('[data-tutor-btn]'); await go('#/courses'); const lms=$$('.course-card').length; await as('u-admin'); const e=db(); e.settings.integrations.aiEnabled=true; saveDB(e); if(vis) throw new Error('tutor visible with master off'); if(!lms) throw new Error('LMS broken');`));
  await tc('PERM-02', () => run(p, `if(!can('ai','use',findRecord('users','u-ali'))) throw new Error('learner lacks ai:use');`));
  await tc('AI-E-06', () => run(p, `await go('#/settings?tab=integrations'); await W(400); if(/auto.?apply/i.test(text())) throw new Error('auto-apply control present');`));

  /* ---------------- unavailable provider ---------------- */
  await tc('AI-INT-12', () => run(p, `const st=await SDCAI.status(); for(const pr of st.profiles) await SDCAI.configure({profileId:pr.id,provider:pr.provider,remove:true}); await as('u-ali'); await go('#/course/C-EXCEL/session/S-EX-1'); $('[data-tutor-btn]').click(); await until(()=>$('.ai-drawer [data-form]')); const f=$('.ai-drawer [data-form]'); f.q.value='hi'; f.requestSubmit(); await until(()=>!/Thinking/.test($('.ai-drawer').innerText)); const t=$('.ai-drawer').innerText; $('.ai-drawer [data-close]').click(); await W(250); await go('#/course/C-EXCEL'); if(!/credentials|Configure|unavailable/i.test(t)) throw new Error('unclear error: '+t.slice(-150)); if(!$('.course-hero')) throw new Error('course page broken');`));

  await tc('QZ-07b', () => run(p, `const qz=db().quizzes.find(q=>q.title==='QA quiz')?.id; if(!qz) throw new Error('QA quiz missing'); updateRecord('quizzes',qz,{status:'published'}); await as('u-ali'); await go('#/course/C-EXCEL/quiz/'+qz); const f=await until(()=>$('[data-quiz]')); f.querySelectorAll('input[type=radio]').forEach(i=>i.checked=true); f.querySelectorAll('textarea').forEach(t=>t.value='My answer'); f.requestSubmit(); await until(()=>location.hash.endsWith('/quizzes'),9000); invalidateCache(); const a=db().quizAttempts.filter(x=>x.quizId===qz).pop(); await as('u-admin'); if(!a) throw new Error('no attempt'); if(!a.pendingShort) throw new Error('short answer scored 0 instead of pending when AI is unavailable');`));
  /* ---------------- mobile / themes / keyboard ---------------- */
  const m = await page({ width: 375, height: 740, isMobile: true, hasTouch: true });
  await m.goto(base + '/login.html', { waitUntil: 'networkidle0' });
  await tc('AUTH-08', async () => check(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'login overflows at 375px'));
  let mWho = null;
  const mboot = async (who, hash) => { if (mWho !== who) { await signIn(m, who); mWho = who; } await m.evaluate(h => { location.hash = h; }, hash); await W(600); };
  const overflow = () => m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await tc('AI-T-11', async () => { await mboot('u-ali', '#/course/C-EXCEL/session/S-EX-1'); await m.click('[data-tutor-btn]'); await W(400); const w = await m.evaluate(() => document.querySelector('.ai-drawer-panel').getBoundingClientRect().width); check(w >= 360, 'drawer width ' + w); check(!(await overflow()), 'overflow'); });
  await tc('QZ-11', async () => { await mboot('u-ali', '#/course/C-EXCEL/quizzes'); await mboot('u-ali', '#/course/C-EXCEL/quiz/' + (await m.evaluate(() => Domain.publishedQuizzes('C-EXCEL')[0].id))); const r = await m.evaluate(() => { const f = document.querySelector('.sticky-foot'); return f ? getComputedStyle(f).position : (document.querySelector('#main').innerText.slice(0, 60)); }); check(r === 'sticky' || /limit/i.test(r), 'submit bar not sticky: ' + r); check(!(await overflow()), 'overflow'); });
  await tc('NFR-01', async () => { await mboot('u-admin', '#/settings?tab=integrations'); await W(500); check(!(await overflow()), 'integrations overflow at 375px'); });
  await tc('LRN-20', async () => { for (const h of ['#/course/C-EXCEL', '#/course/C-EXCEL/session/S-EX-2']) { await mboot('u-ali', h); check(!(await overflow()), 'overflow ' + h); } });
  await tc('NFR-02', () => run(p, `document.documentElement.dataset.theme='dark'; await as('u-ali'); await go('#/course/C-EXCEL/session/S-EX-1'); $('[data-tutor-btn]').click(); await W(400); const panel=$('.ai-drawer-panel'), cs=getComputedStyle(panel); const bg=cs.backgroundColor, fg=getComputedStyle($('.ai-drawer-head h2')).color; $('.ai-drawer [data-close]').click(); await W(250); document.documentElement.dataset.theme='light'; if(bg===fg||/rgba\\(0, 0, 0, 0\\)/.test(bg)) throw new Error('drawer unreadable in dark: '+bg+' / '+fg);`));
  await tc('NFR-04', () => run(p, `await go('#/course/C-EXCEL/quiz/QZ-EX-1'); const t=text(); if(/limit/i.test(t)) return 'Attempt limit already reached for the demo learner; keyboard focus checked on the builder instead.'; const f=$('[data-quiz] input'); f.focus(); if(document.activeElement!==f) throw new Error('not focusable');`));
  await tc('NFR-05', async () => 'LMS stays usable while the tutor waits (calls are async and the drawer does not block navigation); timing with a slow provider not simulated.');

  /* ---------------- reset seeds sample quiz ---------------- */
  await tc('ADM-13', async () => { await boot('u-admin', '#/settings?tab=data'); await p.click('[data-reset]'); await W(200); await Promise.all([p.click('.modal [data-ok]'), p.waitForNavigation({ waitUntil: 'networkidle0' })]); check(await p.evaluate(() => { invalidateCache(); return db().quizzes.some(q => q.id === 'QZ-EX-1') && !db().quizAttempts.length; }), 'seed quiz missing after reset'); });

  console.log(JSON.stringify({ results: out, pageErrors: [...new Set(errors)] }, null, 1));
  await b.close(); srv.close(); mock.close(); supa.close();
  [secretsFile, usageFile].forEach((f, i) => { if (backup[i]) fs.writeFileSync(f, backup[i]); else if (fs.existsSync(f)) fs.unlinkSync(f); });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
