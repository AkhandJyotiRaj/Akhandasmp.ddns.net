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
let onlinePlayers = new Set(); // Real-time players track karo
let maxPlayers = 100;

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

function broadcastPlayers() {
  broadcast({ type: 'players', players: [...onlinePlayers], max: maxPlayers });
}

// Website se Minecraft mein message bhejo
async function sendToMinecraft(player, message) {
  try {
    const rcon = new Rcon({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASSWORD });
    await rcon.connect();
    await rcon.send(`tellraw @a ["",{"text":"[Web] ","color":"gold","bold":true},{"text":"${player}","color":"yellow"},{"text":" » ","color":"gray"},{"text":"${message}","color":"white"}]`);
    await rcon.end();
    return true;
  } catch (e) {
    console.log('RCON send error:', e.message);
    return false;
  }
}

// Startup pe ek baar RCON se players + max load karo
async function initPlayers() {
  try {
    const rcon = new Rcon({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASSWORD });
    await rcon.connect();
    const res = await rcon.send('list');
    await rcon.end();

    const countMatch = res.match(/There are (\d+) of a max(?: of)? (\d+)/);
    if (countMatch) maxPlayers = parseInt(countMatch[2]);

    const colonIdx = res.indexOf(':');
    const afterColon = colonIdx !== -1 ? res.slice(colonIdx + 1).trim() : '';
    if (afterColon) {
      afterColon.split(',').map(p => p.trim()).filter(Boolean).forEach(p => onlinePlayers.add(p));
    }

    broadcastPlayers();
    console.log(`Players loaded: [${[...onlinePlayers]}] | Max: ${maxPlayers}`);
  } catch (e) {
    console.log('Init RCON error:', e.message);
  }
}

wss.on('connection', (ws) => {
  // Naye user ko pehle history bhejo
  chatHistory.forEach(item => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(item));
  });

  // Current players turant bhejo
  ws.send(JSON.stringify({ type: 'players', players: [...onlinePlayers], max: maxPlayers }));

  // Website se aane wale messages suno
  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'webchat' && data.player && data.message) {
        const player = data.player.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
        const message = data.message.replace(/"/g, "'").replace(/\\/g, '').slice(0, 100);

        if (!player || !message) return;

        const ok = await sendToMinecraft(player, message);
        if (ok) {
          const msg = {
            type: 'chat',
            player: player,
            message: message,
            source: 'web',
            time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          };
          saveToHistory(msg);
          broadcast(msg);
        }
      }
    } catch (e) {
      console.log('WS message error:', e.message);
    }
  });
});

// Log file se real-time track karo
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

      // Chat message
      const chat = line.match(/\[.*?INFO\].*?<(\w+)>\s(.+)/);
      if (chat) {
        const msg = {
          type: 'chat',
          player: chat[1],
          message: chat[2],
          source: 'game',
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        };
        saveToHistory(msg);
        broadcast(msg);
      }

      // Join — turant add karo
      const join = line.match(/\[.*?INFO\].*?(\w+) joined the game/);
      if (join) {
        onlinePlayers.add(join[1]);
        const msg = {
          type: 'join',
          player: join[1],
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        };
        saveToHistory(msg);
        broadcast(msg);
        broadcastPlayers(); // turant update
      }

      // Leave — turant remove karo
      const leave = line.match(/\[.*?INFO\].*?(\w+) left the game/);
      if (leave) {
        onlinePlayers.delete(leave[1]);
        const msg = {
          type: 'leave',
          player: leave[1],
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        };
        saveToHistory(msg);
        broadcast(msg);
        broadcastPlayers(); // turant update
      }

    });
  });
});

// Startup pe ek baar players load karo — phir RCON band
initPlayers();
