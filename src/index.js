const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const safe = (v, max = 250) => String(v ?? '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const randomHex = n => hex(rand(n));
const sha = async data => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data)));
const base64urlDecode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const bytesToBase64 = bytes => { let out=''; const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); for(let i=0;i<a.length;i+=0x8000) out += String.fromCharCode(...a.subarray(i,i+0x8000)); return btoa(out); };
const emailOK = v => typeof v === 'string' && v.trim().length <= 254 && /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(v.trim());
const phoneOK = v => { if (!v) return true; if (typeof v !== 'string' || !/^\+?[0-9() .-]+$/.test(v)) return false; const n=v.replace(/\D/g,''); return n.length>=7 && n.length<=15; };
const isBackupHost = request => { const h=new URL(request.url).hostname; return h === 'backup.digitalkidsfoundation.org' || h.endsWith('.workers.dev'); };
const baseUrl = (env, request) => (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
const mailFrom = env => env.MAIL_FROM || 'website@digitalkidsfoundation.org';
const mailTo = env => env.MAIL_TO || 'help@digitalkidsfoundation.org';
const laptopNotify = env => env.LAPTOP_NOTIFY_EMAIL || env.MAIL_TO || 'help@digitalkidsfoundation.org';

const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://www.paypal.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.paypalobjects.com https://www.paypal.com https://www.googletagmanager.com https://www.google-analytics.com https://www.googleadservices.com https://www.google.com https://googleads.g.doubleclick.net https://tagassistant.google.com https://unpkg.com https://static.cloudflareinsights.com; frame-src 'self' blob: https://challenges.cloudflare.com https://www.paypal.com https://www.sandbox.paypal.com https://www.googletagmanager.com https://tagassistant.google.com; connect-src 'self' https://challenges.cloudflare.com https://www.paypal.com https://www.paypalobjects.com https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com https://region2.google-analytics.com https://analytics.google.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://ad.doubleclick.net https://tagassistant.google.com https://cloudflareinsights.com";

function withSecurity(response, request, extra = {}) {
  const h = new Headers(response.headers);
  h.set('X-Content-Type-Options','nosniff');
  h.set('Referrer-Policy','strict-origin-when-cross-origin');
  h.set('X-Frame-Options','DENY');
  h.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  h.set('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  h.set('Content-Security-Policy', CSP);
  h.set('Strict-Transport-Security','max-age=31536000');
  if (isBackupHost(request)) h.set('X-Robots-Tag','noindex, nofollow, noarchive');
  for (const [k,v] of Object.entries(extra)) h.set(k,v);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}

async function parseJson(request, max = 102400) {
  if (Number(request.headers.get('content-length') || 0) > max) throw Object.assign(new Error('Request too large'), {status:413});
  const text = await request.text();
  if (text.length > max) throw Object.assign(new Error('Request too large'), {status:413});
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), {status:400}); }
}

async function sendMail(payload, env, idempotencyKey = null) {
  if (!env.RESEND_API_KEY) return {ok:false};
  const headers={Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'};
  if (idempotencyKey) headers['Idempotency-Key']=idempotencyKey;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body.id){console.error('Resend failure',r.status);return {ok:false,status:r.status};}
  return {ok:true,id:body.id};
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY || typeof token !== 'string' || !token || token.length > 2048) return false;
  const p=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token});
  const ip=request.headers.get('CF-Connecting-IP'); if(ip)p.set('remoteip',ip);
  const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:p,signal:AbortSignal.timeout(8000)});
  if(!r.ok)return false;
  const j=await r.json();
  return j.success===true && j.hostname===new URL(request.url).hostname;
}

async function rateLimit(request, env, scope='submit', limit=10, windowMs=600000) {
  if(!env.DB)return false;
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const id=await sha(`${scope}:${ip}`), bucket=Math.floor(Date.now()/windowMs);
  const row=await env.DB.prepare('INSERT INTO submission_rate_limits (id,window_start,count) VALUES (?,?,1) ON CONFLICT(id,window_start) DO UPDATE SET count=count+1 RETURNING count').bind(id,bucket).first();
  return Number(row?.count||0)<=limit;
}

function notification(type,data,env) {
  const labels={contact:'Contact Message',volunteer:'Volunteer Application',donation:'Device Donation Submission'};
  const ignored=new Set(['formType','website','turnstileToken','cf-turnstile-response','_subject','_next','_captcha','_replyto']);
  const entries=Object.entries(data).filter(([k])=>!ignored.has(k));
  const rows=entries.map(([k,v])=>`<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">${esc(k.replace(/[_-]+/g,' '))}</td><td style="padding:8px;border:1px solid #ddd">${esc(v)}</td></tr>`).join('');
  const payload={from:`Digital Kids Foundation Website <${mailFrom(env)}>`,to:[mailTo(env)],subject:`[DKF Website] ${labels[type]}`,html:`<h2>Digital Kids Foundation — ${esc(labels[type])}</h2><p>Submitted from digitalkidsfoundation.org</p><table style="border-collapse:collapse;width:100%">${rows}</table>`,text:`${labels[type]}\n\n`+entries.map(([k,v])=>`${k}: ${v}`).join('\n')};
  if(emailOK(data.email))payload.reply_to=data.email;
  return payload;
}

function volunteerThankYou(data,env){
  const first=safe(data.first_name||data.firstName||data.name,70).split(/\s+/)[0];
  const greeting=first?`Dear ${first},`:'Dear Volunteer,';
  const role=safe(data.role,80)||'Open to Any Role';
  const text=`${greeting}\n\nThank you for offering your time and talents to Digital Kids Foundation!\n\nArea of interest: ${role}\n\nWe have received your volunteer application. Our team will review it and reach out if there is a suitable opportunity. This message is an acknowledgment, not confirmation of a volunteer placement.\n\nWith appreciation,\nDigital Kids Foundation Team\nhttps://digitalkidsfoundation.org`;
  return {from:`Digital Kids Foundation <${mailFrom(env)}>`,to:[data.email],subject:`Thank you for your interest in ${role} — Digital Kids Foundation`,text,html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#183b34;line-height:1.7"><h1>Digital Kids Foundation</h1><p>${esc(greeting)}</p><h2>Thank you for stepping forward!</h2><p>We have received your volunteer application.</p><p><strong>Area of interest:</strong> ${esc(role)}</p><p>Our team will review it and reach out if there is a suitable opportunity. This message is an acknowledgment, not confirmation of a volunteer placement.</p><p>With appreciation,<br>Digital Kids Foundation Team</p></div>`};
}

async function submitPublic(request,env){
  if(!env.DB||!env.RESEND_API_KEY||!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY)return json({ok:false,error:'Form service is not fully configured.'},503);
  if(!await rateLimit(request,env,'public-form',10,600000))return json({ok:false,error:'Too many submissions. Please try again later.'},429);
  const data=await parseJson(request);
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>40||Object.entries(data).some(([k,v])=>k.length>80||!['string','number','boolean'].includes(typeof v)||String(v).length>4000))return json({ok:false,error:'Invalid or oversized submission.'},400);
  if(data.website)return json({ok:true});
  if(!await verifyTurnstile(data.turnstileToken,request,env))return json({ok:false,error:'Security verification failed or expired. Please try again.'},403);
  const type=['contact','volunteer','donation'].includes(data.formType)?data.formType:null;
  if(!type)return json({ok:false,error:'Unknown form type.'},400);
  if(!emailOK(data.email))return json({ok:false,error:'Please enter a valid email address.'},400);
  if(data.phone!=null&&!phoneOK(data.phone))return json({ok:false,error:'Please enter a valid phone number, or leave it blank.'},400);
  const result=await sendMail(notification(type,data,env),env);
  if(!result.ok)return json({ok:false,error:'Unable to send your submission right now.'},502);
  if(type==='volunteer'){try{await sendMail(volunteerThankYou(data,env),env);}catch(e){console.error('Volunteer acknowledgment failed');}}
  return json({ok:true,id:result.id});
}

const laptopStatuses=['submitted','under_review','more_information_needed','waitlisted','approved','declined','ready_for_allocation','fulfilled'];
const laptopReady = env => Boolean(env.DB&&env.RESEND_API_KEY&&env.MAIL_FROM&&env.TURNSTILE_SECRET_KEY&&env.TURNSTILE_SITE_KEY);
function laptopMail(env,to,subject,text,html){return sendMail({from:`Digital Kids Foundation <${mailFrom(env)}>`,to:[to],subject,text,...(html?{html}:{})},env);}
function laptopVerifiedPage(title,content){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)} | Digital Kids Foundation</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f0f7f5;font-family:Arial,sans-serif;color:#183b34;padding:20px;box-sizing:border-box}.card{background:white;max-width:620px;border-radius:16px;overflow:hidden;box-shadow:0 12px 35px #163d3020}.head{background:#153b34;color:#fff;padding:28px}.body{padding:32px;line-height:1.7}.body h2{color:#b68a25}.ref{background:#f0f7f5;border-radius:8px;padding:12px 16px}a{color:#167a6a}</style></head><body><main class="card"><div class="head"><h1>Digital Kids Foundation</h1><div>Laptop Assistance Program</div></div><div class="body"><h2>${esc(title)}</h2>${content}<p><a href="/">Return to DKF website</a></p></div></main></body></html>`;}
function statusEmail(app,status){
  const map={
    submitted:['Thank you for reaching out to Digital Kids Foundation','We have received your request and it remains in our review queue.'],
    under_review:['A caring update from Digital Kids Foundation','Our team is reviewing your laptop assistance request. No action is needed right now.'],
    more_information_needed:['Can we learn a little more about your laptop request?','Please email help@digitalkidsfoundation.org with your reference number so our team can explain what additional information is needed.'],
    waitlisted:['An update about your laptop assistance request','Your request is on our waiting list because donated devices and program resources are limited.'],
    approved:['Good news about the review of your laptop request','Your request has passed our initial review. This does not yet guarantee a specific device or pickup date.'],
    declined:['An update from Digital Kids Foundation','We are unable to move forward with your request at this time. Thank you for reaching out to us.'],
    ready_for_allocation:['Your DKF laptop request is moving forward','Your request is ready for device allocation. Our team will contact you directly about next steps.'],
    fulfilled:['Thank you for being part of Digital Kids Foundation','Our records show your laptop assistance request has been fulfilled. We hope the technology supports learning and opportunity.']
  };
  const [subject,body]=map[status]||['Digital Kids Foundation update','There is an update to your laptop assistance request.'];
  return {subject,body:`Hello ${app.applicant_name},\n\n${body}\n\nReference: ${app.reference}\n\nWith appreciation,\nDigital Kids Foundation Team`,html:`<div style="font-family:Arial,sans-serif;max-width:600px;color:#183b34"><h2>${esc(subject)}</h2><p>Hello ${esc(app.applicant_name)},</p><p>${esc(body)}</p><p><strong>Reference:</strong> ${esc(app.reference)}</p><p>With appreciation,<br>Digital Kids Foundation Team</p></div>`};
}

async function laptopApply(request,env){
  if(!laptopReady(env))return json({error:'Applications are not yet available'},503);
  if(!await rateLimit(request,env,'laptop-apply',8,3600000))return json({error:'Too many requests'},429);
  const x=await parseJson(request);
  if(x.website)return json({ok:true});
  if(!['individual','school','organization'].includes(x.kind)||!emailOK(x.email)||!['US','GH'].includes(x.country)||!x.consent)return json({error:'Please complete the required fields'},400);
  for(const k of ['applicant_name','location','need','impact','computer_access'])if(typeof x[k]!=='string'||!x[k].trim()||x[k].length>1500)return json({error:`Invalid ${k}`},400);
  if(!phoneOK(String(x.phone||'')))return json({error:'Please enter a valid phone number'},400);
  const q=Number(x.quantity); if(!Number.isInteger(q)||q<1||q>1000||(x.kind==='individual'&&q!==1))return json({error:'Invalid laptop quantity'},400);
  if(x.kind!=='individual'&&(!x.organization||String(x.organization).length>200))return json({error:'Organization name required'},400);
  if(x.kind==='individual'&&(!Number.isInteger(Number(x.child_age))||Number(x.child_age)<3||Number(x.child_age)>17))return json({error:'Enter the child age'},400);
  if(!await verifyTurnstile(x.turnstileToken,request,env))return json({error:'Security verification failed'},403);
  const payload={kind:x.kind,applicant_name:safe(x.applicant_name,150),email:safe(x.email,254).toLowerCase(),phone:safe(x.phone,30),country:x.country,location:safe(x.location,200),organization:safe(x.organization,200),child_age:x.kind==='individual'?Number(x.child_age):null,grade:safe(x.grade,80),quantity:q,computer_access:safe(x.computer_access,100),internet_access:safe(x.internet_access,80),need:safe(x.need,1500),impact:safe(x.impact,1500),financial_difficulty:safe(x.financial_difficulty,80),consent:1};
  const token=randomHex(32), tokenHash=await sha(token), now=Date.now();
  await env.DB.prepare('INSERT INTO laptop_tokens(token_hash,kind,payload,expires_at,created_at) VALUES(?,?,?,?,?)').bind(tokenHash,'apply',JSON.stringify(payload),now+1800000,now).run();
  const link=`${baseUrl(env,request)}/laptop-verify?token=${token}`;
  const text=`Hello ${payload.applicant_name},\n\nPlease confirm your email address to complete your laptop assistance application:\n\n${link}\n\nThis link expires in 30 minutes. Submitting a request does not guarantee a laptop.`;
  const mail=await laptopMail(env,payload.email,'Confirm your email — Digital Kids Foundation',text,`<h2>Confirm your email address</h2><p>Hello ${esc(payload.applicant_name)},</p><p><a href="${esc(link)}">Verify my email</a></p><p>This link expires in 30 minutes. Submitting a request does not guarantee a laptop.</p>`);
  if(!mail.ok){await env.DB.prepare('DELETE FROM laptop_tokens WHERE token_hash=?').bind(tokenHash).run();return json({error:'Unable to send verification email right now'},502);}
  return json({ok:true,message:'Check your email for a verification link.'});
}

async function laptopVerify(request,env){
  const token=new URL(request.url).searchParams.get('token')||'';
  if(!/^[a-f0-9]{64}$/.test(token))return new Response('Invalid verification link',{status:400});
  const tokenHash=await sha(token), now=Date.now();
  const claimed=await env.DB.prepare("UPDATE laptop_tokens SET used_at=? WHERE token_hash=? AND kind='apply' AND used_at IS NULL AND expires_at>? RETURNING id,payload").bind(now,tokenHash,now).first();
  if(!claimed)return new Response('Verification link expired or already used',{status:410});
  let p; try{p=JSON.parse(claimed.payload);}catch{return new Response('Unable to verify now',{status:500});}
  const reference='DKF-LAP-'+randomHex(5).toUpperCase(), ts=nowIso();
  const a=await env.DB.prepare(`INSERT INTO laptop_applications(reference,kind,applicant_name,email,phone,country,location,organization,child_age,grade,quantity,computer_access,internet_access,need,impact,financial_difficulty,consent,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(reference,p.kind,p.applicant_name,p.email,p.phone,p.country,p.location,p.organization,p.child_age,p.grade,p.quantity,p.computer_access,p.internet_access,p.need,p.impact,p.financial_difficulty,1,'submitted',ts,ts).first();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO laptop_history(application_id,status,actor,created_at) VALUES(?,?,?,?)').bind(a.id,'submitted','system',ts),
    env.DB.prepare('UPDATE laptop_tokens SET payload=NULL,application_id=? WHERE id=?').bind(a.id,claimed.id)
  ]);
  try{await laptopMail(env,p.email,'We received your DKF laptop assistance application',`Dear ${p.applicant_name},\n\nWe received your verified application. Reference: ${reference}. Receiving an application does not guarantee a laptop.\n\nDigital Kids Foundation Team`,`<h2>Application received</h2><p>Dear ${esc(p.applicant_name)},</p><p>We received your verified application.</p><p><strong>Reference:</strong> ${esc(reference)}</p><p>Receiving an application does not guarantee a laptop.</p>`);}catch{}
  if(emailOK(laptopNotify(env))){try{await laptopMail(env,laptopNotify(env),`[DKF] New verified laptop application — ${reference}`,`New verified DKF Laptop Assistance application\n\nReference: ${reference}\nApplicant: ${p.applicant_name}\nEmail: ${p.email}\nLocation: ${p.location}\nQuantity: ${p.quantity}\nNeed: ${p.need}`);}catch{}}
  return new Response(laptopVerifiedPage('Email verified — application received',`<p>Thank you for applying to Digital Kids Foundation.</p><p class="ref"><strong>Reference:</strong> ${esc(reference)}</p><p>We have received your application. Our team will contact you if more information or an update is available.</p><p>Receiving an application does not guarantee a laptop.</p>`),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

async function laptopStatusRequest(request,env){
  if(!await rateLimit(request,env,'laptop-status',8,3600000))return json({error:'Too many requests'},429);
  const x=await parseJson(request), email=safe(x.email,254).toLowerCase(), ref=safe(x.reference,40).toUpperCase();
  if(!emailOK(email)||!/^DKF-LAP-[A-F0-9]{10}$/.test(ref))return json({error:'Invalid details'},400);
  const a=await env.DB.prepare('SELECT id FROM laptop_applications WHERE reference=? AND email=?').bind(ref,email).first();
  if(a){const token=randomHex(32),h=await sha(token),now=Date.now();await env.DB.prepare('INSERT INTO laptop_tokens(token_hash,kind,application_id,expires_at,created_at) VALUES(?,?,?,?,?)').bind(h,'status',a.id,now+900000,now).run();await laptopMail(env,email,'DKF application status link',`View your application status: ${baseUrl(env,request)}/laptop-status-verify?token=${token}\nLink expires in 15 minutes.`);}
  return json({ok:true,message:'If the details match an application, a status link will be emailed.'});
}

async function laptopStatusVerify(request,env){
  const token=new URL(request.url).searchParams.get('token')||''; if(!/^[a-f0-9]{64}$/.test(token))return new Response('Invalid link',{status:400});
  const h=await sha(token),now=Date.now(); const t=await env.DB.prepare("UPDATE laptop_tokens SET used_at=? WHERE token_hash=? AND kind='status' AND used_at IS NULL AND expires_at>? RETURNING application_id").bind(now,h,now).first();
  if(!t)return new Response('Expired or used link',{status:410});
  const a=await env.DB.prepare('SELECT reference,status,created_at FROM laptop_applications WHERE id=?').bind(t.application_id).first();
  if(!a)return new Response('Unavailable',{status:404});
  return new Response(`<html><meta name="robots" content="noindex"><body style="font:18px system-ui;max-width:650px;margin:60px auto"><h1>Application status</h1><p>Reference: ${esc(a.reference)}</p><p>Status: <strong>${esc(a.status.replaceAll('_',' '))}</strong></p><p>Submitted: ${esc(String(a.created_at).slice(0,10))}</p></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

let jwksCache={issuer:'',expires:0,keys:[]};
async function adminIdentity(request,env){
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  const issuer=(env.CF_ACCESS_ISSUER||'https://cool-glitter-cd9e.cloudflareaccess.com').replace(/\/$/,'');
  const audience=env.CF_ACCESS_AUD;
  if(!token||!audience)throw Object.assign(new Error('Administrator authentication required'),{status:401});
  const parts=token.split('.'); if(parts.length!==3)throw Object.assign(new Error('Invalid administrator session'),{status:401});
  let header,payload; try{header=JSON.parse(decoder.decode(base64urlDecode(parts[0])));payload=JSON.parse(decoder.decode(base64urlDecode(parts[1])));}catch{throw Object.assign(new Error('Invalid administrator session'),{status:401});}
  const now=Math.floor(Date.now()/1000), aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  if(String(payload.iss||'').replace(/\/$/,'')!==issuer||!aud.includes(audience)||Number(payload.exp||0)<=now||Number(payload.nbf||0)>now+60)throw Object.assign(new Error('Invalid or expired administrator session'),{status:401});
  if(jwksCache.issuer!==issuer||jwksCache.expires<Date.now()){const r=await fetch(`${issuer}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Object.assign(new Error('Administrator authentication unavailable'),{status:503});const body=await r.json();jwksCache={issuer,expires:Date.now()+600000,keys:Array.isArray(body.keys)?body.keys:[]};}
  let jwk=jwksCache.keys.find(k=>k.kid===header.kid); if(!jwk){jwksCache.expires=0;const r=await fetch(`${issuer}/cdn-cgi/access/certs`);const body=await r.json();jwksCache={issuer,expires:Date.now()+600000,keys:body.keys||[]};jwk=jwksCache.keys.find(k=>k.kid===header.kid);}
  if(!jwk)throw Object.assign(new Error('Invalid administrator session'),{status:401});
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64urlDecode(parts[2]),encoder.encode(`${parts[0]}.${parts[1]}`));
  if(!ok)throw Object.assign(new Error('Invalid administrator session'),{status:401});
  const email=safe(payload.email,254).toLowerCase(), allowed=String(env.DKF_ADMIN_EMAILS||'help@digitalkidsfoundation.org').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!email||!allowed.includes(email))throw Object.assign(new Error('Administrator access denied'),{status:403});
  return email;
}

function sameOriginWrite(request){if(!['POST','PUT','PATCH','DELETE'].includes(request.method))return true;const origin=request.headers.get('Origin');if(!origin)return false;try{return new URL(origin).host===new URL(request.url).host;}catch{return false;}}

async function laptopAdmin(request,env,path){
  const email=await adminIdentity(request,env); if(!sameOriginWrite(request))return json({error:'Invalid request origin'},403);
  if(path==='/api/laptops/admin/me'&&request.method==='GET')return json({email});
  if(path==='/api/laptops/admin/applications'&&request.method==='GET'){const r=await env.DB.prepare('SELECT * FROM laptop_applications ORDER BY created_at DESC LIMIT 300').all();return json(r.results||[]);}
  let m=path.match(/^\/api\/laptops\/admin\/applications\/(\d+)$/); if(m&&request.method==='PATCH'){const x=await parseJson(request),status=safe(x.status,40),notes=safe(x.notes,2000);if(!laptopStatuses.includes(status))return json({error:'Invalid status'},400);const old=await env.DB.prepare('SELECT id,email,reference,applicant_name,status FROM laptop_applications WHERE id=?').bind(Number(m[1])).first();if(!old)return json({error:'Not found'},404);const changed=old.status!==status,ts=nowIso();if(changed)await env.DB.prepare('UPDATE laptop_applications SET status=?,updated_at=? WHERE id=?').bind(status,ts,old.id).run();await env.DB.prepare('INSERT INTO laptop_history(application_id,status,notes,actor,created_at) VALUES(?,?,?,?,?)').bind(old.id,status,notes,email,ts).run();let emailSent=false;if(changed){try{const x=statusEmail(old,status);emailSent=(await laptopMail(env,old.email,x.subject,x.body,x.html)).ok;}catch{}}return json({ok:true,statusChanged:changed,emailSent});}
  if(path==='/api/laptops/admin/inventory'&&request.method==='GET'){const r=await env.DB.prepare('SELECT * FROM laptop_inventory ORDER BY id DESC').all();return json(r.results||[]);}
  if(path==='/api/laptops/admin/inventory'&&request.method==='POST'){const x=await parseJson(request),asset=safe(x.asset_tag,100),condition=safe(x.condition,40);if(!asset||!['pending_refurbishment','ready','retired'].includes(condition))return json({error:'Invalid inventory'},400);try{const ts=nowIso();const row=await env.DB.prepare('INSERT INTO laptop_inventory(asset_tag,brand,model,condition,notes,created_at) VALUES(?,?,?,?,?,?) RETURNING *').bind(asset,safe(x.brand,100),safe(x.model,100),condition,safe(x.notes,1000),ts).first();return json(row);}catch{return json({error:'Unable to add inventory'},409);}}
  if(path==='/api/laptops/admin/allocate'&&request.method==='POST'){const x=await parseJson(request),appId=Number(x.application_id),invId=Number(x.inventory_id);const app=await env.DB.prepare('SELECT id,quantity,status FROM laptop_applications WHERE id=?').bind(appId).first(),item=await env.DB.prepare('SELECT id,condition FROM laptop_inventory WHERE id=?').bind(invId).first();if(!app||!item||!['approved','ready_for_allocation'].includes(app.status)||item.condition!=='ready')return json({error:'Cannot allocate this device (check availability and approval)'},400);const count=await env.DB.prepare('SELECT COUNT(*) n FROM laptop_allocations WHERE application_id=?').bind(appId).first();if(Number(count.n)>=Number(app.quantity))return json({error:'Requested quantity already allocated'},400);try{await env.DB.prepare('INSERT INTO laptop_allocations(application_id,inventory_id,status,created_at) VALUES(?,?,?,?)').bind(appId,invId,'reserved',nowIso()).run();return json({ok:true});}catch{return json({error:'Cannot allocate this device (check availability and approval)'},400);}}
  if(path==='/api/laptops/admin/allocations'&&request.method==='GET'){const r=await env.DB.prepare('SELECT a.*,i.asset_tag,p.reference FROM laptop_allocations a JOIN laptop_inventory i ON i.id=a.inventory_id JOIN laptop_applications p ON p.id=a.application_id ORDER BY a.id DESC').all();return json(r.results||[]);}
  m=path.match(/^\/api\/laptops\/admin\/allocations\/(\d+)$/); if(m&&request.method==='PATCH'){const x=await parseJson(request);if(x.status!=='fulfilled')return json({error:'Invalid status'},400);const ts=nowIso(),r=await env.DB.prepare("UPDATE laptop_allocations SET status='fulfilled',fulfilled_at=? WHERE id=? AND status='reserved' RETURNING application_id").bind(ts,Number(m[1])).first();if(!r)return json({error:'Cannot fulfill allocation'},400);const counts=await env.DB.prepare("SELECT SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) done,COUNT(*) total FROM laptop_allocations WHERE application_id=?").bind(r.application_id).first();const app=await env.DB.prepare('SELECT quantity FROM laptop_applications WHERE id=?').bind(r.application_id).first();if(app&&Number(counts.done)>=Number(app.quantity)){await env.DB.batch([env.DB.prepare("UPDATE laptop_applications SET status='fulfilled',updated_at=? WHERE id=?").bind(ts,r.application_id),env.DB.prepare('INSERT INTO laptop_history(application_id,status,actor,created_at) VALUES(?,?,?,?)').bind(r.application_id,'fulfilled',email,ts)]);}return json({ok:true});}
  if(path.startsWith('/api/laptops/admin/donor-receipts'))return donorReceiptAdmin(request,env,path,email);
  return json({error:'Not found'},404);
}

let paypalTokenCache=null;
const paypalSandbox=env=>String(env.PAYPAL_MODE||'live').toLowerCase()==='sandbox';
const paypalApi=env=>paypalSandbox(env)?'https://api-m.sandbox.paypal.com':'https://api-m.paypal.com';
const paypalIpn=env=>paypalSandbox(env)?'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr':'https://ipnpb.paypal.com/cgi-bin/webscr';
const cleanTxn=v=>/^[A-Za-z0-9_-]{6,64}$/.test(safe(v,64))?safe(v,64):null;
const cleanCurrency=v=>/^[A-Z]{3}$/.test(safe(v,3).toUpperCase())?safe(v,3).toUpperCase():null;
const cleanAmount=v=>{const n=Number(v);return Number.isFinite(n)&&n>0&&n<=1000000?Math.round(n*100)/100:null;};
const paypalConfigured=env=>Boolean(env.DB&&env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET);
async function paypalAccessToken(env){if(paypalTokenCache&&paypalTokenCache.mode===paypalSandbox(env)&&paypalTokenCache.expires>Date.now()+60000)return paypalTokenCache.token;const basic=btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);const r=await fetch(`${paypalApi(env)}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)});const b=await r.json().catch(()=>({}));if(!r.ok||!b.access_token)throw Error('PayPal OAuth failed');paypalTokenCache={mode:paypalSandbox(env),token:b.access_token,expires:Date.now()+Math.max(300,Number(b.expires_in)||900)*1000};return b.access_token;}
async function findPayPalTransaction(id,amount,currency,env){const token=await paypalAccessToken(env),end=new Date(Date.now()+300000),start=new Date(Date.now()-31*86400000),u=new URL(`${paypalApi(env)}/v1/reporting/transactions`);for(const [k,v] of Object.entries({start_date:start.toISOString(),end_date:end.toISOString(),transaction_id:id,fields:'all',page_size:'100',page:'1'}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)}),b=await r.json().catch(()=>({}));if(!r.ok)throw Error('PayPal transaction verification failed');const match=(b.transaction_details||[]).find(e=>e?.transaction_info?.transaction_id===id);if(!match)return {pending:true};const info=match.transaction_info||{};if(info.transaction_status!=='S')return {pending:info.transaction_status==='P',rejected:info.transaction_status!=='P'};const a=cleanAmount(info.transaction_amount?.value),c=cleanCurrency(info.transaction_amount?.currency_code);if(!a||!c||(amount&&Math.abs(a-amount)>.01)||(currency&&c!==currency))return {rejected:true};return {verified:true,transactionId:id,amount:a,currency:c,status:'Completed',itemName:safe(info.transaction_subject||'Donation to Digital Kids Foundation',200),itemNumber:safe(info.custom_field||'dkf-general-donation',127),source:'paypal_transaction_search'};}
async function ga4Purchase(d,env){if(!env.GA4_API_SECRET)return false;const mid=env.GA4_MEASUREMENT_ID||'G-9H2PMKKH2N',u=new URL('https://www.google-analytics.com/mp/collect');u.searchParams.set('measurement_id',mid);u.searchParams.set('api_secret',env.GA4_API_SECRET);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(d.transactionId)));const dv=new DataView(digest.buffer),client=`${dv.getUint32(0)}.${dv.getUint32(4)}`;const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:client,events:[{name:'purchase',params:{transaction_id:d.transactionId,value:d.amount,currency:d.currency,engagement_time_msec:1,items:[{item_id:d.itemNumber||'dkf-general-donation',item_name:d.itemName||'Donation to Digital Kids Foundation',price:d.amount,quantity:1}]}}]}),signal:AbortSignal.timeout(12000)});return r.ok;}
async function recordPayPal(d,env){const ts=nowIso();await env.DB.prepare(`INSERT INTO dkf_paypal_donations(transaction_id,amount,currency,status,item_name,item_number,verification_source,verified_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(transaction_id) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,status=excluded.status,item_name=COALESCE(excluded.item_name,dkf_paypal_donations.item_name),item_number=COALESCE(excluded.item_number,dkf_paypal_donations.item_number),verification_source=excluded.verification_source`).bind(d.transactionId,d.amount,d.currency,d.status,d.itemName||null,d.itemNumber||null,d.source,ts).run();const row=await env.DB.prepare('SELECT * FROM dkf_paypal_donations WHERE transaction_id=?').bind(d.transactionId).first();let analyticsRecorded=Boolean(row.ga4_sent_at);if(!analyticsRecorded){analyticsRecorded=await ga4Purchase({transactionId:row.transaction_id,amount:row.amount,currency:row.currency,itemName:row.item_name,itemNumber:row.item_number},env);if(analyticsRecorded)await env.DB.prepare('UPDATE dkf_paypal_donations SET ga4_sent_at=? WHERE transaction_id=?').bind(nowIso(),row.transaction_id).run();}return {transactionId:row.transaction_id,analyticsRecorded};}
async function paypalCompletion(request,env){if(!paypalConfigured(env))return json({ok:false,verified:false,pending:true},503);if(!await rateLimit(request,env,'paypal-complete',8,600000))return json({ok:false,error:'Too many verification attempts.'},429);const x=await parseJson(request),id=cleanTxn(x.transactionId),a=cleanAmount(x.amount),c=cleanCurrency(x.currency);if(!id)return json({ok:false,error:'Invalid transaction ID.'},400);try{const v=await findPayPalTransaction(id,a,c,env);if(v.pending)return json({ok:true,verified:false,pending:true},202);if(!v.verified)return json({ok:false,verified:false},400);const r=await recordPayPal(v,env);return json({ok:true,verified:true,transactionId:v.transactionId,amount:v.amount,currency:v.currency,itemName:v.itemName||'Donation to Digital Kids Foundation',itemNumber:v.itemNumber||'dkf-general-donation',analyticsRecorded:r.analyticsRecorded});}catch(e){console.error('PayPal completion verification failed');return json({ok:false,verified:false,pending:true},502);}}
async function paypalIpnHandler(request,env){if(!env.PAYPAL_RECEIVER_EMAIL||!paypalConfigured(env))return new Response('PayPal verification is not configured.',{status:503});const raw=await request.text();if(!raw)return new Response('Invalid IPN.',{status:400});const vr=await fetch(paypalIpn(env),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`cmd=_notify-validate&${raw}`,signal:AbortSignal.timeout(12000)});if(!vr.ok||(await vr.text()).trim()!=='VERIFIED')return new Response('Invalid IPN.',{status:400});const d=Object.fromEntries(new URLSearchParams(raw));if(String(d.payment_status||'').toLowerCase()!=='completed')return new Response('',{status:200});const id=cleanTxn(d.txn_id),amount=cleanAmount(d.mc_gross),currency=cleanCurrency(d.mc_currency),receiver=safe(d.receiver_email||d.business,254).toLowerCase(),expected=safe(env.PAYPAL_RECEIVER_EMAIL,254).toLowerCase();if(!id||!amount||!currency||receiver!==expected)return new Response('IPN details did not match DKF settings.',{status:400});await recordPayPal({transactionId:id,amount,currency,status:'Completed',itemName:safe(d.item_name||'Donation to Digital Kids Foundation',200),itemNumber:safe(d.item_number||'dkf-general-donation',127),source:'paypal_ipn'},env);return new Response('',{status:200});}

const receiptTypes=new Set(['laptop','desktop','tablet','accessories','other_equipment','monetary','other']);
function validateReceipt(x){const e=[],d={donor_name:safe(x.donor_name,150),donor_email:safe(x.donor_email,254).toLowerCase(),document_type:safe(x.document_type,30)||'receipt',donation_type:safe(x.donation_type,40),donation_date:safe(x.donation_date,10),description:safe(x.description,1000),consideration_type:safe(x.consideration_type,20)||'none',consideration_description:safe(x.consideration_description,500),quantity:x.quantity===''||x.quantity==null?null:Number(x.quantity),monetary_amount:x.monetary_amount===''||x.monetary_amount==null?null:Number(x.monetary_amount),consideration_value:x.consideration_value===''||x.consideration_value==null?null:Number(x.consideration_value)};if(!d.donor_name)e.push('Donor name is required');if(!emailOK(d.donor_email))e.push('Valid donor email is required');if(!['receipt','acknowledgment_letter'].includes(d.document_type))e.push('Invalid document type');if(!receiptTypes.has(d.donation_type))e.push('Invalid donation type');if(!/^\d{4}-\d{2}-\d{2}$/.test(d.donation_date)||Number.isNaN(Date.parse(d.donation_date)))e.push('Enter a valid donation date');if(!d.description)e.push('Description is required');if(d.donation_type==='monetary'){if(!Number.isFinite(d.monetary_amount)||d.monetary_amount<=0)e.push('Valid USD amount required');d.quantity=null;}else{if(!Number.isInteger(d.quantity)||d.quantity<=0)e.push('Quantity must be a positive whole number');d.monetary_amount=null;}if(!['none','provided'].includes(d.consideration_type))e.push('Select whether goods or services were provided in return');if(d.consideration_type==='provided'&&(!d.consideration_description||!Number.isFinite(d.consideration_value)||d.consideration_value<0))e.push('Describe goods/services provided in exchange and enter their estimated USD value');if(d.consideration_type==='none'){d.consideration_description=null;d.consideration_value=null;}if(e.length)throw Object.assign(new Error(e.join('; ')),{status:400});return d;}
const receiptFields=['donor_name','donor_email','document_type','donation_type','donation_date','quantity','description','monetary_amount','consideration_type','consideration_description','consideration_value'];
function canonicalReceipt(r){return JSON.stringify(['DKF-RECEIPT-V3',r.reference,r.verification_code,r.donor_name,r.donor_email,r.document_type,r.donation_type,String(r.donation_date).slice(0,10),r.quantity==null?null:Number(r.quantity),r.description,r.monetary_amount==null?null:Number(r.monetary_amount).toFixed(2),r.consideration_type,r.consideration_description||null,r.consideration_value==null?null:Number(r.consideration_value).toFixed(2)]);}
function signingKeyBytes(env){const h=String(env.DKF_RECEIPT_SIGNING_KEY||'');if(!/^[a-f0-9]{64,}$/i.test(h)||h.length%2)return null;return Uint8Array.from(h.match(/../g),x=>parseInt(x,16));}
async function receiptSeal(r,env){const raw=signingKeyBytes(env);if(!raw)throw Object.assign(new Error('Receipt verification is not configured.'),{status:503});const key=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(canonicalReceipt(r)))));}
function money(v){return Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD'});}
function asciiPdf(v){return String(v??'').replace(/[^\x20-\x7E]/g,'?');}
function pdfEsc(v){return asciiPdf(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function pdfLine(x,y,size,font,text,color='0.12 0.19 0.17 rg'){return `BT /${font} ${size} Tf ${color} ${x} ${y} Td (${pdfEsc(text)}) Tj ET\n`;}
function wrapPdf(text,max=82){const words=asciiPdf(text).split(/\s+/),lines=[];let line='';for(const w of words){const t=line?`${line} ${w}`:w;if(t.length<=max)line=t;else{if(line)lines.push(line);line=w;}}if(line)lines.push(line);return lines;}
function buildPdf(content){const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
  `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`
];
let out='%PDF-1.4\n', offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(encoder.encode(out).length);out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
const xref=encoder.encode(out).length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offsets.length;i++)out+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return encoder.encode(out);}
async function receiptPdf(r,env,request,draft=false){
  const green='0.063 0.231 0.184 rg', gold='0.831 0.639 0.173 rg', grey='0.38 0.45 0.42 rg', black='0.12 0.19 0.17 rg';
  let c='';c+='0.063 0.231 0.184 rg 0 771 612 21 re f\n0.831 0.639 0.173 rg 0 765 612 6 re f\n';
  if(draft)c+=pdfLine(170,420,72,'F2','DRAFT','0.75 0.82 0.78 rg');
  c+=pdfLine(48,724,20,'F2','DIGITAL KIDS FOUNDATION',green);c+=pdfLine(352,728,11,'F2','Digital Kids Foundation Inc.',green);c+=pdfLine(352,711,9,'F1','Brooklyn, New York',grey);c+=pdfLine(352,696,9,'F1','digitalkidsfoundation.org',green);c+='0.87 0.91 0.88 RG 48 674 m 564 674 l S\n';
  const heading=r.document_type==='acknowledgment_letter'?'DONATION ACKNOWLEDGMENT LETTER':'DONATION RECEIPT / ACKNOWLEDGMENT';c+=pdfLine(48,646,16,'F2',heading,green);c+=pdfLine(48,626,9,'F1',draft?'DRAFT - not valid until issued':'Official contribution acknowledgment',grey);
  c+='0.95 0.98 0.96 rg 48 516 516 92 re f\n';c+=pdfLine(62,587,8,'F2','RECEIPT NUMBER',grey);c+=pdfLine(62,570,10,'F2',r.reference,black);c+=pdfLine(330,587,8,'F2','DATE RECEIVED',grey);c+=pdfLine(330,570,10,'F2',String(r.donation_date).slice(0,10),black);c+=pdfLine(62,544,8,'F2','DONOR / COMPANY',grey);c+=pdfLine(62,527,10,'F2',r.donor_name,black);c+=pdfLine(330,544,8,'F2','DONOR EMAIL',grey);c+=pdfLine(330,527,9,'F1',r.donor_email,black);
  c+=pdfLine(48,488,10,'F2','DONATION DETAILS',green);const type=String(r.donation_type||'').replaceAll('_',' '),amount=r.donation_type==='monetary'?money(r.monetary_amount):`Quantity: ${r.quantity}`;c+=pdfLine(48,468,11,'F2',`${type} - ${amount}`,black);let y=449;for(const line of wrapPdf(r.description,92).slice(0,7)){c+=pdfLine(48,y,9,'F1',line,black);y-=13;}
  c+='0.95 0.98 0.96 rg 48 230 516 104 re f\n';c+=pdfLine(61,314,9,'F2','ACKNOWLEDGMENT & TAX INFORMATION',green);const ack=r.consideration_type==='none'?'No goods or services were provided in exchange for this contribution.':`Goods/services provided in exchange: ${r.consideration_description}. Estimated value: ${money(r.consideration_value)}.`;y=294;for(const line of wrapPdf(ack,94).slice(0,4)){c+=pdfLine(61,y,9,'F1',line,black);y-=13;}if(r.donation_type!=='monetary')c+=pdfLine(61,244,8,'F1','DKF does not assign a monetary value to donated property. Donors determine value.',grey);
  const seal=draft?'NOT ISSUED':(r.verification_seal||await receiptSeal(r,env)).slice(0,16).toUpperCase();c+='0.93 0.96 0.94 rg 48 88 516 54 re f\n';c+=pdfLine(60,122,7.5,'F2','DKF DOCUMENT SEAL',green);c+=pdfLine(60,104,10,'F3',seal,draft?gold:green);const verify=`${baseUrl(env,request)}/verify-donation/${encodeURIComponent(r.reference)}?code=${encodeURIComponent(r.verification_code||'')}`;c+=pdfLine(235,122,8,'F2',draft?'PREVIEW ONLY - NOT A VALID DONATION RECEIPT':'Verify this issued document at:',green);for(const [i,line] of wrapPdf(draft?'Do not distribute or use for tax purposes.':verify,64).slice(0,2).entries())c+=pdfLine(235,105-i*11,6.7,'F1',line,grey);c+=pdfLine(48,58,7.5,'F1','Digital Kids Foundation Inc. | help@digitalkidsfoundation.org',grey);
  return buildPdf(c);
}
function toBytes(v){if(v instanceof Uint8Array)return v;if(v instanceof ArrayBuffer)return new Uint8Array(v);if(v?.buffer)return new Uint8Array(v.buffer);return new Uint8Array();}
async function receiptRowValid(r,env){if(!r||r.status!=='sent'||!r.verification_seal||!r.issued_pdf_sha256||!r.issued_pdf||!r.verification_code)return false;const seal=await receiptSeal(r,env);const pdfHash=await sha(toBytes(r.issued_pdf));return seal===r.verification_seal&&pdfHash===r.issued_pdf_sha256;}
async function donorReceiptAdmin(request,env,path,email){
  const base='/api/laptops/admin/donor-receipts';
  if(path===base&&request.method==='GET'){const r=await env.DB.prepare('SELECT id,reference,donor_name,donor_email,document_type,donation_type,donation_date,quantity,description,monetary_amount,consideration_type,consideration_description,consideration_value,status,created_by,approved_by,resend_email_id,sent_at,created_at,updated_at,verification_code,document_format_version,revoked_at,revoked_by,revoked_reason FROM dkf_donor_receipts ORDER BY id DESC LIMIT 500').all();return json(r.results||[]);}
  if(path===base&&request.method==='POST'){const d=validateReceipt(await parseJson(request)),ts=nowIso(),code=randomHex(16);const vals=receiptFields.map(k=>d[k]);const row=await env.DB.prepare(`INSERT INTO dkf_donor_receipts(${receiptFields.join(',')},created_by,verification_code,created_at,updated_at,document_format_version) VALUES(${receiptFields.map(()=>'?').join(',')},?,?,?,?,3) RETURNING id`).bind(...vals,email,code,ts,ts).first();const ref=`DKF-${d.donation_date.slice(0,4)}-${String(row.id).padStart(6,'0')}`;await env.DB.prepare('UPDATE dkf_donor_receipts SET reference=? WHERE id=?').bind(ref,row.id).run();return json(await env.DB.prepare('SELECT * FROM dkf_donor_receipts WHERE id=?').bind(row.id).first(),201);}
  let m=path.match(/^\/api\/laptops\/admin\/donor-receipts\/(\d+)$/);if(m&&request.method==='GET'){const r=await env.DB.prepare('SELECT * FROM dkf_donor_receipts WHERE id=?').bind(Number(m[1])).first();return r?json(r):json({error:'Not found'},404);}
  if(m&&request.method==='PATCH'){const d=validateReceipt(await parseJson(request)),ts=nowIso(),vals=receiptFields.map(k=>d[k]);const set=receiptFields.map(k=>`${k}=?`).join(',');const r=await env.DB.prepare(`UPDATE dkf_donor_receipts SET ${set},updated_at=? WHERE id=? AND status='draft' RETURNING *`).bind(...vals,ts,Number(m[1])).first();return r?json(r):json({error:'Only drafts may be edited'},409);}
  m=path.match(/^\/api\/laptops\/admin\/donor-receipts\/(\d+)\/pdf$/);if(m&&request.method==='GET'){const r=await env.DB.prepare('SELECT * FROM dkf_donor_receipts WHERE id=?').bind(Number(m[1])).first();if(!r)return json({error:'Not found'},404);if(!['draft','sent'].includes(r.status))return json({error:'Delivery status needs review'},409);let bytes;if(r.status==='sent'){if(!r.issued_pdf)return json({error:'Archived issued PDF is unavailable.'},409);bytes=toBytes(r.issued_pdf);}else{bytes=await receiptPdf(r,env,request,true);await env.DB.prepare('UPDATE dkf_donor_receipts SET last_previewed_at=? WHERE id=? AND status=\'draft\'').bind(nowIso(),r.id).run();}return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${r.reference}.pdf"`,'Cache-Control':'private, no-store','X-Frame-Options':'SAMEORIGIN'}});}
  m=path.match(/^\/api\/laptops\/admin\/donor-receipts\/(\d+)\/send$/);if(m&&request.method==='POST'){const x=await parseJson(request);if(x.confirmedReceived!==true||x.confirmedPreview!==true||!x.expectedUpdatedAt)return json({error:'Review the current PDF and confirm the donation was received before sending'},400);if(!signingKeyBytes(env))return json({error:'Receipt verification is not configured. Set DKF_RECEIPT_SIGNING_KEY in Cloudflare secrets.'},503);let r=await env.DB.prepare('SELECT * FROM dkf_donor_receipts WHERE id=?').bind(Number(m[1])).first();if(!r||r.status!=='draft'||String(r.updated_at)!==String(x.expectedUpdatedAt)||!r.last_previewed_at)return json({error:'Receipt was not sent: reopen the receipt, generate the PDF again, and reconfirm.'},409);const ts=nowIso();r.approved_by=email;r.document_format_version=3;r.verification_seal=await receiptSeal(r,env);const pdf=await receiptPdf(r,env,request,false),pdfSha=await sha(pdf);await env.DB.prepare("UPDATE dkf_donor_receipts SET status='sending',approved_by=?,document_format_version=3,verification_seal=?,issued_pdf_sha256=?,issued_pdf=?,updated_at=? WHERE id=? AND status='draft'").bind(email,r.verification_seal,pdfSha,pdf,ts,r.id).run();const verify=`${baseUrl(env,request)}/verify-donation/${encodeURIComponent(r.reference)}?code=${encodeURIComponent(r.verification_code)}`;const mail={from:`Digital Kids Foundation <${mailFrom(env)}>`,to:[r.donor_email],subject:`Digital Kids Foundation — ${r.document_type==='receipt'?'Donation receipt':'Donation acknowledgment'} ${r.reference}`,text:`Dear ${r.donor_name},\n\nThank you for supporting Digital Kids Foundation. Your donation acknowledgment is attached as a PDF.\n\nReceipt reference: ${r.reference}\nDonation date: ${r.donation_date}\nVerify this document: ${verify}\n\nWith gratitude,\nDigital Kids Foundation Inc.`,html:`<div style="font:16px/1.6 Arial,sans-serif;color:#163A2F"><h2>Digital Kids Foundation</h2><p>Dear ${esc(r.donor_name)},</p><p>Thank you for supporting our mission. Your donation acknowledgment is attached as a PDF.</p><p><b>Receipt reference:</b> ${esc(r.reference)}<br><b>Donation date:</b> ${esc(r.donation_date)}</p><p><a href="${esc(verify)}">Verify this document on the DKF website</a>.</p></div>`,attachments:[{filename:`${r.reference}.pdf`,content:bytesToBase64(pdf)}]};const sent=await sendMail(mail,env,`dkf-receipt/${r.id}`);if(!sent.ok){await env.DB.prepare("UPDATE dkf_donor_receipts SET status='needs_review',last_error=?,updated_at=? WHERE id=? AND status='sending'").bind('Resend delivery could not be confirmed',nowIso(),r.id).run();return json({error:'Email sending could not be confirmed. Check Resend before retrying.',status:'needs_review'},502);}await env.DB.batch([env.DB.prepare("UPDATE dkf_donor_receipts SET status='sent',sent_at=?,resend_email_id=?,updated_at=? WHERE id=?").bind(nowIso(),sent.id,nowIso(),r.id),env.DB.prepare('INSERT INTO dkf_receipt_audit(receipt_id,event,actor,detail,created_at) VALUES(?,?,?,?,?)').bind(r.id,'issued',email,sent.id,nowIso())]);return json({ok:true,reference:r.reference,recipient:r.donor_email,email_id:sent.id,status:'sent',verify_url:verify});}
  m=path.match(/^\/api\/laptops\/admin\/donor-receipts\/(\d+)\/revoke$/);if(m&&request.method==='POST'){const x=await parseJson(request),reason=safe(x.reason,500),reference=safe(x.reference,40);if(reason.length<10||!/^DKF-\d{4}-\d{6,}$/.test(reference))return json({error:'Enter the receipt number and a reason (10 or more characters).'},400);const ts=nowIso(),r=await env.DB.prepare("UPDATE dkf_donor_receipts SET revoked_at=?,revoked_by=?,revoked_reason=? WHERE id=? AND reference=? AND status='sent' AND revoked_at IS NULL RETURNING id,reference").bind(ts,email,reason,Number(m[1]),reference).first();if(!r)return json({error:'Only a matching, issued, non-revoked document can be revoked.'},409);await env.DB.prepare('INSERT INTO dkf_receipt_audit(receipt_id,event,actor,detail,created_at) VALUES(?,?,?,?,?)').bind(r.id,'revoked',email,reason,ts).run();return json({ok:true,reference:r.reference,status:'revoked'});}
  return json({error:'Not found'},404);
}

async function verifyDonation(request,env,path){const ref=decodeURIComponent(path.split('/').pop()||''),code=new URL(request.url).searchParams.get('code')||'';let status='unverified',r=null;if(/^DKF-\d{4}-\d{6,}$/.test(ref)&&/^[a-f0-9]{32}$/.test(code)){r=await env.DB.prepare('SELECT * FROM dkf_donor_receipts WHERE reference=? AND verification_code=?').bind(ref,code).first();if(r&&await receiptRowValid(r,env))status=r.revoked_at?'revoked':'valid';}const states={valid:['Verified DKF document','valid','This document was issued by Digital Kids Foundation Inc. Compare the details below with the PDF.'],revoked:['Receipt revoked','revoked','This receipt was revoked. Do not rely on this copy; contact DKF for clarification.'],unverified:['Not verified','invalid','This document could not be verified.']},[title,state,desc]=states[status],details=status==='valid'?`<dl><dt>Receipt number</dt><dd>${esc(r.reference)}</dd><dt>Document seal ID</dt><dd><code>${esc(r.verification_seal.slice(0,16).toUpperCase())}</code></dd><dt>Donor / company</dt><dd>${esc(r.donor_name)}</dd><dt>Document type</dt><dd>${r.document_type==='receipt'?'Donation receipt':'Acknowledgment letter'}</dd><dt>Donation date</dt><dd>${esc(r.donation_date)}</dd><dt>Donation</dt><dd>${esc(r.donation_type.replaceAll('_',' '))}</dd><dt>Quantity / amount</dt><dd>${esc(r.donation_type==='monetary'?money(r.monetary_amount):String(r.quantity))}</dd><dt>Description</dt><dd>${esc(r.description)}</dd></dl><section><h2>Check whether the PDF was changed</h2><p>Select the PDF saved on your device. The check runs in your browser.</p><input id="localPdf" type="file" accept="application/pdf,.pdf"><p id="pdfCheckResult">No PDF selected.</p></section>`:'';const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${title} | Digital Kids Foundation</title><style>body{font:16px/1.55 system-ui,sans-serif;background:#f4f8f5;color:#183b34;margin:0;padding:24px}.container{max-width:680px;margin:28px auto;background:white;border:1px solid #d9e5dd;border-radius:16px;overflow:hidden}.head{background:#103b2f;color:white;padding:26px 32px;border-bottom:5px solid #d4a32c}main{padding:26px 32px}.status{font-weight:800;font-size:23px}.valid{color:#186947}.revoked,.invalid{color:#a23e25}dl{display:grid;grid-template-columns:1fr 1.6fr;gap:12px 16px;padding:20px;background:#f4f8f5;border-radius:10px}dt{color:#60726b}dd{margin:0;font-weight:650}</style></head><body><div class="container"><div class="head"><h1>Digital Kids Foundation Inc.</h1><div>Official donation document verification</div></div><main><div class="status ${state}">${title}</div><p>${desc}</p>${details}<p>Questions? <a href="mailto:help@digitalkidsfoundation.org">Contact DKF</a>.</p></main></div>${status==='valid'?`<div id="pdfExpectedSha" data-sha256="${esc(r.issued_pdf_sha256)}" hidden></div><script src="/verify-donation.js" defer></script>`:''}</body></html>`;return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});}

function mobileTurnstile(env){const key=env.TURNSTILE_SITE_KEY||'';return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;background:white;font:14px system-ui;color:#103b2f}#widget{min-height:70px}</style></head><body><div id="widget"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script><script>function send(type,token){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type,token}))}function mount(){if(!window.turnstile){setTimeout(mount,100);return}window.turnstile.render('#widget',{sitekey:${JSON.stringify(key)},callback:t=>send('turnstile',t),'expired-callback':()=>send('expired',''),'error-callback':()=>send('error','')})}mount()</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src 'self' blob: https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src data: https://challenges.cloudflare.com"}});}

async function route(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/health'||path==='/api/health')return json({ok:true,service:'dkf-backup',version:'3.0.0',database:Boolean(env.DB)});
  if(path==='/api/verification-config')return json({enabled:false,directSubmission:true});
  if(path==='/api/turnstile-config')return json({enabled:Boolean(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY),siteKey:env.TURNSTILE_SITE_KEY||null});
  if(path==='/api/submit'&&request.method==='POST')return submitPublic(request,env);
  if(path==='/api/laptops/config'&&request.method==='GET')return json({enabled:laptopReady(env),siteKey:env.TURNSTILE_SITE_KEY||null});
  if(path==='/api/laptops/apply'&&request.method==='POST')return laptopApply(request,env);
  if(path==='/laptop-verify'&&request.method==='GET')return laptopVerify(request,env);
  if(path==='/api/laptops/status-request'&&request.method==='POST')return laptopStatusRequest(request,env);
  if(path==='/laptop-status-verify'&&request.method==='GET')return laptopStatusVerify(request,env);
  if(path.startsWith('/api/laptops/admin/'))return laptopAdmin(request,env,path);
  if(path==='/api/paypal/config'&&request.method==='GET')return json({serverVerificationEnabled:paypalConfigured(env),analyticsPurchaseEnabled:Boolean(paypalConfigured(env)&&env.GA4_API_SECRET),mode:paypalSandbox(env)?'sandbox':'live'});
  if(path==='/api/paypal/donation-complete'&&request.method==='POST')return paypalCompletion(request,env);
  if(path==='/api/paypal/ipn'&&request.method==='POST')return paypalIpnHandler(request,env);
  if(path.startsWith('/verify-donation/')&&request.method==='GET')return verifyDonation(request,env,path);
  if(path==='/mobile-turnstile'&&request.method==='GET')return mobileTurnstile(env);
  if(path==='/verify-email')return new Response(laptopVerifiedPage('Verification no longer required','<p>Public DKF inquiry forms now submit directly after security verification. Please return to the website.</p>'),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  if(path==='/robots.txt'&&isBackupHost(request))return new Response('User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  if(['/home','/home/'].includes(path))return Response.redirect(`${url.origin}/`,301);
  if(['/about-us','/about-us/'].includes(path))return Response.redirect(`${url.origin}/#about`,301);
  if(['/faq','/faq/'].includes(path))return Response.redirect(`${url.origin}/#faq`,301);
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request,env){try{return withSecurity(await route(request,env),request);}catch(e){console.error('DKF Worker error',new URL(request.url).pathname,e?.message||e);const status=Number(e?.status)||500;return withSecurity(new URL(request.url).pathname.startsWith('/api/')?json({error:status<500?e.message:'Service temporarily unavailable.'},status):new Response('Service temporarily unavailable.',{status}),request);}},
  async scheduled(_event,env){const now=Date.now();try{await env.DB.batch([env.DB.prepare('DELETE FROM submission_rate_limits WHERE window_start < ?').bind(Math.floor((now-2*86400000)/600000)),env.DB.prepare('DELETE FROM laptop_tokens WHERE expires_at < ?').bind(now-7*86400000)]);}catch(e){console.error('DKF scheduled cleanup failed');}}
};
