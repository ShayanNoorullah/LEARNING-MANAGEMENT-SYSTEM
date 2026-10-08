require('dotenv').config({path: require('path').join(__dirname,'..','.env')});
const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const multer=require('multer');
let neonSql=null; try { if(process.env.DATABASE_URL){ const {neon}=require('@neondatabase/serverless'); neonSql=neon(process.env.DATABASE_URL); } } catch(e){ console.warn('Neon driver unavailable; continuing with local JSON storage.'); }
// Passkey library (~190 ms to load) is required on first passkey request, not on every cold start.
const wa=n=>(...a)=>require('@simplewebauthn/server')[n](...a);
const generateRegistrationOptions=wa('generateRegistrationOptions'),verifyRegistrationResponse=wa('verifyRegistrationResponse'),generateAuthenticationOptions=wa('generateAuthenticationOptions'),verifyAuthenticationResponse=wa('verifyAuthenticationResponse');
const app=express();
const PORT=Number(process.env.PORT||3000);
const SECRET=process.env.JWT_SECRET||'sdc-learn-development-secret-change-in-production';
const ROOT=path.join(__dirname,'..');
// Production WebAuthn configuration. Prefer explicit environment values; otherwise
// derive the canonical HTTPS origin from the request so a single-domain deployment
// (frontend + API on the same Express service) works without localhost settings.
app.set('trust proxy', 1);
function getWebAuthnConfig(req){
 const configuredOrigin=(process.env.WEBAUTHN_ORIGIN||process.env.PUBLIC_URL||'').replace(/\/$/,'');
 if(configuredOrigin){
   const u=new URL(configuredOrigin);
   return {origin:u.origin,rpID:process.env.WEBAUTHN_RP_ID||u.hostname};
 }
 const host=String(req.get('host')||'').split(':')[0];
 const proto=(req.get('x-forwarded-proto')||req.protocol||'http').split(',')[0].trim();
 const origin=`${proto}://${req.get('host')}`.replace(/\/$/,'');
 return {origin,rpID:process.env.WEBAUTHN_RP_ID||host};
}
function requireSecureWebAuthn(req,res,next){
 const {origin,rpID}=getWebAuthnConfig(req);
 if(rpID!=='localhost' && !origin.startsWith('https://')) return res.status(400).json({error:'Passkeys require HTTPS in production.'});
 req.webauthn={origin,rpID}; next();
}
// Challenges travel as short-lived signed tokens rather than in server memory, so the
// options and verify requests may be served by different serverless instances.
function createChallengeToken(type,key,challenge){return jwt.sign({type,key,challenge},SECRET,{expiresIn:'2m'});}
function consumeChallenge(type,key,token){try{const p=jwt.verify(String(token||''),SECRET);return p.type===type&&p.key===key?p.challenge:null;}catch(e){return null;}}
const emailAliases={};
const normalizeEmail=email=>emailAliases[String(email||'').toLowerCase()]||String(email||'').toLowerCase();
const IS_VERCEL=!!process.env.VERCEL;
const BUNDLED_DATA_FILE=path.join(__dirname,'data','database.json');
const DATA_FILE=IS_VERCEL?path.join('/tmp','sdc-data','database.json'):BUNDLED_DATA_FILE;
const UPLOAD_DIR=IS_VERCEL?path.join('/tmp','sdc-uploads'):path.join(__dirname,'uploads');
fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
if(IS_VERCEL&&!fs.existsSync(DATA_FILE)&&fs.existsSync(BUNDLED_DATA_FILE))fs.copyFileSync(BUNDLED_DATA_FILE,DATA_FILE);
// Status/health never need the Neon passkey DB — don't block them on cold pull.
// ponytail: still kick loadFromNeon() in the background so the next real API is warm.
const API_LIGHT=new Set(['/api/health','/api/sdc/status','/api/ai/status']);
app.use(async(req,res,next)=>{
  if(!req.path.startsWith('/api/'))return next();
  if(API_LIGHT.has(req.path)){loadFromNeon();return next();}
  await loadFromNeon();
  next();
});
// Shared state gateway (sign-in, state sync, certificate check) — see state-api.js.
app.use(require('./state-api'));
app.use(require('./ai-api')); // SDC Learn AI proxy (OpenAI / Gemini / Azure)
app.use(cors());app.use(express.json({limit:'10mb'}));app.use(express.urlencoded({extended:true}));
// Uploaded files are always served as downloads with sniffing disabled, so an upload can never run as a page.
app.use('/uploads',express.static(UPLOAD_DIR,{setHeaders:res=>{res.setHeader('Content-Disposition','attachment');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'");}}));
app.use('/uploads',(req,res)=>res.status(404).json({error:'File not found'}));
async function neonEnsure(){
 if(!neonSql)return false;
 await neonSql`CREATE TABLE IF NOT EXISTS ead_portal_state (
   id TEXT PRIMARY KEY,
   state JSONB NOT NULL,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`;
 return true;
}
async function neonSync(db){
 if(!neonSql)return;
 try{await neonEnsure();await neonSql`INSERT INTO ead_portal_state (id,state,updated_at) VALUES ('ead-main',${JSON.stringify(db)}::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state,updated_at=EXCLUDED.updated_at`;}
 catch(e){console.warn('Neon sync skipped:',e.message);}
}
async function neonPull(){
 if(!neonSql)return null;
 try{await neonEnsure();const rows=await neonSql`SELECT state,updated_at FROM ead_portal_state WHERE id='ead-main' LIMIT 1`;return rows[0]?.state||null;}
 catch(e){console.warn('Neon pull skipped:',e.message);return null;}
}
function seed(){return {users:[
{id:'u-admin',name:'Sana Mirza',email:'admin@sdclearn.demo',username:'admin',passwordHash:bcrypt.hashSync('Demo@123',10),role:'admin',status:'Active',passkeys:[]},
{id:'u-faraz',name:'Faraz Ahmed',email:'instructor@sdclearn.demo',username:'instructor',passwordHash:bcrypt.hashSync('Demo@123',10),role:'teacher',status:'Active',passkeys:[]},
{id:'u-ali',name:'Ali Raza',email:'learner@sdclearn.demo',username:'learner',passwordHash:bcrypt.hashSync('Demo@123',10),role:'student',status:'Active',passkeys:[]}
],students:[],teachers:[],departments:[],programs:[],subjects:[],classes:[],timetable:[],attendance:[],assignments:[],submissions:[],exams:[],results:[],fees:[],announcements:[],messages:[],notifications:[],materials:[],settings:{productName:'SDC Learn',attendanceWarning:75,academicYear:'2026-27'}}}
function readDB(){if(!fs.existsSync(DATA_FILE)){fs.writeFileSync(DATA_FILE,JSON.stringify(seed(),null,2));}return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}
async function writeDB(db){fs.writeFileSync(DATA_FILE,JSON.stringify(db,null,2));await neonSync(db);return db;}
// Load the Neon copy once per process (per cold start on serverless) before serving requests.
let neonReady=null;
function loadFromNeon(){if(!neonReady)neonReady=(async()=>{try{const remote=await neonPull();if(remote&&Array.isArray(remote.users)&&remote.users.length)fs.writeFileSync(DATA_FILE,JSON.stringify(remote,null,2));}catch(e){console.warn('Neon startup pull skipped:',e.message)}})();return neonReady;}
function id(prefix='REC'){return `${prefix}-${crypto.randomUUID()}`}
function safeUser(u){const {passwordHash,...rest}=u;return rest}
function auth(req,res,next){const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):null;if(!token)return res.status(401).json({error:'Authentication required'});try{req.user=jwt.verify(token,SECRET);next()}catch(e){res.status(401).json({error:'Invalid or expired token'})}}
function roles(...allowed){return (req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'Insufficient permission'});}

// ---------- WebAuthn / Passkey authentication ----------
function publicUser(u){return {id:u.id,name:u.name,email:u.email,role:u.role,status:u.status}}
function b64url(buffer){return Buffer.from(buffer).toString('base64url')}
function findPasskeyUser(db,credentialID){return db.users.find(u=>(u.passkeys||[]).some(p=>p.credentialID===credentialID))}
app.post('/api/auth/passkey/register/options',requireSecureWebAuthn,async(req,res)=>{
 try{
  const {email,password,role}=req.body||{};const db=readDB();const user=db.users.find(u=>normalizeEmail(u.email)===normalizeEmail(email)&&u.role===role&&u.status==='Active');
  if(!user||!await bcrypt.compare(password||'',user.passwordHash))return res.status(401).json({error:'Verify your current SDC Learn email, password and role before adding a passkey.'});
  const options=await generateRegistrationOptions({rpName:'SDC Learn',rpID:req.webauthn.rpID,userID:Buffer.from(user.id,'utf8'),userName:user.email,userDisplayName:user.name,attestationType:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'preferred'},excludeCredentials:(user.passkeys||[]).map(p=>({id:p.credentialID,type:'public-key',transports:p.transports||[]}))});
  res.json({options,userId:user.id,transactionId:createChallengeToken('register',user.id,options.challenge)});
 }catch(e){console.error(e);res.status(500).json({error:'Unable to create passkey registration options.'})}
});
app.post('/api/auth/passkey/register/verify',requireSecureWebAuthn,async(req,res)=>{
 try{
  const {userId,response,transactionId}=req.body||{};const expectedChallenge=consumeChallenge('register',userId,transactionId);if(!expectedChallenge)return res.status(400).json({error:'Passkey registration expired. Please start again.'});
  const verification=await verifyRegistrationResponse({response,expectedChallenge,expectedOrigin:req.webauthn.origin,expectedRPID:req.webauthn.rpID,requireUserVerification:false});
  if(!verification.verified||!verification.registrationInfo)return res.status(400).json({error:'Passkey registration was not verified.'});
  const info=verification.registrationInfo;const credential=info?.credential||info;const rawCredentialID=credential?.id||info?.credentialID;const credentialID=typeof rawCredentialID==='string'?rawCredentialID:b64url(rawCredentialID);const credentialPublicKey=b64url(credential?.publicKey||info?.credentialPublicKey);const counter=Number(credential?.counter??info?.counter??0);if(!credentialID||!credentialPublicKey)return res.status(400).json({error:'The browser did not return a usable passkey credential.'});
  const db=readDB();const user=db.users.find(u=>u.id===userId);if(!user)return res.status(404).json({error:'User not found'});user.passkeys=user.passkeys||[];
  if(!user.passkeys.some(p=>p.credentialID===credentialID))user.passkeys.push({credentialID,credentialPublicKey,counter,transports:credential?.transports||response.response.transports||[]});
  await writeDB(db);res.json({verified:true});
 }catch(e){console.error(e);res.status(400).json({error:'Passkey registration verification failed.'})}
});
app.post('/api/auth/passkey/options',requireSecureWebAuthn,async(req,res)=>{
 try{const email=normalizeEmail(req.body?.email),role=req.body?.role;const db=readDB();const user=email?db.users.find(u=>normalizeEmail(u.email)===email&&(!role||u.role===role)&&u.status==='Active'):null;const options=await generateAuthenticationOptions({rpID:req.webauthn.rpID,userVerification:'preferred',allowCredentials:user?.passkeys?.map(p=>({id:p.credentialID,type:'public-key',transports:p.transports||[]}))||[]});res.json({...options,transactionId:createChallengeToken('login','login',options.challenge)});}catch(e){console.error(e);res.status(500).json({error:'Unable to start passkey sign-in.'})}
});
app.post('/api/auth/passkey/verify',requireSecureWebAuthn,async(req,res)=>{
 try{const response=req.body?.response,transactionId=req.body?.transactionId;if(!transactionId)return res.status(400).json({error:'Passkey sign-in transaction is missing. Please try again.'});const expectedChallenge=consumeChallenge('login','login',transactionId);if(!expectedChallenge)return res.status(400).json({error:'Passkey sign-in expired. Please try again.'});const db=readDB();const user=findPasskeyUser(db,response?.id);if(!user)return res.status(404).json({error:'No SDC Learn account is linked to this passkey.'});const passkey=(user.passkeys||[]).find(p=>p.credentialID===response.id);if(!passkey)return res.status(404).json({error:'No SDC Learn account is linked to this passkey.'});const verification=await verifyAuthenticationResponse({response,expectedChallenge,expectedOrigin:req.webauthn.origin,expectedRPID:req.webauthn.rpID,authenticator:{credentialID:passkey.credentialID,credentialPublicKey:Buffer.from(passkey.credentialPublicKey,'base64url'),counter:passkey.counter,transports:passkey.transports||[]},requireUserVerification:true});if(!verification.verified)return res.status(401).json({error:'Passkey could not be verified.'});passkey.counter=verification.authenticationInfo.newCounter;await writeDB(db);const token=jwt.sign({id:user.id,role:user.role,email:user.email},SECRET,{expiresIn:'8h'});res.json({token,user:publicUser(user)});}
 catch(e){console.error(e);res.status(401).json({error:'Passkey sign-in failed. Use the same HTTPS portal domain where the passkey was registered.'})}
});

app.get('/api/health',(req,res)=>res.json({status:'ok',service:'SDC Learn API',time:new Date().toISOString(),neonConfigured:!!neonSql}));
app.get('/api/neon/health',async(req,res)=>{if(!neonSql)return res.status(503).json({connected:false,configured:false,message:'DATABASE_URL is not configured.'});try{await neonEnsure();const r=await neonSql`SELECT NOW() AS server_time`;res.json({connected:true,configured:true,serverTime:r[0]?.server_time||null});}catch(e){res.status(503).json({connected:false,configured:true,message:e.message});}});
app.post('/api/neon/bootstrap',auth,roles('admin'),async(req,res)=>{if(!neonSql)return res.status(503).json({error:'DATABASE_URL is not configured.'});try{const db=readDB();await neonEnsure();await neonSync(db);res.json({ok:true,records:Object.fromEntries(Object.entries(db).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))});}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/auth/login',async(req,res)=>{
 const {email,password,role}=req.body||{};
 if(!email||!password)return res.status(400).json({error:'Email and password are required'});
 const db=readDB();
 const normalized=normalizeEmail(email);
 const user=db.users.find(u=>{
  const matchEmail=u.email.toLowerCase()===normalized||u.username===email||u.email.toLowerCase()===String(email).toLowerCase();
  const matchRole=!role||u.role===role;
  return matchEmail&&matchRole&&u.status==='Active';
 });
 if(!user||!await bcrypt.compare(password,user.passwordHash))return res.status(401).json({error:'Invalid credentials'});
 const token=jwt.sign({id:user.id,role:user.role,email:user.email},SECRET,{expiresIn:'8h'});
 res.json({token,user:safeUser(user)});
});
app.get('/api/auth/me',auth,(req,res)=>{const u=readDB().users.find(x=>x.id===req.user.id);u?res.json({user:safeUser(u)}):res.status(404).json({error:'User not found'});});
const collections=['students','teachers','departments','programs','subjects','classes','timetable','attendance','assignments','submissions','exams','results','fees','announcements','messages','notifications','materials'];
for(const key of collections){
 app.get(`/api/${key}`,auth,(req,res)=>res.json(readDB()[key]||[]));
 app.get(`/api/${key}/:id`,auth,(req,res)=>{const x=(readDB()[key]||[]).find(v=>v.id===req.params.id);x?res.json(x):res.status(404).json({error:'Record not found'});});
 app.post(`/api/${key}`,auth,roles('admin','teacher'),async(req,res)=>{const db=readDB();const record={id:req.body.id||id(key.slice(0,3).toUpperCase()),...req.body,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db[key]=db[key]||[];db[key].push(record);await writeDB(db);res.status(201).json(record);});
 app.put(`/api/${key}/:id`,auth,roles('admin','teacher'),async(req,res)=>{const db=readDB();const i=(db[key]||[]).findIndex(v=>v.id===req.params.id);if(i<0)return res.status(404).json({error:'Record not found'});db[key][i]={...db[key][i],...req.body,id:req.params.id,updatedAt:new Date().toISOString()};await writeDB(db);res.json(db[key][i]);});
 app.delete(`/api/${key}/:id`,auth,roles('admin','teacher'),async(req,res)=>{const db=readDB();const before=(db[key]||[]).length;db[key]=(db[key]||[]).filter(v=>v.id!==req.params.id);if(db[key].length===before)return res.status(404).json({error:'Record not found'});await writeDB(db);res.status(204).end();});
}
app.get('/api/dashboard/summary',auth,(req,res)=>{const db=readDB();const count=k=>(db[k]||[]).length;res.json({students:count('students'),teachers:count('teachers'),departments:count('departments'),programs:count('programs'),subjects:count('subjects'),classes:count('classes'),assignments:count('assignments'),exams:count('exams'),fees:count('fees'),attendance:count('attendance'),notifications:count('notifications')});});
const upload=multer({dest:UPLOAD_DIR,limits:{fileSize:10*1024*1024}});
app.post('/api/uploads',auth,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'File is required'});res.status(201).json({filename:req.file.filename,originalName:req.file.originalname,size:req.file.size,url:`/uploads/${req.file.filename}`});});
// SDC Learn file uploads (assignment submissions, session resources, logos).
// Validated server-side by extension and size; stored under a random name.
const UPLOAD_TYPES=String(process.env.UPLOAD_ALLOWED_TYPES||'xlsx,xls,xlsm,csv,docx,doc,pptx,ppt,pdf,pbix,twbx,twb,ipynb,sql,txt,md,zip,png,jpg,jpeg,webp,svg,mp4').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
// On Vercel the function disk is temporary, so uploads go to Vercel Blob when its token is present.
const USE_BLOB=!!process.env.BLOB_READ_WRITE_TOKEN;
// ponytail: Blob uploads pass through the function, so Vercel's 4.5 MB request limit applies; switch to client-side Blob uploads if larger files are needed
const UPLOAD_MAX_MB=Math.min(Number(process.env.UPLOAD_MAX_MB||30),USE_BLOB?4.5:Infinity);
const lmsUpload=multer({
 storage:USE_BLOB?multer.memoryStorage():multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,crypto.randomUUID()+'.'+path.extname(file.originalname).slice(1).toLowerCase())}),
 limits:{fileSize:UPLOAD_MAX_MB*1024*1024,files:1},
 fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).slice(1).toLowerCase();if(!UPLOAD_TYPES.includes(ext)){const e=new Error('.'+ext+' files are not accepted. Allowed: '+UPLOAD_TYPES.join(', '));e.status=415;return cb(e);}cb(null,true);}
});
app.post('/api/lms/uploads',(req,res)=>lmsUpload.single('file')(req,res,err=>{
 if(err){const tooBig=err.code==='LIMIT_FILE_SIZE';return res.status(tooBig?413:(err.status||400)).json({error:tooBig?'File is larger than '+UPLOAD_MAX_MB+' MB.':err.message});}
 if(!req.file)return res.status(400).json({error:'File is required'});
 if(!USE_BLOB)return res.status(201).json({url:'/uploads/'+req.file.filename,fileName:req.file.originalname,size:req.file.size});
 const {put}=require('@vercel/blob');
 put('uploads/'+crypto.randomUUID()+path.extname(req.file.originalname).toLowerCase(),req.file.buffer,{access:'public',contentType:req.file.mimetype||'application/octet-stream'})
  .then(b=>res.status(201).json({url:b.downloadUrl,fileName:req.file.originalname,size:req.file.size}))
  .catch(e=>{console.error('Blob upload failed:',e);res.status(502).json({error:'File storage is unavailable. Please try again.'});});
}));
app.get('/api/lms/upload-config',(req,res)=>res.json({maxMB:UPLOAD_MAX_MB,types:UPLOAD_TYPES,storage:USE_BLOB?'vercel-blob':'disk'}));
app.get('/api/admin/export',auth,roles('admin'),(req,res)=>res.json(readDB()));
app.use(express.static(ROOT,{extensions:['html']}));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({error:err.message||'Server error'});});
module.exports=app;
if(require.main===module)loadFromNeon().then(()=>app.listen(PORT,()=>console.log(`SDC Learn running at http://localhost:${PORT}`)));
