/* SDC Learn — what the person sees about saving: a status chip in the top bar and a banner when changes
   are NOT safely saved (sign-in expired, no connection, browser storage full, or a conflict left after
   signing in again). The state comes from SDCCloud.status() (js/cloud-sync.js); this file only draws it. */
(function () {
  const cloud = () => window.SDCCloud;
  const q = s => document.querySelector(s);
  let warned80 = false, dismissed = '', usageAt = 0, usageVal = null;
  // The storage meter reads every stored value: at most every 5 seconds.
  const usage = () => { if (!usageVal || Date.now() - usageAt > 5000) { usageVal = cloud().usage(); usageAt = Date.now(); } return usageVal; };

  function download() {
    const data = cloud()?.unsavedExport?.() || { app: 'sdc-learn', kind: 'backup', exportedAt: new Date().toISOString(), state: typeof db === 'function' ? db() : null, note: 'Full copy of this browser\'s data.' };
    // When the changes themselves cannot be listed (no sync base yet), a full copy is the safe fallback.
    const body = JSON.stringify(data.kind === 'unsaved-changes' && !Object.keys(data.changes || {}).length && !data.setAside ? { app: 'sdc-learn', kind: 'backup', exportedAt: data.exportedAt, state: typeof db === 'function' ? db() : null } : data, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = `sdc-learn-unsaved-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function fullBackup() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(db(), null, 2)], { type: 'application/json' }));
    a.download = `sdc-learn-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function reauth() {
    const cap = cloud().prepareReauth();
    if (!cap.ok) { download(); toast('Your unsaved changes could not be kept in this browser, so a copy was downloaded. Sign in to continue.', 'warning'); }
    location.href = 'login.html?expired=1';
  }

  function conflictsModal() {
    const list = cloud().conflicts();
    if (!list.length) return toast('No conflicts left.');
    const kindText = c => c.kind === 'deleted' ? 'You changed this, but someone deleted it meanwhile.' : c.op === 'delete' ? 'You deleted this, but someone changed it meanwhile.' : c.op === 'create' ? 'A different item with the same ID already exists.' : 'You and someone else both changed this.';
    const row = (c, i) => `<li class="sync-conf"><div><b>${esc(c.collection)}</b> · ${esc(SyncRecover.labelOf(c.mine || c.theirs, c.id))}<br><span class="small muted">${esc(kindText(c))} The server's version is kept until you choose.</span></div>
      <div class="sync-conf-btns"><button class="btn btn-secondary btn-sm" data-keep="${i}">Keep the server's</button><button class="btn btn-primary btn-sm" data-mine="${i}">${c.op === 'delete' ? 'Delete it anyway' : 'Use mine'}</button></div></li>`;
    const m = openModal({ title: 'Changes that need your decision', size: 'md', body: `<p class="small">These changes were made on this device while you were signed out. They were not applied automatically because the same item changed on the server.</p><ul class="sync-conf-list">${list.map(row).join('')}</ul>`, footer: '<button class="btn btn-ghost" data-modal-close>Close</button>' });
    const again = () => { m.close(); if (cloud().conflicts().length) conflictsModal(); };
    m.querySelectorAll('[data-keep]').forEach(b => b.onclick = () => { cloud().resolveConflict(Number(b.dataset.keep), 'theirs'); toast("Kept the server's version."); again(); });
    m.querySelectorAll('[data-mine]').forEach(b => b.onclick = () => { cloud().resolveConflict(Number(b.dataset.mine), 'mine'); toast('Your version was applied and will be saved.'); again(); });
  }

  function paint() {
    const c = cloud(); if (!c) return;
    const s = c.status(), u = usage();
    const chip = q('[data-sync]');
    if (chip) {
      const map = { saved: ['Saved', 'success'], saving: ['Saving…', 'info'], connecting: ['Connecting…', 'neutral'], local: ['Not saved yet', 'warning'], failed: ['Not saved', 'danger'], auth: ['Sign in again', 'danger'], storage: ['Storage full', 'danger'], off: ['This device only', 'neutral'] };
      const [label, tone] = map[s.state] || map.saved;
      chip.className = `sync-chip sync-${tone}`; chip.textContent = label; chip.title = s.text + (s.lastSavedAt ? ` Last confirmed ${new Date(s.lastSavedAt).toLocaleTimeString()}.` : '');
      chip.hidden = s.state === 'saved' && !s.lastSavedAt; // nothing to say until something was saved
    }
    // The banner: the situations in which work could be lost.
    let kind = '', msg = '', btns = '';
    if (s.state === 'auth') {
      kind = 'danger'; msg = `<b>Your sign-in expired.</b> ${s.pending ? 'Your latest changes are kept on this device but are <b>not saved to the server</b>.' : 'Nothing else is waiting to be saved.'} Sign in again as the same account to save them.`;
      btns = `<button class="btn btn-primary btn-sm" data-act="reauth">Sign in again</button>${s.pending ? '<button class="btn btn-secondary btn-sm" data-act="download">Download unsaved changes</button>' : ''}`;
    } else if (s.state === 'storage') {
      kind = 'danger'; msg = '<b>This browser has no room left to store your data.</b> Recent changes may not be kept here. Save them to the server now, or download a backup. Do not close this tab until you have.';
      btns = '<button class="btn btn-primary btn-sm" data-act="retry">Save to the server</button><button class="btn btn-secondary btn-sm" data-act="backup">Download a backup</button>';
    } else if (s.state === 'failed' && s.failures >= 2) {
      kind = 'warning'; msg = '<b>Your changes are not reaching the server.</b> They are kept on this device and will be sent when the connection works. Trying again automatically.';
      btns = '<button class="btn btn-secondary btn-sm" data-act="retry">Try now</button>';
    } else if (s.conflicts) {
      kind = 'warning'; msg = `<b>${s.conflicts} of your offline change${s.conflicts === 1 ? '' : 's'} need${s.conflicts === 1 ? 's' : ''} a decision.</b> The same item was changed on the server meanwhile, so yours was not applied.`;
      btns = '<button class="btn btn-primary btn-sm" data-act="conflicts">Review</button>';
    } else if (u.pct >= 80 && !warned80) {
      kind = 'warning'; msg = `<b>Browser storage is ${u.pct}% full.</b> Large AI courses may not fit. Download a backup and remove large uploaded files, or finish and clear old drafts.`;
      btns = '<button class="btn btn-secondary btn-sm" data-act="backup">Download a backup</button><button class="btn btn-ghost btn-sm" data-act="dismiss80">Dismiss</button>';
    }
    let bar = q('#syncBanner');
    const sig = kind + msg;
    if (!kind || dismissed === sig) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'syncBanner'; bar.setAttribute('role', 'alert'); document.body.prepend(bar); }
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig; bar.className = `sync-banner sync-banner-${kind}`;
    bar.innerHTML = `<span class="sync-msg">${msg}</span><span class="sync-btns">${btns}</span>`;
    bar.querySelectorAll('[data-act]').forEach(b => b.onclick = () => ({
      reauth, download, backup: fullBackup, conflicts: conflictsModal,
      retry: () => { b.disabled = true; cloud().retryNow().then(() => { toast(cloud().status().state === 'saved' ? 'Saved to the server.' : 'Still not saved. Your changes are kept on this device.', cloud().status().state === 'saved' ? 'success' : 'warning'); paint(); }); },
      dismiss80: () => { warned80 = true; dismissed = sig; paint(); }
    })[b.dataset.act]?.());
  }

  // After signing in again: say what happened to the changes made while signed out.
  function recovered() {
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem('sdcRecovered') || 'null'); sessionStorage.removeItem('sdcRecovered'); } catch (e) {}
    if (!r || !(r.applied || r.conflicts || r.already)) return;
    const parts = [];
    if (r.applied) parts.push(`${r.applied} unsaved change${r.applied === 1 ? ' was' : 's were'} restored and will be saved now`);
    if (r.already && !r.applied) parts.push('your earlier changes were already on the server');
    if (r.conflicts) parts.push(`${r.conflicts} could not be applied because the same item changed on the server (see the banner)`);
    toast(parts.join('; ') + '.', r.conflicts ? 'warning' : 'success');
  }

  window.SDCSyncUI = { paint, download, fullBackup, conflictsModal };
  window.addEventListener('sdc-sync-status', paint);
  window.addEventListener('sdc-sync-rejected', () => { const n = (window.SDC_SYNC_REJECTED || []).length; toast(`The server did not accept ${n} change${n === 1 ? '' : 's'} (this account may not make ${n === 1 ? 'it' : 'them'}) and kept its own version.`, 'warning'); });
  window.addEventListener('sdc-db-change', () => { if (cloud()?.status().state !== 'saved') paint(); });
  // Closing the tab while the browser could not store the latest change would lose it: ask first.
  window.addEventListener('beforeunload', e => { if (cloud()?.status().state === 'storage') { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => { paint(); recovered(); }, 400));
  setInterval(paint, 15000); // the storage meter moves without any event
})();
