/* ============================================================
 *  server.js —— 零依赖本地服务器
 *  1. 静态托管本目录（http://localhost:8000）
 *  2. POST /api/proxy 转发 AI 接口请求，规避浏览器 CORS 限制
 *     请求体：{url, headers, body}（body 为对象，会被 JSON 序列化转发）
 *  运行：node server.js  （可选 PORT=9000 node server.js）
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.jfif':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff':'font/woff',
};

http.createServer(async (req, res) => {
  // CORS 代理
  if (req.method === 'POST' && req.url === '/api/proxy') {
    let raw = '';
    req.on('data', ch => { raw += ch; if (raw.length > 30 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const {url, headers, body} = JSON.parse(raw);
        if (!/^https?:\/\//.test(url || '')) throw new Error('invalid url');
        const r = await fetch(url, {
          method: 'POST',
          headers: Object.assign({'Content-Type': 'application/json'}, headers || {}),
          body: JSON.stringify(body),
        });
        res.writeHead(r.status, {'Content-Type': r.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin': '*'});
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (err) {
        res.writeHead(502, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: String(err && err.message || err)}));
      }
    });
    return;
  }
  // 静态文件
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('404 Not Found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`静态站点 + AI 代理已启动:`);
  console.log(`  首页(原工具)   http://localhost:${PORT}/`);
  console.log(`  AI 生成器      http://localhost:${PORT}/app.html`);
  console.log(`  示例方案       http://localhost:${PORT}/design.html`);
});
