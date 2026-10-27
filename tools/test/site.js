// Netlify 화면 로컬 테스트: dist 정적 파일 + /exec (구글 스크립트 흉내)
const http = require('http'), fs = require('fs'), path = require('path');
const { makeEnv, seed } = require('./mock');
const env = makeEnv({ now: new Date((process.env.NOW || '2026-10-21T10:15:00') + '+09:00') });
seed(env, require('../data.json'));
env.__sheets['지점'].getRange(2, 6, 2, 1).setValues([['없음'], ['적용']]);
const dist = path.join(__dirname, '..', process.env.DIST || 'dist-test');
const DELAY = +(process.env.DELAY || 0);
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/exec') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => setTimeout(() => {
      let out;
      try {
        const b = req.method === 'POST' ? JSON.parse(body) : { action: u.searchParams.get('api') };
        if (b.action === 'ping') out = { result: 'ok' };
        else out = { result: env.API_FUNCS_[b.fn].apply(null, b.args || []) };
      } catch (e) { out = { error: e.message }; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
    }, DELAY));
    return;
  }
  let f = path.join(dist, decodeURIComponent(u.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('content-type', f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
  res.end(fs.readFileSync(f));
}).listen(8790, () => console.log('site on 8790'));
