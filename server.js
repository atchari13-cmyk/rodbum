// ตัวเชื่อม TikTok LIVE -> เกม (เวอร์ชันฝากออนไลน์)
// ใส่ชื่อ TikTok ผ่านลิงก์ได้เลย เช่น  https://เว็บของคุณ/?user=mychannel
// ดูสถานะแบบไม่ต้องเปิด Logs:  https://เว็บของคุณ/status
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const lib = require('tiktok-live-connector');
const Conn = lib.WebcastPushConnection || lib.TikTokLiveConnection;

const PORT = process.env.PORT || 3000;
let conn = null, connected = false, username = '', gen = 0, retry = null, sumTimer = null;
let lastErr = '', cnt = {};

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/health')) { res.writeHead(200); return res.end('ok'); }
  if (req.url.startsWith('/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ user: username, connected, lastError: lastErr, gameClients: wss.clients.size, eventsReceived: cnt }, null, 2));
  }
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
const status = () => send({ type: 'status', ok: connected, user: username, err: lastErr });

wss.on('connection', (ws) => {
  console.log('🔌 หน้าเกมเชื่อมเข้ามา (ตอนนี้ ' + wss.clients.size + ' หน้า)');
  ws.send(JSON.stringify({ type: 'status', ok: connected, user: username, err: lastErr }));
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type !== 'setUser') return;
      const u = String(m.user || '').replace('@', '').trim();
      if (!/^[A-Za-z0-9._]{1,40}$/.test(u)) { console.log('ชื่อไม่ถูกรูปแบบ:', u); return; }
      console.log('📨 หน้าเกมขอเชื่อมกับ @' + u);
      if (u !== username || !conn) start(u);
    } catch (_) {}
  });
});

server.listen(PORT, '0.0.0.0', () => console.log('🎪 เกมพร้อมแล้วที่พอร์ต ' + PORT));

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('หมดเวลารอ TikTok ' + ms / 1000 + ' วินาที')), ms)),
]);

function start(user) {
  const my = ++gen;
  clearTimeout(retry);
  clearInterval(sumTimer);
  if (conn) { try { conn.disconnect(); } catch (_) {} }
  username = user; connected = false; cnt = {}; status();
  console.log('▶️ เริ่มเชื่อมกับ @' + username);
  try { conn = new Conn(username); }
  catch (e) { lastErr = 'สร้างการเชื่อมต่อไม่ได้: ' + ((e && e.message) || e); console.error(lastErr); status(); return; }

  // รองรับทั้งไลบรารีเวอร์ชันเก่า (ข้อมูลแบน) และเวอร์ชันใหม่ (ข้อมูลซ้อนใน d.user)
  const who = (d) => {
    const u = d.user || d;
    const pic = u.profilePictureUrl || (u.profilePicture && (u.profilePicture.url || (u.profilePicture.urls && u.profilePicture.urls[0]))) || '';
    return {
      id: String(u.uniqueId || u.userId || d.uniqueId || d.userId || 'unknown'),
      name: u.nickname || u.uniqueId || d.nickname || d.uniqueId || 'ไม่ระบุชื่อ',
      avatar: typeof pic === 'string' ? pic : '',
    };
  };
  const seen = (t, d) => {
    cnt[t] = (cnt[t] || 0) + 1;
    if (cnt[t] <= 3) console.log('📩 ได้รับ ' + t + ' จาก ' + who(d).name);
  };
  sumTimer = setInterval(() => {
    if (my !== gen) return;
    console.log('📊 เหตุการณ์ที่ได้รับ:', JSON.stringify(cnt), '| เชื่อมต่อ TikTok:', connected);
  }, 20000);

  conn.on('chat', (d) => { seen('chat', d); send({ type: 'chat', ...who(d), text: d.comment || '' }); });
  conn.on('like', (d) => { seen('like', d); send({ type: 'like', ...who(d), n: d.likeCount || 1 }); });
  conn.on('follow', (d) => { seen('follow', d); send({ type: 'follow', ...who(d) }); });
  conn.on('share', (d) => { seen('share', d); send({ type: 'share', ...who(d) }); });
  conn.on('member', (d) => { seen('member', d); send({ type: 'member', ...who(d) }); });
  conn.on('gift', (d) => {
    seen('gift', d);
    const gd = d.giftDetails || {};
    const gtype = d.giftType !== undefined ? d.giftType : gd.giftType;
    if (gtype === 1 && !d.repeatEnd) return;
    const n = d.repeatCount || 1;
    const dia = d.diamondCount || gd.diamondCount || 1;
    send({ type: 'gift', ...who(d), gift: d.giftName || gd.giftName || 'ของขวัญ', n, diamonds: dia * n });
  });
  conn.on('disconnected', () => {
    if (my !== gen) return;
    connected = false; lastErr = 'หลุดการเชื่อมต่อจาก TikTok'; status();
    console.log('หลุดการเชื่อมต่อ ลองใหม่ใน 5 วินาที');
    retry = setTimeout(() => start(username), 5000);
  });

  withTimeout(conn.connect(), 25000)
    .then(() => {
      if (my !== gen) return;
      connected = true; lastErr = ''; status();
      console.log('✅ เชื่อมกับ @' + username + ' สำเร็จ');
    })
    .catch((err) => {
      if (my !== gen) return;
      lastErr = String((err && err.message) || err).slice(0, 160);
      console.error('❌ เชื่อมไม่ได้:', lastErr);
      status();
      retry = setTimeout(() => start(username), 8000);
    });
}

if (process.env.TIKTOK_USER) start(process.env.TIKTOK_USER.replace('@', '').trim());
