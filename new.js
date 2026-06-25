const WebSocket = require('ws');
const { Rcon } = require('rcon-client');
const fs = require('fs');

const MC_LOG_PATH = '/home/ubuntu/akhand/logs/latest.log';
const RCON_HOST = 'localhost';
const RCON_PORT = 25575;
const RCON_PASSWORD = 'akhand';
const WS_PORT = 8080;

const wss = new WebSocket.Server({ port: WS_PORT });
console.log('WebSocket server started on port ' + WS_PORT);

const chatHistory = [];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function saveToHistory(data) {
  chatHistory.push(data);
  if (chatHistory.length > 50) chatHistory.shift();
}

wss.on('connection', (ws) => {
  // Naye user ko history bhejo
  chatHistory.forEach(item => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(item));
  });
});

let fileSize = fs.statSync(MC_LOG_PATH).size;

fs.watch(MC_LOG_PATH, () => {
  const newSize = fs.statSync(MC_LOG_PATH).size;
  if (newSize <= fileSize) return;
  const stream = fs.createReadStream(MC_LOG_PATH, { start: fileSize, end: newSize });
  let data = '';
  stream.on('data', chunk => data += chunk);
  stream.on('end', () => {
    fileSize = newSize;
    data.split('\n').filter(Boolean).forEach(line => {
      const chat = line.match(/\[.*?INFO\].*?<(\w+)>\s(.+)/);
      if (chat) {
        const msg = { type: 'chat', player: chat[1], message: chat[2],
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
        saveToHistory(msg);
        broadcast(msg);
      }
      const join = line.match(/\[.*?INFO\].*?(\w+) joined the game/);
      if (join) {
        const msg = { type: 'join', player: join[1] };
        saveToHistory(msg);
        broadcast(msg);
      }
      const leave = line.match(/\[.*?INFO\].*?(\w+) left the game/);
      if (leave) {
        const msg = { type: 'leave', player: leave[1] };
        saveToHistory(msg);
        broadcast(msg);
      }
    });
  });
});

async function fetchPlayers() {
  try {
    const rcon = new Rcon({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASSWORD });
    await rcon.connect();
    const res = await rcon.send('list');
    await rcon.end();

    const countMatch = res.match(/There are (\d+) of a max(?: of)? (\d+)/);
    const max = countMatch ? parseInt(countMatch[2]) : 100;

    const colonIdx = res.indexOf(':');
    const afterColon = colonIdx !== -1 ? res.slice(colonIdx + 1).trim() : '';
    const players = afterColon.length > 0 ? afterColon.split(',').map(p => p.trim()).filter(Boolean) : [];

    broadcast({ type: 'players', players, max });
  } catch(e) {
    console.log('RCON error:', e.message);
  }
}

setInterval(fetchPlayers, 5000);
fetchPlayers();
