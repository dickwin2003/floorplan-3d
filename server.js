/* ============================================================
 *  server.js —— 零依赖本地服务器
 *  1. 静态托管本目录（http://localhost:8000）
 *  2. POST /api/chat  —— 服务端 Key 模式：从 .env 读取 LLM_API_KEY，
 *     注入 Authorization 后转发 {LLM_BASE_URL}/chat/completions，
 *     浏览器端无需配置任何 Key
 *  3. POST /api/proxy —— 通用转发（调试用，默认关闭，见 ALLOW_OPEN_PROXY）
 *  4. GET  /api/env   —— 返回服务端 Key 是否已配置（不含 Key 本身）
 *
 *  .env（已被 .gitignore 排除，不会提交）：
 *    LLM_API_KEY=你的智谱APIKey
 *    LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
 *    LLM_MODEL=glm-4.5v
 *    PORT=8000
 *  运行：node server.js
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/* ---------- 读取 .env（零依赖，不覆盖已有环境变量） ---------- */
function loadEnv(file = path.join(ROOT, '.env')){
  try{
    for(const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)){
      if(/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if(!m) continue;
      let v = m[2].trim();
      if((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if(!(m[1] in process.env)) process.env[m[1]] = v;
    }
  }catch{} // 没有 .env 也能跑（浏览器端填 Key 模式）
}
loadEnv();

const PLACEHOLDER = /^(|你的智谱apikey|your[_-]?api[_-]?key|sk-xxx+)$/i;
const LLM_KEY   = PLACEHOLDER.test(process.env.LLM_API_KEY || '') ? '' : (process.env.LLM_API_KEY || '').trim();
const LLM_BASE  = (process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'glm-4.5v';
const OPEN_PROXY = process.env.ALLOW_OPEN_PROXY === '1';
const PORT = Number(process.env.PORT) || 8000;

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.jfif':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff':'font/woff', '.md':'text/markdown; charset=utf-8',
};

function json(res, status, obj){
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 30 * 1024 * 1024){
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', ch => { raw += ch; if(raw.length > limit) req.destroy(); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const route = req.url.split('?')[0];

  /* 服务端 Key 模式：浏览器只发 messages，Key 由服务器注入 */
  if(req.method === 'POST' && route === '/api/chat'){
    if(!LLM_KEY) return json(res, 500, {error:{message:'服务端未配置 LLM_API_KEY：请在项目目录创建 .env（参考 .env.example），或改在页面里填写 Key'}});
    try{
      const body = JSON.parse(await readBody(req));
      const payload = {model: LLM_MODEL, temperature: .1, max_tokens: 8000, ...body};
      const r = await fetch(LLM_BASE + '/chat/completions', {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + LLM_KEY},
        body: JSON.stringify(payload),
      });
      res.writeHead(r.status, {'Content-Type': r.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin':'*'});
      res.end(Buffer.from(await r.arrayBuffer()));
    }catch(err){
      json(res, 502, {error:{message:'转发失败：' + (err && err.message || err)}});
    }
    return;
  }

  /* 通用转发（默认关闭，避免公网部署时被当成开放代理） */
  if(req.method === 'POST' && route === '/api/proxy'){
    if(!OPEN_PROXY) return json(res, 403, {error:{message:'通用代理已关闭（公网安全）。服务端 Key 模式请用 /api/chat；确需开放请在 .env 设 ALLOW_OPEN_PROXY=1'}});
    try{
      const {url, headers, body} = JSON.parse(await readBody(req));
      if(!/^https?:\/\//.test(url || '')) throw new Error('invalid url');
      const r = await fetch(url, {
        method: 'POST',
        headers: Object.assign({'Content-Type':'application/json'}, headers || {}),
        body: JSON.stringify(body),
      });
      res.writeHead(r.status, {'Content-Type': r.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin':'*'});
      res.end(Buffer.from(await r.arrayBuffer()));
    }catch(err){
      json(res, 502, {error:{message:String(err && err.message || err)}});
    }
    return;
  }

  /* 告诉前端服务端是否已配 Key（绝不返回 Key 本身） */
  if(req.method === 'GET' && route === '/api/env'){
    return json(res, 200, {serverKey: !!LLM_KEY, baseUrl: LLM_BASE, model: LLM_MODEL, openProxy: OPEN_PROXY});
  }

  /* 静态文件 */
  let p = decodeURIComponent(route);
  if(p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if(!file.startsWith(ROOT)){ res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if(err){ res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('404 Not Found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('静态站点 + AI 服务已启动:');
  console.log(`  AI 生成器      http://localhost:${PORT}/app.html`);
  console.log(`  示例方案       http://localhost:${PORT}/design.html`);
  console.log(`  首页(原工具)   http://localhost:${PORT}/`);
  console.log(LLM_KEY
    ? `  Key 模式       服务端 .env 已配置（${LLM_MODEL} @ ${LLM_BASE}），浏览器无需填 Key`
    : '  Key 模式       服务端未配置 .env，请在 app.html 页面里填 Key（或参考 .env.example 创建 .env）');
});
