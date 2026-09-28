/* EAD University Portal Enhancements — Vanilla JavaScript */
(function(){
  function escEnh(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  window.showPortalLoading=function(message='Loading...'){
    let el=document.getElementById('portalLoading');
    if(!el){el=document.createElement('div');el.id='portalLoading';el.className='loading-overlay';el.innerHTML='<div class="loading-card"><div class="loading-spinner"></div><p data-loading-message>Loading...</p></div>';document.body.appendChild(el);}
    el.querySelector('[data-loading-message]').textContent=message;el.classList.add('show');
  };
  window.hidePortalLoading=function(){document.getElementById('portalLoading')?.classList.remove('show');};
  window.setupRouteLoading=function(){
    if(document.body.dataset.routeLoadingBound)return;document.body.dataset.routeLoadingBound='1';
    document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||a.target==='_blank'||a.href.startsWith('javascript:')||e.ctrlKey||e.metaKey)return;const href=a.getAttribute('href')||'';if(href.startsWith('#'))return;window.showPortalLoading('Loading page...');});
    window.addEventListener('pageshow',window.hidePortalLoading);
  };
  window.mountNotificationDropdown=function(user){
    const bell=document.querySelector('[data-notification-bell]');if(!bell||bell.dataset.ready)return;bell.dataset.ready='1';
    const wrap=document.createElement('div');wrap.className='notification-wrapper';bell.parentNode.insertBefore(wrap,bell);wrap.appendChild(bell);
    const drop=document.createElement('div');drop.className='notification-dropdown';drop.innerHTML='<div class="dropdown-header"><strong>Notifications</strong><button type="button" data-mark-all>Mark all read</button></div><div class="notification-list" data-notification-list></div><div class="dropdown-footer"><button type="button" data-view-all>View all notifications</button></div>';wrap.appendChild(drop);
    function rows(){return (typeof getData==='function'?getData('notifications'):[]).filter(n=>n.user===user.id).sort((a,b)=>String(b.id).localeCompare(String(a.id)));}
    function render(){const list=drop.querySelector('[data-notification-list]');const rs=rows().slice(0,6);list.innerHTML=rs.length?rs.map(n=>'<div class="notification-item '+(n.read?'read':'')+'" data-notification-id="'+escEnh(n.id)+'"><span class="notification-dot"></span><div><b>'+escEnh(n.title||'Notification')+'</b><span>'+escEnh(n.message||'')+'</span><small>'+escEnh(n.type||'General')+'</small></div></div>').join(''):'<div class="empty">No notifications yet.</div>';}
    bell.onclick=e=>{e.preventDefault();drop.classList.toggle('open');if(drop.classList.contains('open'))render();};
    drop.querySelector('[data-mark-all]').onclick=()=>{rows().forEach(n=>{if(!n.read&&typeof updateRecord==='function')updateRecord('notifications',n.id,{read:true});});render();document.querySelectorAll('[data-notification-count]').forEach(x=>{x.textContent='';x.style.display='none';});};
    drop.querySelector('[data-view-all]').onclick=()=>{location.href='notifications.html';};
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))drop.classList.remove('open');});
  };
  window.mountDashboardScaffolding=function(role,user){
    const root=document.getElementById('pageRoot');if(!root||root.querySelector('.dashboard-scaffolding'))return;
    const data=typeof db==='function'?db():{};
    const title=role==='admin'?'University Activity':role==='teacher'?'Teaching Activity':'My Schedule Activity';
    const active=role==='admin'?(data.assignments||[]).filter(x=>x.status!=='Unpublished').slice(-4):(data.assignments||[]).slice(-4);
    const pending=role==='admin'?(data.exams||[]).filter(x=>x.status==='Scheduled').slice(0,4):(data.notifications||[]).filter(x=>x.user===user.id&&!x.read).slice(0,4);
    const done=role==='admin'?(data.results||[]).filter(x=>x.status==='Published').slice(-4):(data.notifications||[]).filter(x=>x.user===user.id&&x.read).slice(-4);
    const groups=[['Active Schedules',active,'Active'],['Pending Actions',pending,'Pending'],['Completed Activity',done,'Completed']];
    const box=document.createElement('section');box.className='card dashboard-scaffolding';box.innerHTML='<div class="section-title"><h3>'+title+'</h3><span class="muted">Click a section to expand</span></div><div class="scaffold-grid">'+groups.map((g,i)=>'<div class="scaffold-section"><button class="scaffold-header" type="button"><span>'+g[0]+'</span><span class="scaffold-chevron">›</span></button><div class="section-content">'+(g[1].length?g[1].map((x,j)=>'<div class="log-entry" tabindex="0"><span><b>'+escEnh(x.title||x.name||x.id||('Entry '+(j+1)))+'</b><br><small>'+escEnh(x.description||x.message||x.status||g[2])+'</small></span><small>'+escEnh(x.date||x.dueDate||g[2])+'</small></div>').join(''):'<div class="empty">No records in this section.</div>')+'</div></div>').join('')+'</div>';
    root.appendChild(box);box.querySelectorAll('.scaffold-header').forEach(btn=>btn.onclick=()=>btn.parentElement.classList.toggle('open'));
  };
})();

/* Premium loading lifecycle + generic Table/Board view controls. */
(function(){
  function escEnh(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function plainText(html){const d=document.createElement('div');d.innerHTML=html;return d.textContent.trim();}

  // Apply the saved theme before the first loading screen is painted. This keeps the
  // loading experience visually consistent with the user's light/dark preference.
  const savedTheme=localStorage.getItem('eadTheme')||'light';
  document.documentElement.dataset.theme=savedTheme;
  if(document.body)document.body.dataset.theme=savedTheme;

  let loadingStarted=0;
  const originalShow=window.showPortalLoading;
  window.showPortalLoading=function(message='Loading...'){
    loadingStarted=Date.now();
    if(originalShow)originalShow(message);
    const el=document.getElementById('portalLoading');
    if(el){el.setAttribute('aria-busy','true');document.body.classList.add('portal-is-loading');}
  };
  const originalHide=window.hidePortalLoading;
  window.hidePortalLoading=function(){
    const finish=()=>{originalHide?.();document.body.classList.remove('portal-is-loading');document.getElementById('portalLoading')?.setAttribute('aria-busy','false');};
    const elapsed=Date.now()-loadingStarted;
    if(loadingStarted&&elapsed<380)setTimeout(finish,380-elapsed);else finish();
  };

  function ensureDetailsModal(){
    let modal=document.getElementById('boardDetailsModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.className='modal board-details-modal';
    modal.id='boardDetailsModal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-box"><div class="modal-head"><h3 data-board-detail-title>Details</h3><button type="button" class="close" data-board-detail-close aria-label="Close details">×</button></div><div class="modal-body"><div class="board-detail-list" data-board-detail-list></div><div class="form-actions board-detail-actions" data-board-detail-actions></div></div></div>';
    document.body.appendChild(modal);
    const close=()=>{modal.classList.remove('show');modal.setAttribute('aria-hidden','true');};
    modal.querySelector('[data-board-detail-close]').onclick=close;
    modal.addEventListener('click',e=>{if(e.target===modal)close();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('show'))close();});
    return modal;
  }

  function openBoardDetails(table,row,headers,summaryIndexes=[]){
    const modal=ensureDetailsModal();
    const cells=[...row.querySelectorAll('td')];
    const primaryIndex=headers.findIndex(h=>/^(name|full name|student|teacher|department|program|subject|course|class|assignment|exam|title|fee type)$/i.test(h));
    const primary=primaryIndex>=0?plainText(cells[primaryIndex]?.innerHTML||'Record'):plainText(cells[0]?.innerHTML||'Record');
    const list=modal.querySelector('[data-board-detail-list]');
    const actions=modal.querySelector('[data-board-detail-actions]');

    // For admin data pages, show the complete underlying record rather than only
    // the columns currently visible in the table. This makes the Board card a
    // true "View details" action (e.g. a student card opens contact, academic,
    // admission and account details).
    const pageKey=String(document.body?.dataset?.page||'').trim();
    const sourceRows=[...table.querySelectorAll('tbody tr')];
    const firstCellText=plainText(cells[0]?.innerHTML||'');
    const sourceRecord=typeof getData==='function'&&pageKey?(getData(pageKey)||[]).find(r=>String(r.id??'')===firstCellText):null;
    const schema=typeof SCHEMAS!=='undefined'?SCHEMAS[pageKey]:null;

    if(sourceRecord&&schema?.fields?.length){
      const humanValue=(field,value)=>{
        if(value===undefined||value===null||value==='')return '—';
        if(field==='password')return '••••••••';
        if(field==='status'&&typeof statusBadge==='function')return statusBadge(String(value));
        if(field==='department'&&typeof departmentName==='function')return escEnh(departmentName(value));
        if(field==='program'&&typeof programName==='function')return escEnh(programName(value));
        if(field==='teacher'&&typeof teacherName==='function')return escEnh(teacherName(value));
        if(field==='subject'&&typeof subjectName==='function')return escEnh(subjectName(value));
        if(field==='class'&&typeof className==='function')return escEnh(className(value));
        if(Array.isArray(value))return escEnh(value.join(', '));
        return escEnh(String(value));
      };
      list.innerHTML=schema.fields.filter(f=>f[0]!=='password').map(f=>{
        const name=f[0],label=f[1];
        return '<div class="board-detail-row"><dt>'+escEnh(label)+'</dt><dd>'+humanValue(name,sourceRecord[name])+'</dd></div>';
      }).join('');
    }else{
      list.innerHTML=headers.map((label,i)=>{
        if(/action/i.test(label))return '';
        const cell=cells[i];if(!cell)return '';
        return '<div class="board-detail-row"><dt>'+escEnh(label)+'</dt><dd>'+cell.innerHTML+'</dd></div>';
      }).join('')||'<div class="empty">No details available.</div>';
    }

    const actionIndex=headers.findIndex(h=>/action/i.test(h));
    actions.innerHTML=actionIndex>=0&&cells[actionIndex]?'<div class="actions">'+cells[actionIndex].innerHTML+'</div>':'';
    modal.querySelector('[data-board-detail-title]').textContent=primary||'Record details';

    // Forward copied action buttons to the original table row so existing CRUD handlers
    // remain authoritative and no functionality is duplicated inside the dialog.
    actions.querySelectorAll('[data-edit],[data-del],[data-delete]').forEach(b=>{
      b.onclick=e=>{
        e.preventDefault();
        const attr=b.hasAttribute('data-edit')?'data-edit':b.hasAttribute('data-del')?'data-del':'data-delete';
        const value=b.getAttribute(attr);
        const original=[...row.querySelectorAll('['+attr+']')].find(x=>x.getAttribute(attr)===value);
        original?.click();
        if(!document.body.contains(row))modal.classList.remove('show');
      };
    });
    modal.classList.add('show');modal.setAttribute('aria-hidden','false');
  }

  window.initTableBoardToggles=function(root=document){
    root.querySelectorAll('.table-wrap table.table').forEach(table=>{
      if(table.dataset.boardReady||table.closest('#ttView'))return;
      table.dataset.boardReady='1';
      const wrap=table.closest('.table-wrap');
      const parent=wrap.parentNode;
      const shell=document.createElement('div');shell.className='table-board-shell';
      const controls=document.createElement('div');controls.className='data-view-switch';
      const settings=(typeof getData==='function'?getData('settings'):{})||{};
      const searchEnabled=settings.searchEnabled!==false, filtersEnabled=settings.filtersEnabled!==false;
      const defaultView=localStorage.getItem('eadDataView')||(settings.defaultView||'table');
      controls.innerHTML='<select class="data-view-select" aria-label="Select data view"><option value="table">Table</option><option value="board">Board</option></select>';
      const select=controls.querySelector('select');select.value=defaultView==='board'?'board':'table';
      parent.insertBefore(shell,wrap);shell.append(controls,wrap);
      const existingPagination=parent.querySelector(':scope > .pagination');
      const existingFilters=parent.querySelector(':scope > .filters');
      let managed=false;
      if(!existingPagination){
        managed=true;
        const toolbar=document.createElement('div');toolbar.className='data-table-toolbar';
        const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
        toolbar.innerHTML=(searchEnabled?'<div class="data-table-search"><input class="form-control" data-table-search placeholder="Search '+escEnh(headers.slice(0,2).join(', ').toLowerCase()||'records')+'…"></div>':'')+(filtersEnabled?'<div class="data-table-filter"><select class="form-control" data-table-status><option value="">All statuses</option><option>Active</option><option>Inactive</option><option>Pending</option><option>Paid</option><option>Published</option><option>Submitted</option><option>Graded</option><option>Late</option><option>Absent</option><option>Present</option></select></div>':'');
        if(existingFilters){
          const customInput=existingFilters.querySelector('input');
          if(customInput)toolbar.querySelector('[data-table-search]').value=customInput.value;
          existingFilters.remove();
        }
        parent.insertBefore(toolbar,shell);
        const pager=document.createElement('div');pager.className='pagination';pager.dataset.tablePagination='1';parent.appendChild(pager);
        shell.__dataToolbar=toolbar;shell.__dataPager=pager;
        let page=1;
        const size=Math.max(3,Number(settings.pageSize)||8);
        const drawManaged=()=>{
          const q=(toolbar.querySelector('[data-table-search]')?.value||'').trim().toLowerCase();
          const status=(toolbar.querySelector('[data-table-status]')?.value||'').toLowerCase();
          const allRows=[...table.querySelectorAll('tbody tr')];
          const matches=allRows.filter(tr=>{const text=tr.textContent.toLowerCase();return(!q||text.includes(q))&&(!status||text.includes(status));});
          const pages=Math.max(1,Math.ceil(matches.length/size));if(page>pages)page=pages;
          allRows.forEach(tr=>{tr.style.display='none';tr.dataset.boardVisible='false'});
          matches.slice((page-1)*size,page*size).forEach(tr=>{tr.style.display='';tr.dataset.boardVisible='true'});
          pager.innerHTML='';
          for(let i=1;i<=pages;i++){const b=document.createElement('button');b.type='button';b.className='page-btn '+(i===page?'active':'');b.textContent=i;b.onclick=()=>{page=i;drawManaged()};pager.appendChild(b)}
          shell.__renderBoard?.();
        };
        toolbar.querySelector('[data-table-search]')?.addEventListener('input',()=>{page=1;drawManaged()});
        toolbar.querySelector('[data-table-status]')?.addEventListener('change',()=>{page=1;drawManaged()});
        shell.__drawManaged=drawManaged;
        drawManaged();
      }
      const board=document.createElement('div');board.className='board-view hidden';shell.appendChild(board);
      const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      const summaryIndex=()=>{
        const name=/^(name|full name|student|teacher|department|program|subject|course|class|assignment|exam|title|fee type)$/i;
        return headers.findIndex(h=>name.test(h));
      };
      const secondaryIndex=()=>{
        const candidates=[/program/i,/course/i,/subject/i,/department/i,/status/i];
        for(const re of candidates){const i=headers.findIndex(h=>re.test(h));if(i>=0&&i!==summaryIndex())return i;}
        return -1;
      };
      const renderBoard=()=>{
        const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelectorAll('td').length&&(!managed||tr.dataset.boardVisible!=='false'));
        const ni=summaryIndex(),si=secondaryIndex();
        board.innerHTML=rows.length?rows.map((tr,idx)=>{
          const cells=[...tr.querySelectorAll('td')];
          const title=plainText(cells[ni>=0?ni:0]?.innerHTML||'Record');
          const second=si>=0?plainText(cells[si]?.innerHTML||'—'):'—';
          return '<article class="board-card board-card-compact" data-board-row="'+idx+'" tabindex="0" role="button" aria-label="View details for '+escEnh(title)+'"><h4>'+escEnh(title||'Record')+'</h4><p><span>'+escEnh(headers[si]||'Program')+'</span><b>'+escEnh(second||'—')+'</b></p><div class="board-card-action"><button type="button" class="btn btn-light btn-sm" data-board-details="'+idx+'">View details</button></div></article>';
        }).join(''):'<div class="empty">No records available.</div>';

        // Keep a direct reference to the source table row on every card. This avoids
        // fragile index lookups when pagination/search causes the table to redraw.
        board.querySelectorAll('[data-board-row]').forEach((card,idx)=>{
          const row=rows[idx];
          card.__boardSource={table,row,headers};
          card.onclick=e=>{
            if(e.target.closest('[data-board-details]'))return;
            const src=card.__boardSource;
            if(src?.row)openBoardDetails(src.table,src.row,src.headers);
          };
          card.querySelector('[data-board-details]')?.addEventListener('click',e=>{
            e.preventDefault();
            e.stopPropagation();
            const src=card.__boardSource;
            if(src?.row)openBoardDetails(src.table,src.row,src.headers);
          });
          card.onkeydown=e=>{
            if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){
              e.preventDefault();
              const src=card.__boardSource;
              if(src?.row)openBoardDetails(src.table,src.row,src.headers);
            }
          };
        });
      };
      shell.__renderBoard=renderBoard;
      const applyView=mode=>{const boardMode=mode==='board';shell.dataset.boardActive=String(boardMode);board.classList.toggle('hidden',!boardMode);wrap.style.display=boardMode?'none':'';if(boardMode)renderBoard();};
      applyView(select.value);
      select.addEventListener('change',()=>{localStorage.setItem('eadDataView',select.value);applyView(select.value);});
    });
  };

  const enhance=()=>window.initTableBoardToggles?.();
  document.addEventListener('DOMContentLoaded',()=>{window.showPortalLoading('Preparing your EAD workspace...');enhance();setTimeout(window.hidePortalLoading,520);});
  window.addEventListener('load',()=>{enhance();setTimeout(window.hidePortalLoading,0);});
  document.addEventListener('input',()=>{document.querySelectorAll('.table-board-shell[data-board-active="true"]').forEach(s=>s.__renderBoard?.())});
  document.addEventListener('change',()=>{document.querySelectorAll('.table-board-shell[data-board-active="true"]').forEach(s=>s.__renderBoard?.())});
  // Watch for newly-rendered tables/pages, but do NOT react to the board cards
  // themselves. Re-rendering the board inside this observer used to create a
  // MutationObserver loop: cards were replaced every 50ms, which made them
  // visibly shake/flicker and could interrupt clicks on View details.
  const observer=new MutationObserver(mutations=>{
    let needsEnhance=false;
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(node.nodeType!==1)continue;
        if(node.matches?.('.table-wrap table.table, .table-wrap, #pageRoot > .card') ||
           node.querySelector?.('.table-wrap table.table')){
          needsEnhance=true;
          break;
        }
      }
      if(needsEnhance)break;
    }
    if(!needsEnhance)return;
    clearTimeout(window.__eadBoardTimer);
    window.__eadBoardTimer=setTimeout(()=>enhance(),50);
  });
  document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{childList:true,subtree:true}));
})();
