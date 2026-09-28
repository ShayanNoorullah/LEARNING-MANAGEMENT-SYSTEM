const DBKEY='eadUniversityDB_v5';
const REQUIRED_COLLECTIONS=['users','students','teachers','departments','programs','subjects','classes','timetable','attendance','assignments','submissions','exams','results','fees','announcements','messages','notifications'];
const DEFAULT_SETTINGS={
  materialMaxFileSizeMB:10, materialAllowedTypes:'pdf,doc,docx,ppt,pptx,xls,xlsx,txt', materialUploadsEnabled:true,university:'EAD UNIVERSITY',universityName:'EAD UNIVERSITY',academicYear:'2026',semester:'Fall 2026',attendanceWarning:75,lateSubmission:true,pageSize:8,searchEnabled:true,filtersEnabled:true,defaultView:'board',passkeyEnabled:true,
  theme:'light', accentColor:'#0d9488', density:'comfortable', borderRadius:16, fontScale:100,
  sidebarWidth:260, animations:true, compactTables:false,
  allowUserManagement:true, allowUserCreation:true, allowRoleEditing:true, requireActiveUser:true,
  notificationsEnabled:true, messagesEnabled:true, auditLogging:true, autoSaveSettings:true
};
function clone(x){return JSON.parse(JSON.stringify(x))}
function normalizeState(input){
  const base=clone(typeof SEED!=='undefined'?SEED:{}), source=(input&&typeof input==='object')?input:{};
  REQUIRED_COLLECTIONS.forEach(k=>{if(!Array.isArray(source[k]))source[k]=clone(base[k]||[])});
  source.settings={...DEFAULT_SETTINGS,...(base.settings||{}),...(source.settings||{})};
  return source;
}
function initDB(){
  let raw=null;try{raw=localStorage.getItem(DBKEY)}catch(e){}
  if(!raw){localStorage.setItem(DBKEY,JSON.stringify(normalizeState(null)));return}
  try{const fixed=normalizeState(JSON.parse(raw));localStorage.setItem(DBKEY,JSON.stringify(fixed));}
  catch(e){localStorage.setItem(DBKEY,JSON.stringify(normalizeState(null)))}
}
function db(){initDB();return normalizeState(JSON.parse(localStorage.getItem(DBKEY)||'{}'))}
function saveDB(data){localStorage.setItem(DBKEY,JSON.stringify(normalizeState(data)));window.dispatchEvent(new Event('ead-db-change'));if(window.EADSupabaseBridge?.syncNow)window.EADSupabaseBridge.syncNow()}
function getData(key){const d=db();return key?d[key]:d}
function saveData(key,value){const d=db();d[key]=value;saveDB(d)}
function generateId(prefix='ID'){return prefix+'-'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase()}
function addRecord(key,record){const d=db();d[key]=Array.isArray(d[key])?d[key]:[];record={...record,id:record.id||generateId(key.slice(0,3).toUpperCase())};d[key].push(record);saveDB(d);return record}
function updateRecord(key,id,patch){const d=db(),i=d[key].findIndex(x=>x.id===id);if(i<0)throw Error('Record not found');d[key][i]={...d[key][i],...patch};saveDB(d);return d[key][i]}
function deleteRecord(key,id){const d=db();d[key]=d[key].filter(x=>x.id!==id);saveDB(d)}
function findRecord(key,id){return getData(key).find(x=>x.id===id)}
function filterRecords(key,predicate){return getData(key).filter(predicate)}
function resetDemoData(){localStorage.removeItem(DBKEY);initDB();location.reload()}
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function initials(name=''){return name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase()}
function fmtDate(s){if(!s)return '—';const d=new Date(s);return isNaN(d)?s:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
function fmtDateTime(s){if(!s)return '—';const d=new Date(s);return isNaN(d)?s:d.toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function subjectName(id){return findRecord('subjects',id)?.name||id}
function teacherName(id){return findRecord('teachers',id)?.name||id}
function studentName(id){return findRecord('students',id)?.name||id}
function className(id){return findRecord('classes',id)?.name||id}
function programName(id){return findRecord('programs',id)?.name||id}
function statusBadge(s){const c=String(s||'').toLowerCase().replace(/\s+/g,'-');return `<span class="badge-status status-${c}">${esc(s||'Unknown')}</span>`}
function toast(message,type='success'){let stack=document.querySelector('.toast-stack');if(!stack){stack=document.createElement('div');stack.className='toast-stack';document.body.appendChild(stack)}const el=document.createElement('div');el.className='toast '+(type==='error'?'error':type==='warning'?'warning':'');el.textContent=message;stack.appendChild(el);setTimeout(()=>el.remove(),3500)}
function confirmAction(message,callback){const m=document.getElementById('confirmModal');if(!m){if(confirm(message))callback();return}document.getElementById('confirmMessage').textContent=message;m.classList.add('show');const yes=document.getElementById('confirmYes');yes.onclick=()=>{m.classList.remove('show');callback()}}
function openModal(id){document.getElementById(id)?.classList.add('show')}
function closeModal(id){document.getElementById(id)?.classList.remove('show')}
function csvDownload(filename,rows){const text=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const blob=new Blob([text],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function printSection(title,html){const w=window.open('','_blank','width=1100,height=800');if(!w){toast('Please allow pop-ups to export the document.','error');return}const generated=new Date().toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});w.document.write(`<html><head><meta charset="UTF-8"><title>${esc(title)} — EAD University</title><style>@page{size:A4;margin:15mm 14mm 18mm}*{box-sizing:border-box}html{font-size:10.5pt}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#172033;background:#fff;line-height:1.45}.print-head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0d9488;padding:0 0 12px;margin-bottom:16px}.print-brand{display:flex;align-items:center;gap:10px}.mark{width:40px;height:40px;border:2px solid #0d9488;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#0d6f68;font-family:Georgia,serif}.print-head h1{font:700 19px Georgia,serif;letter-spacing:.5px;margin:0 0 2px;color:#12302e}.print-head p{margin:0;color:#64748B;font-size:8.5pt}.meta{text-align:right;color:#64748B;font-size:8.5pt;line-height:1.5}.meta strong{display:block;color:#12302e;font-size:9pt}.report-title{font:700 15px Georgia,serif;margin:0 0 13px;color:#12302e;border-left:4px solid #0d9488;padding:6px 0 6px 10px;background:#f2f7f6}table{border-collapse:collapse;width:100%;font-size:9.1pt}thead{display:table-header-group}th{background:#0d6f68!important;color:#fff!important;text-transform:uppercase;letter-spacing:.35px;font-size:8.3pt}th,td{border:1px solid #CBD5E1;padding:6.5px 7px;text-align:left;vertical-align:top}tbody tr:nth-child(even) td{background:#F8FAFC}tr{page-break-inside:avoid}.actions,button,.btn,.pagination,.filters,.top-actions,.sidebar,.hamburger{display:none!important}.badge-status{border:1px solid #AAB6C0;padding:2px 5px;border-radius:8px}.card{border:0!important;box-shadow:none!important;padding:0!important;background:#fff!important}.table-wrap{overflow:visible!important;border:0!important}.print-foot{margin-top:18px;padding-top:8px;border-top:1px solid #CBD5E1;display:flex;justify-content:space-between;color:#64748B;font-size:8px}@media print{a{color:inherit;text-decoration:none}h1,h2,h3{break-after:avoid}}</style></head><body><div class="print-head"><div class="print-brand"><div class="mark">E</div><div><h1>EAD UNIVERSITY</h1><p>Academic Management Portal · Official University Document</p></div></div><div class="meta"><strong>DOCUMENT COPY</strong>Generated: ${generated}</div></div><h2 class="report-title">${esc(title)}</h2>${html}<div class="print-foot"><span>System-generated academic document</span><span>EAD University</span></div></body></html>`);w.document.close();w.focus();setTimeout(()=>w.print(),300)}
function makeNotification(user,title,message,type='System'){if(!user)return;addRecord('notifications',{user,title,message,type,date:new Date().toISOString(),read:false})}
function currentUser(){const id=sessionStorage.getItem('eadSession')||localStorage.getItem('eadRemember');return id?findRecord('users',id):null}
function roleHome(role){return location.pathname.includes('/admin/')||location.pathname.includes('/teacher/')||location.pathname.includes('/student/')?`../${role}/dashboard.html`:`${role}/dashboard.html`}
function todayISO(){return new Date().toISOString().slice(0,10)}
