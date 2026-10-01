const ALLOWED_GET=new Set(['setup','session','state','history','candles']);
const ALLOWED_POST=new Set(['login','connect','risk','sl-preview','order','admin','close','cancel','logout','password_change','password_recover','admin_password']);
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const fail=(status,error)=>res.status(status).json({error});
  if(!['GET','POST'].includes(req.method))return fail(405,'Method not allowed.');
  const name=typeof req.query.endpoint==='string'?req.query.endpoint:'';
  if(!(req.method==='GET'?ALLOWED_GET:ALLOWED_POST).has(name))return fail(404,'Unknown TradeLock operation.');
  const secret=process.env.TRADELOCK_BRIDGE_SECRET||'';
  let origin;
  try{origin=new URL(process.env.TRADELOCK_ENGINE_URL||'');if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error();}catch{return fail(503,'Windows connector is not configured. Set TRADELOCK_ENGINE_URL to your HTTPS tunnel origin in Vercel and redeploy.');}
  if(secret.length<32)return fail(503,'Set TRADELOCK_BRIDGE_SECRET in Vercel and redeploy.');
  if(req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON request required.');
    if(req.headers.origin!==`https://${req.headers.host}`)return fail(403,'Request must come from this TradeLock website.');
  }
  const target=new URL('/api/'+name,origin);
  if(name==='candles')for(const key of ['symbol','tf'])if(typeof req.query[key]==='string')target.searchParams.set(key,req.query[key]);
  const headers={'X-TradeLock-Bridge':secret,'Origin':'http://127.0.0.1:8000'};
  if(req.headers.cookie)headers.Cookie=req.headers.cookie;
  if(req.headers['x-csrf-token'])headers['X-CSRF-Token']=req.headers['x-csrf-token'];
  let body;
  if(req.method==='POST'){
    try{body=typeof req.body==='string'?req.body:JSON.stringify(req.body);JSON.parse(body);if(Buffer.byteLength(body)>100000)return fail(413,'Request is too large.');}catch{return fail(400,'Invalid JSON request.');}
    headers['Content-Type']='application/json';
  }
  try{
    // Never retry a trading request: a timeout may still mean the broker accepted it.
    const upstream=await fetch(target,{method:req.method,headers,body,redirect:'error',signal:AbortSignal.timeout(20000)});
    const data=await upstream.text();
    if(!upstream.headers.get('content-type')?.includes('application/json'))return fail(502,'Windows tunnel did not return TradeLock data. Check that its service is http://127.0.0.1:8001.');
    let result;try{result=JSON.parse(data)}catch{return fail(502,'Invalid response from Windows connector.');}
    if(upstream.status===403&&result.error==='Remote connector authentication failed.')return fail(502,'Connector keys do not match. Use the same TRADELOCK_BRIDGE_SECRET on Windows and Vercel.');
    const cookies=upstream.headers.getSetCookie?upstream.headers.getSetCookie():[upstream.headers.get('set-cookie')].filter(Boolean);
    if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>c.replace(/;\s*Secure/gi,'')+'; Secure'));
    return res.status(upstream.status).json(result);
  }catch{return fail(502,'Windows connector is unavailable or timed out. Keep your PC, MT5, engine and tunnel running. If this was an order, check positions/history before submitting a new order.');}
};
