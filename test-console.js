const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/public/index.html' : req.url;
  const filePath = path.join(__dirname, file.split('?')[0]);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mime = ext === '.html' ? 'text/html' : (ext === '.js' ? 'application/javascript' : 'text/plain');
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3334, () => {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const proc = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    'http://localhost:3334'
  ]);

  setTimeout(async () => {
    try {
      const httpGet = (url) => new Promise((resolve, reject) => {
        http.get(url, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
      });

      const targets = await httpGet('http://localhost:9222/json');
      console.log('Targets:', targets.map(t => ({ title: t.title, url: t.url })));

      const WebSocket = require('ws'); // might not be installed, check if available
    } catch(e) {
      console.log('CDP inspect error:', e.message);
    } finally {
      proc.kill();
      server.close();
    }
  }, 3000);
});

