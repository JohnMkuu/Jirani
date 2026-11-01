const { exec } = require('child_process');
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

server.listen(3333, () => {
  console.log('Test server on 3333');
  const edgePath = '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"';
  exec(`${edgePath} --headless=new --dump-dom --virtual-time-budget=4000 http://localhost:3333`, (err, stdout, stderr) => {
    console.log('DOM dump length:', stdout ? stdout.length : 0);
    if (stderr) console.log('Stderr:', stderr.slice(0, 500));
    server.close();
  });
});

