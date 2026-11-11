// ตัวเชื่อม TikTok LIVE -> เกมรถบั้ม (เวอร์ชันฝากออนไลน์)
// ใส่ชื่อ TikTok ผ่านลิงก์ได้เลย เช่น  https://เว็บของคุณ/?user=mychannel
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const lib = require('tiktok-live-connector');
const Conn = lib.WebcastPushConnection || lib.TikTokLiveConnection;

const PORT = process.env.PORT || 3000;
let conn = null, connected = false, username = '', gen = 0, retry = null;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/health')) { res.writeHead(200); return res.end('ok'); }
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('ไม่พบไฟล์ index.html'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });
const send = (o) => {
  const s = JSON.stringify(o);
  wss.clients.forEach((c) => c.readyState === 1 && c.send(s));
};
const status = () => send({ type: 'status', ok: connected, user: username });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', ok: connected, user: username }));
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type !== 'setUser') return;
      const u = String(m.user || '').replace('@', '').trim();
      if (!/^[A-Za-z0-9._]{1,40}$/.test(u)) return;
      if (u !== username || !conn) start(u);
    } catch (_) {}
  });
});

server.listen(PORT, '0.0.0.0', () => console.log('🎪 เกมพร้อมแล้วที่พอร์ต ' + PORT));

function start(user) {
  const my = ++gen;
  clearTimeout(retry);
  if (conn) { try { conn.disconnect(); } catch (_) {} }
  username = user; connected = false; status();
  conn = new Conn(username);
  const who = (d) => ({
    id: String(d.uniqueId || d.userId || 'unknown'),
    name: d.nickname || d.uniqueId || 'ไม่ระบุชื่อ',
    avatar: typeof d.profilePictureUrl === 'string' ? d.profilePictureUrl : '',
  });
  conn.on('chat', (d) => send({ type: 'chat', ...who(d), text: d.comment || '' }));
  conn.on('like', (d) => send({ type: 'like', ...who(d), n: d.likeCount || 1 }));
  conn.on('follow', (d) => send({ type: 'follow', ...who(d) }));
  conn.on('share', (d) => send({ type: 'share', ...who(d) }));
  conn.on('member', (d) => send({ type: 'member', ...who(d) }));
  conn.on('gift', (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return;
    const n = d.repeatCount || 1;
    send({ type: 'gift', ...who(d), gift: d.giftName || 'ของขวัญ', n, diamonds: (d.diamondCount || 1) * n });
  });
  conn.on('disconnected', () => {
    if (my !== gen) return;
    connected = false; status();
    console.log('หลุดการเชื่อมต่อ ลองใหม่ใน 5 วินาที');
    retry = setTimeout(connect, 5000);
  });
  function connect() {
    if (my !== gen) return;
    conn.connect()
      .then(() => { if (my !== gen) return; connected = true; status(); console.log('✅ เชื่อมกับ @' + username); })
      .catch((err) => {
        console.error('❌ เชื่อมไม่ได้:', (err && err.message) || err);
        if (my === gen) retry = setTimeout(connect, 8000);
      });
  }
  connect();
}

if (process.env.TIKTOK_USER) start(process.env.TIKTOK_USER.replace('@', '').trim());
