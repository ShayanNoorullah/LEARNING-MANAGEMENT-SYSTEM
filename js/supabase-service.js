/*
  EAD University Portal -> Supabase PostgreSQL bridge
  --------------------------------------------------
  Migration strategy: LocalStorage remains the immediate UI store, while
  PostgreSQL becomes the cloud persistence layer. CRUD changes trigger a
  debounced background push after Supabase is configured.

  This hybrid approach keeps the existing synchronous portal code stable while
  making the database migration easy to demonstrate and reverse during the
  internship prototype stage.
*/
(function(){
  const cfg = window.EAD_SUPABASE_CONFIG || {};
  const TABLES = [
    'users','students','teachers','departments','programs','subjects','classes',
    'timetable','attendance','assignments','submissions','exams','results','fees',
    'announcements','messages','notifications'
  ];
  const SETTINGS_TABLE = 'portal_settings';
  let client = null;
  let syncing = false;
  let timer = null;

  function configured(){
    return !!(cfg.url && cfg.publishableKey &&
      !cfg.url.includes('PASTE_YOUR_') &&
      !cfg.publishableKey.includes('PASTE_YOUR_'));
  }

  function getClient(){
    if(!configured()) return null;
    if(client) return client;
    if(!window.supabase || !window.supabase.createClient){
      console.warn('[Supabase] supabase-js library is not loaded.');
      return null;
    }
    client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return client;
  }

  function status(){
    return {
      configured: configured(),
      connected: !!client,
      mode: 'LocalStorage + Supabase PostgreSQL',
      tables: TABLES.length + 1
    };
  }

  async function testConnection(){
    const sb = getClient();
    if(!sb) return {ok:false,message:'Supabase is not configured yet. Add your Project URL and publishable key in js/supabase-config.js.'};
    const { error } = await sb.from('students').select('id').limit(1);
    if(error) return {ok:false,message:error.message,error};
    return {ok:true,message:'Connected successfully to Supabase PostgreSQL.'};
  }

  function rowsFor(collection, rows){
    return (rows || []).map(record => ({
      id: String(record.id),
      payload: record,
      updated_at: new Date().toISOString()
    }));
  }

  async function pushCollection(table, rows){
    const sb = getClient();
    if(!sb) throw new Error('Supabase is not configured.');
    const payload = rowsFor(table, rows);

    // Remove cloud records deleted locally, then upsert current records.
    const { data: remote, error: readError } = await sb.from(table).select('id');
    if(readError) throw new Error(`${table}: ${readError.message}`);
    const localIds = new Set(payload.map(x => x.id));
    const staleIds = (remote || []).map(x => x.id).filter(id => !localIds.has(String(id)));
    if(staleIds.length){
      const { error: delError } = await sb.from(table).delete().in('id', staleIds);
      if(delError) throw new Error(`${table}: ${delError.message}`);
    }
    if(payload.length){
      const { error } = await sb.from(table).upsert(payload, {onConflict:'id'});
      if(error) throw new Error(`${table}: ${error.message}`);
    }
  }

  async function pushAll(options={}){
    const sb = getClient();
    if(!sb) return {ok:false,message:'Supabase is not configured.'};
    if(syncing) return {ok:false,message:'A sync is already in progress.'};
    syncing = true;
    try{
      const local = db();
      for(const table of TABLES) await pushCollection(table, local[table] || []);
      const settingRow = [{
        id:'main',
        payload: local.settings || {},
        updated_at:new Date().toISOString()
      }];
      const { error } = await sb.from(SETTINGS_TABLE).upsert(settingRow,{onConflict:'id'});
      if(error) throw new Error(`${SETTINGS_TABLE}: ${error.message}`);
      window.dispatchEvent(new CustomEvent('ead-cloud-sync',{detail:{direction:'push',ok:true}}));
      return {ok:true,message:'Local portal data was pushed to Supabase PostgreSQL successfully.'};
    }catch(error){
      console.error('[Supabase push]',error);
      return {ok:false,message:error.message,error};
    }finally{ syncing=false; }
  }

  async function pullAll(){
    const sb = getClient();
    if(!sb) return {ok:false,message:'Supabase is not configured.'};
    if(syncing) return {ok:false,message:'A sync is already in progress.'};
    syncing = true;
    try{
      const next = db();
      for(const table of TABLES){
        const {data,error} = await sb.from(table).select('id,payload').order('id');
        if(error) throw new Error(`${table}: ${error.message}`);
        if(data && data.length) next[table] = data.map(row => row.payload);
      }
      const {data:settings,error:settingsError}=await sb.from(SETTINGS_TABLE).select('payload').eq('id','main').maybeSingle();
      if(settingsError) throw new Error(`${SETTINGS_TABLE}: ${settingsError.message}`);
      if(settings?.payload) next.settings = settings.payload;
      localStorage.setItem(DBKEY, JSON.stringify(next));
      window.dispatchEvent(new Event('ead-db-change'));
      window.dispatchEvent(new CustomEvent('ead-cloud-sync',{detail:{direction:'pull',ok:true}}));
      return {ok:true,message:'Supabase PostgreSQL data was pulled into the local portal successfully.'};
    }catch(error){
      console.error('[Supabase pull]',error);
      return {ok:false,message:error.message,error};
    }finally{ syncing=false; }
  }

  function scheduleAutoPush(){
    if(!configured() || cfg.autoSync===false || syncing) return;
    clearTimeout(timer);
    timer = setTimeout(()=>pushAll({automatic:true}), Number(cfg.debounceMs)||900);
  }

  window.addEventListener('ead-db-change', scheduleAutoPush);

  window.EADCloud = {
    configured,
    status,
    testConnection,
    pushAll,
    pullAll,
    tables: TABLES.slice()
  };

  if(configured()){
    getClient();
    console.info('[Supabase] PostgreSQL integration configured. Local changes will sync automatically.');
  }else{
    console.info('[Supabase] Integration files are installed. Add your Supabase URL and publishable key to enable cloud sync.');
  }
})();
