/* Optional cloud reconciliation. The portal must remain usable when Supabase is slow,
   misconfigured, blocked, or unavailable. LocalStorage is initialized and rendered first. */
(function(){
  const c=window.EAD_SUPABASE_CONFIG||{};
  const configured=!!(c.url&&c.anonKey&&!c.url.includes('YOUR_')&&!c.anonKey.includes('YOUR_'));
  window.EAD_SUPABASE_STATUS=configured?'Connecting to Supabase in background…':'Local mode — Supabase credentials not configured';
  window.EAD_SUPABASE_READY=Promise.resolve();
  if(!configured||!window.supabase?.createClient)return;
  const client=window.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:false}});
  window.EAD_SUPABASE=client;
  function hasUsefulState(state){
    if(!state||typeof state!=='object')return false;
    const required=['users','students','teachers','subjects','classes','timetable','assignments','settings'];
    return required.every(k=>Array.isArray(state[k])||k==='settings') && Array.isArray(state.users) && state.users.length>0;
  }
  async function withTimeout(promise,ms=2500){return await Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Supabase timeout')),ms))])}
  async function pull(){
    try{
      const result=await withTimeout(client.from(c.table||'ead_app_state').select('state,updated_at').eq('id',c.stateId||'ead-main').maybeSingle());
      if(result.error)throw result.error;
      const remote=result.data?.state;
      const local=db();
      if(localStorage.getItem(PENDING)){await flush();}
      else if(hasUsefulState(remote)){
        const remoteUpdated=Date.parse(result.data?.updated_at||0)||0;
        const localUpdated=Number(localStorage.getItem('eadSupabaseUpdatedAt')||0);
        const localHasData=(local.students?.length||0)+(local.assignments?.length||0)+(local.timetable?.length||0)>0;
        const remoteHasData=(remote.students?.length||0)+(remote.assignments?.length||0)+(remote.timetable?.length||0)>0;
        if(remoteUpdated>=localUpdated && (remoteHasData||!localHasData)){
          localStorage.setItem(DBKEY,JSON.stringify(normalizeState(remote)));
          localStorage.setItem('eadSupabaseUpdatedAt',String(remoteUpdated||Date.now()));
          window.dispatchEvent(new Event('ead-cloud-refresh'));
        }
      }else{
        await push(local);
      }
      window.EAD_SUPABASE_STATUS='Supabase sync ready';
    }catch(e){console.warn('Supabase background sync unavailable; local mode remains active.',e);window.EAD_SUPABASE_STATUS='Local mode — cloud sync unavailable';}
  }
  const PENDING='eadSupabasePending';
  async function push(state){
    const payload={id:c.stateId||'ead-main',state:normalizeState(state),updated_at:new Date().toISOString()};
    const result=await withTimeout(client.from(c.table||'ead_app_state').upsert(payload,{onConflict:'id'}));
    if(result.error)throw result.error;
    localStorage.setItem('eadSupabaseUpdatedAt',String(Date.now()));
  }
  // Saves are debounced and serialized: concurrent upserts could land out of order and
  // let an older snapshot overwrite a newer one, so only one push runs at a time and
  // every push reads the latest local state when it starts.
  let pushing=null,dirty=false,timer=null;
  async function flush(){
    if(pushing){dirty=true;return pushing}
    pushing=(async()=>{
      let ok=true;
      do{dirty=false;try{const started=localStorage.getItem(PENDING);await push(db());if(localStorage.getItem(PENDING)===started)localStorage.removeItem(PENDING);window.EAD_SUPABASE_STATUS='Supabase sync complete'}catch(e){ok=false;console.warn('Cloud save skipped:',e)}}while(dirty);
      return ok;
    })();
    try{return await pushing}finally{pushing=null}
  }
  window.EADSupabaseBridge={
    syncNow:()=>new Promise(resolve=>{localStorage.setItem(PENDING,Date.now()+"-"+Math.random().toString(36).slice(2));clearTimeout(timer);timer=setTimeout(()=>flush().then(resolve),250)}),
    flushNow:flush,
    pullNow:pull
  };
  window.addEventListener('pagehide',()=>{if(timer){clearTimeout(timer);timer=null;flush()}});
  setTimeout(pull,150);
})();
