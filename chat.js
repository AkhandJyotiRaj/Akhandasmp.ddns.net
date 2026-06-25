const WebSocket = require('ws');
const { Rcon } = require('rcon-client');
const fs = require('fs');

const MC_LOG_PATH = '/home/ubuntu/akhand/logs/latest.log';
const RCON_HOST = 'localhost';
const RCON_PORT = 25575;
const RCON_PASSWORD = 'akhand';
const WS_PORT = 8080;

const wss = new WebSocket.Server({ port: WS_PORT });

const chatHistory = [];
const recentJoins = new Map();
const cooldowns = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function saveToHistory(data) {
  chatHistory.push(data);

  if (chatHistory.length > 80) {
    chatHistory.shift();
  }
}

function backendLog(message) {

  console.log('[BACKEND]', message);

  broadcast({
    type: 'backend',
    message,
    time: new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  });

}

backendLog(`WebSocket server started on port ${WS_PORT}`);

wss.on('connection', (ws) => {

  backendLog(
    `Client connected | Total=${wss.clients.size}`
  );

  chatHistory.forEach(item => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(item));
    }
  });

  // WEBSITE → MINECRAFT CHAT
  ws.on('message', async (raw) => {

    try {

      const data = JSON.parse(raw);

      if (data.type !== 'webchat') return;

      const username =
        String(data.username || '').trim();

      const message =
        String(data.message || '').trim();

      if (!username || !message) return;

      if (username.length > 16) return;
      if (message.length > 120) return;

      // Anti Spam
      const last =
        cooldowns.get(username) || 0;

      if (Date.now() - last < 5000) {
        return;
      }

      cooldowns.set(
        username,
        Date.now()
      );

      backendLog(
        `WEBCHAT ${username}: ${message}`
      );

      const rcon = new Rcon({
        host: RCON_HOST,
        port: RCON_PORT,
        password: RCON_PASSWORD
      });

      await rcon.connect();

      await rcon.send(
        `tellraw @a {"text":"🌐 ${username}: ${message}","color":"aqua"}`
      );

      await rcon.end();

      const msg = {
        type: 'chat',
        player: `🌐 ${username}`,
        message,
        time: new Date().toLocaleTimeString(
          'en-IN',
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        )
      };

      saveToHistory(msg);
      broadcast(msg);

    } catch (err) {

      backendLog(
        `WEBCHAT ERROR: ${err.message}`
      );

    }

  });

  ws.on('close', () => {

    backendLog(
      `Client disconnected | Total=${wss.clients.size}`
    );

  });

});

let fileSize =
  fs.statSync(MC_LOG_PATH).size;

fs.watch(MC_LOG_PATH, () => {

  try {

    const newSize =
      fs.statSync(MC_LOG_PATH).size;

    if (newSize <= fileSize) return;

    const stream =
      fs.createReadStream(
        MC_LOG_PATH,
        {
          start: fileSize,
          end: newSize - 1
        }
      );

    let data = '';

    stream.on(
      'data',
      chunk => data += chunk
    );

    stream.on('end', () => {

      fileSize = newSize;

      data
        .split('\n')
        .filter(Boolean)
        .forEach(line => {

          const chat =
            line.match(
              /\[.*?INFO\].*?<(\w+)>\s(.+)/
            );

          if (chat) {

            const msg = {
              type: 'chat',
              player: chat[1],
              message: chat[2],
              time: new Date().toLocaleTimeString(
                'en-IN',
                {
                  hour: '2-digit',
                  minute: '2-digit'
                }
              )
            };

            saveToHistory(msg);
            broadcast(msg);

          }

          const join =
            line.match(
              /\[.*?INFO\].*?(\w+) joined the game/
            );

          if (join) {

            const player =
              join[1];

            const now =
              Date.now();

            if (
              recentJoins.has(player) &&
              now -
              recentJoins.get(player)
              < 5000
            ) {
              return;
            }

            recentJoins.set(
              player,
              now
            );

            backendLog(
              `${player} joined the game`
            );

            const msg = {
              type: 'join',
              player
            };

            saveToHistory(msg);
            broadcast(msg);

          }

          const leave =
            line.match(
              /\[.*?INFO\].*?(\w+) left the game/
            );

          if (leave) {

            backendLog(
              `${leave[1]} left the game`
            );

            const msg = {
              type: 'leave',
              player: leave[1]
            };

            saveToHistory(msg);
            broadcast(msg);

          }

        });

    });

  } catch (err) {

    backendLog(
      `LOG WATCH ERROR: ${err.message}`
    );

  }

});

async function fetchPlayers() {

  try {

    const rcon =
      new Rcon({
        host: RCON_HOST,
        port: RCON_PORT,
        password: RCON_PASSWORD
      });

    await rcon.connect();

    const res =
      await rcon.send('list');

    await rcon.end();

    const countMatch =
      res.match(
        /There are (\d+) of a max(?: of)? (\d+)/
      );

    const max =
      countMatch
        ? parseInt(countMatch[2])
        : 100;

    const colonIdx =
      res.indexOf(':');

    const afterColon =
      colonIdx !== -1
        ? res.slice(
            colonIdx + 1
          ).trim()
        : '';

    const players =
      afterColon.length > 0
        ? afterColon
            .split(',')
            .map(p => p.trim())
            .filter(Boolean)
        : [];

    broadcast({
      type: 'players',
      players,
      max
    });

  } catch(e) {

    backendLog(
      `RCON ERROR: ${e.message}`
    );

  }

}

// Heartbeat every 10 sec
setInterval(() => {

  backendLog(
    `Backend Alive | Clients=${wss.clients.size}`
  );

}, 10000);

setInterval(
  fetchPlayers,
  5000
);

fetchPlayers();
