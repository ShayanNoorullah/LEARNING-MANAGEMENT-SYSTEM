
/* EAD configuration engine: applies persisted presentation and system settings consistently. */
function applyPortalConfiguration(){
 const s=(typeof getData==='function'?getData('settings'):null)||{};
 const theme=(s.theme==='dark'||s.theme==='light')?s.theme:'light';
 document.documentElement.dataset.theme=theme;
 document.body.dataset.theme=theme;
 const root=document.documentElement.style;
 if(s.accentColor && /^#[0-9a-fA-F]{6}$/.test(s.accentColor)){
   root.setProperty('--olive',s.accentColor);
   root.setProperty('--teal-primary',s.accentColor);
 }
 const radius=Math.min(28,Math.max(6,Number(s.borderRadius)||16));
 root.setProperty('--radius',radius+'px');
 const scale=Math.min(120,Math.max(85,Number(s.fontScale)||100));
 document.body.style.fontSize=(scale/100)+'em';
 document.body.classList.toggle('compact-density',s.density==='compact');
 document.body.classList.toggle('no-motion',s.animations===false);
 if(s.sidebarWidth) root.setProperty('--sidebar-width',Math.min(340,Math.max(220,Number(s.sidebarWidth)||260))+'px');
}
window.applyPortalConfiguration=applyPortalConfiguration;
window.addEventListener('ead-config-change',applyPortalConfiguration);

function setupGlobal(){document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.closeModal)));document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show')}))}
function setupLayout(user){
 const side=document.querySelector('.sidebar'),overlay=document.querySelector('.mobile-overlay'),app=document.querySelector('.app');
 const page=document.body.dataset.page,role=document.body.dataset.role||user.role;
 // Theme/design are driven by Settings, with legacy eadTheme retained for compatibility.
 const cfg=(typeof getData==='function'?getData('settings'):null)||{};
 const savedTheme=(cfg.theme==='dark'||cfg.theme==='light')?cfg.theme:(localStorage.getItem('eadTheme')||'light');
 if(typeof saveData==='function' && cfg.theme!==savedTheme){ try{saveData('settings',{...cfg,theme:savedTheme});}catch(e){} }
 document.body.dataset.theme=savedTheme; document.documentElement.dataset.theme=savedTheme; applyPortalConfiguration?.();
 const topActions=document.querySelector('.top-actions');
 // Presentation-ready AK identity mark. It is injected consistently on every portal page.
 if(topActions&&!topActions.querySelector('.ak-logo')){
   const ak=document.createElement('button');ak.type='button';ak.className='ak-logo';ak.setAttribute('aria-label','Ayesha Khan profile');ak.title='Ayesha Khan';ak.textContent='AK';
   ak.onclick=()=>{location.href='profile.html'};
   topActions.appendChild(ak);
 }
 if(topActions&&!topActions.querySelector('[data-theme-toggle]')){const t=document.createElement('button');t.className='icon-btn theme-toggle';t.type='button';t.dataset.themeToggle='';t.title='Switch light / dark mode';t.innerHTML=`<span data-theme-icon>${savedTheme==='dark'?'☀':'☾'}</span>`;topActions.prepend(t);t.onclick=()=>{const next=document.body.dataset.theme==='dark'?'light':'dark';document.body.dataset.theme=next;document.documentElement.dataset.theme=next;localStorage.setItem('eadTheme',next);const cur=(typeof getData==='function'?getData('settings'):{});if(typeof saveData==='function')saveData('settings',{...cur,theme:next});t.querySelector('[data-theme-icon]').textContent=next==='dark'?'☀':'☾';applyPortalConfiguration?.();window.dispatchEvent(new Event('ead-config-change'))}}
 // The EAD University brand is the clickable sidebar scaffold control. The separate arrow button was removed.
 const brand=side?.querySelector('.brand');
 if(brand&&!brand.dataset.scaffoldReady){
   brand.dataset.scaffoldReady='1';brand.classList.add('brand-clickable');brand.setAttribute('role','button');brand.setAttribute('tabindex','0');brand.setAttribute('title','Collapse or expand portal navigation');brand.setAttribute('aria-label','Collapse or expand portal navigation');
   const apply=()=>{const col=localStorage.getItem('eadSidebarCollapsed')==='1';side.classList.toggle('collapsed',col);app?.classList.toggle('sidebar-collapsed',col);brand.setAttribute('aria-expanded',String(!col));};
   apply();
   const toggle=()=>{localStorage.setItem('eadSidebarCollapsed',side.classList.contains('collapsed')?'0':'1');apply()};
   brand.addEventListener('click',toggle);brand.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}});
 }
 // Contract long sidebar into clear expandable groups while keeping Dashboard independent.
 const nav=side?.querySelector('.nav');if(nav&&!nav.dataset.grouped){
  const links=[...nav.querySelectorAll(':scope > a[data-page]')];const byPage=Object.fromEntries(links.map(a=>[a.dataset.page,a]));
  const configs=role==='admin'?[['Users','👥',['students','teachers']],['Academics','▦',['departments','programs','subjects','classes']],['Schedule','◫',['timetable','attendance','exams']],['Learning','✎',['assignments','results']],['Finance & Reports','▤',['fees','reports']],['Communication','●',['announcements','messages','notifications']],['Account','⚙',['settings','profile']]]:role==='teacher'?[['Teaching','▦',['subjects','classes','students']],['Schedule','◫',['timetable','attendance','exams']],['Learning','✎',['assignments','results']],['Communication','●',['announcements','messages','notifications']],['Account','⚙',['profile']]]:[['Academics','▦',['courses','teachers']],['Schedule','◫',['timetable','attendance','exams']],['Learning','✎',['assignments','results']],['Finance','▤',['fees']],['Communication','●',['announcements','messages','notifications']],['Account','⚙',['profile']]];
  const normalizeLink=a=>{[...a.childNodes].forEach(n=>{if(n.nodeType===3&&n.textContent.trim()){const sp=document.createElement('span');sp.className='nav-label';sp.textContent=n.textContent.trim();a.replaceChild(sp,n)}})};const dashboard=byPage.dashboard;if(dashboard){normalizeLink(dashboard);nav.innerHTML='';nav.appendChild(dashboard)}else nav.innerHTML='';
  configs.forEach(([label,icon,pages])=>{const existing=pages.map(p=>byPage[p]).filter(Boolean);if(!existing.length)return;const group=document.createElement('div');group.className='nav-group';const btn=document.createElement('button');btn.className='nav-group-toggle';btn.type='button';btn.innerHTML=`<span>${icon}</span><span class="nav-group-label">${label}</span><span class="nav-group-chevron">›</span>`;const items=document.createElement('div');items.className='nav-group-items';existing.forEach(a=>{normalizeLink(a);items.appendChild(a)});group.append(btn,items);nav.appendChild(group);const active=existing.some(a=>a.dataset.page===page);group.classList.toggle('open',active);btn.classList.toggle('active-group',active);btn.onclick=()=>group.classList.toggle('open')});
  nav.dataset.grouped='1';
 }
 document.querySelector('.hamburger')?.addEventListener('click',()=>{side.classList.add('open');overlay?.classList.add('show')});overlay?.addEventListener('click',()=>{side.classList.remove('open');overlay.classList.remove('show')});document.querySelector('.user-btn')?.addEventListener('click',()=>document.querySelector('.dropdown')?.classList.toggle('open'));document.querySelectorAll('[data-logout]').forEach(x=>x.addEventListener('click',logout));document.querySelectorAll('.nav a[data-page]').forEach(a=>{if(a.dataset.page===page)a.classList.add('active')});document.querySelectorAll('[data-search-global]').forEach(i=>i.addEventListener('input',()=>{const q=i.value.toLowerCase();document.querySelectorAll('[data-global-text]').forEach(x=>x.style.display=x.textContent.toLowerCase().includes(q)?'':'none')}));if(window.setupRouteLoading)window.setupRouteLoading();const n=getData('notifications').filter(x=>x.user===user.id&&!x.read).length;document.querySelectorAll('[data-notification-count]').forEach(x=>{x.textContent=n;x.style.display=n?'grid':'none'});const un=document.querySelector('[data-user-name]');if(un)un.textContent=user.name;const ur=document.querySelector('[data-user-role]');if(ur)ur.textContent=user.role;const ua=document.querySelector('[data-user-avatar]');if(ua)ua.textContent=initials(user.name);if(window.mountNotificationDropdown)window.mountNotificationDropdown(user);setupGlobal()}
function setupFloating(role){const f=document.querySelector('[data-floating]');if(!f)return;f.querySelector('[data-fab]')?.addEventListener('click',()=>f.querySelector('[data-float-card]')?.classList.toggle('hidden'));f.querySelector('[data-dismiss]')?.addEventListener('click',()=>f.classList.add('hidden'))}
function populateSelect(id,items,labelFn,valueFn,placeholder='Select...'){const s=document.getElementById(id);if(!s)return;s.innerHTML=`<option value="">${placeholder}</option>`+items.map(x=>`<option value="${esc(valueFn(x))}">${esc(labelFn(x))}</option>`).join('')}
function paginate(items,page,size){return {items:items.slice((page-1)*size,page*size),pages:Math.max(1,Math.ceil(items.length/size))}}
function renderPagination(container,pages,current,onPage){if(!container)return;container.innerHTML='';for(let i=1;i<=pages;i++){const b=document.createElement('button');b.className='page-btn '+(i===current?'active':'');b.textContent=i;b.onclick=()=>onPage(i);container.appendChild(b)}}
function tableActions(id,key,canEdit=true){return `<div class="actions">${canEdit?`<button class="btn btn-light btn-sm" data-edit="${esc(id)}" data-key="${esc(key)}">Edit</button>`:''}<button class="btn btn-danger btn-sm" data-delete="${esc(id)}" data-key="${esc(key)}">Delete</button></div>`}
function bindCrudDelete(container){container.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>confirmAction(`Are you sure you want to delete this record?`,()=>{deleteRecord(b.dataset.key,b.dataset.delete);toast('Record deleted successfully.');location.reload()}))}
function attendanceStats(studentId,subjectId){const rows=getData('attendance').filter(x=>x.student===studentId&&(!subjectId||x.subject===subjectId));const total=rows.length,p=rows.filter(x=>x.status==='Present'||x.status==='Late').length;return {total,present:rows.filter(x=>x.status==='Present').length,absent:rows.filter(x=>x.status==='Absent').length,late:rows.filter(x=>x.status==='Late').length,excused:rows.filter(x=>x.status==='Excused').length,pct:total?Math.round(p/total*100):100}}
function assignmentForStudent(a,studentId){const s=getData('submissions').find(x=>x.assignment===a.id&&x.student===studentId);if(!s)return {...a,submission:null,studentStatus:new Date(`${a.dueDate}T${a.dueTime}`)<new Date()?'Missing':'Pending'};return {...a,submission:s,studentStatus:s.status}}
function gradeFromPct(p){if(p>=90)return ['A+',4];if(p>=85)return ['A',4];if(p>=80)return ['B+',3.5];if(p>=75)return ['B',3];if(p>=70)return ['C+',2.5];if(p>=65)return ['C',2];if(p>=50)return ['D',1];return ['F',0]}
function calculateResult(q,a,m,f){const total=Number(q||0)+Number(a||0)+Number(m||0)+Number(f||0);const pct=total;const [grade,gpa]=gradeFromPct(pct);return {total,percentage:pct,grade,gpa}}
function setupLiveRefresh(fn){window.addEventListener('ead-db-change',()=>fn());}
function linkedAccountKey(key){return key==='students'?'studentId':key==='teachers'?'teacherId':null}
function unlinkAccount(key,recordId){const k=linkedAccountKey(key);if(!k)return;getData('users').filter(u=>u[k]===recordId).forEach(u=>deleteRecord('users',u.id))}
function syncLinkedAccount(key,recordId,rec){const k=linkedAccountKey(key);if(!k)return;const u=getData('users').find(x=>x[k]===recordId);if(!u)return;const patch={name:rec.name,email:rec.email,status:rec.status||u.status,department:rec.department};if(rec.password)patch.password=rec.password;if(key==='students')Object.assign(patch,{program:rec.program,semester:Number(rec.semester||u.semester||1),section:rec.section||''});Object.keys(patch).forEach(p=>patch[p]===undefined&&delete patch[p]);updateRecord('users',u.id,patch)}
