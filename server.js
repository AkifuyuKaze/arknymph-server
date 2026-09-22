// ArknightsNymph 双人联机 WebSocket 服务器
// 部署：Render 免费版，启动命令 node server.js
// 只做房间管理和消息转发，答案和判定都在房主端（防作弊）

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// 房间表：roomId -> { host: ws, guest: ws, difficulty: string }
const rooms = new Map();

// 生成6位房间码（排除易混字符）
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

console.log(`[server] WebSocket 服务器启动，端口 ${PORT}`);

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null; // 'host' | 'guest'
  console.log(`[server] 新连接，当前在线 ${wss.clients.size}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    // ========== 房间管理消息（服务器处理） ==========
    if (msg.type === 'create_room') {
      // 如果已经在某个房间，先退出
      if (ws.roomId) leaveRoom(ws);

      const roomId = generateRoomCode();
      rooms.set(roomId, {
        host: ws,
        guest: null,
        difficulty: msg.difficulty || 'hard'
      });
      ws.roomId = roomId;
      ws.role = 'host';
      send(ws, { type: 'room_created', roomId });
      console.log(`[server] 房间 ${roomId} 已创建`);
      return;
    }

    if (msg.type === 'join_room') {
      const roomId = (msg.roomId || '').toUpperCase();
      const room = rooms.get(roomId);

      if (!room) {
        send(ws, { type: 'error', message: '房间不存在' });
        return;
      }
      if (room.guest) {
        send(ws, { type: 'error', message: '房间已满' });
        return;
      }

      // 如果已经在某个房间，先退出
      if (ws.roomId) leaveRoom(ws);

      room.guest = ws;
      ws.roomId = roomId;
      ws.role = 'guest';

      // 通知加入者成功，并同步当前难度
      send(ws, { type: 'joined', difficulty: room.difficulty });
      // 通知房主对手加入
      send(room.host, { type: 'guest_joined' });
      console.log(`[server] 玩家加入房间 ${roomId}`);
      return;
    }

    // ========== 游戏消息（直接转发给对方） ==========
    if (!ws.roomId || !ws.role) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    const target = ws.role === 'host' ? room.guest : room.host;

    // 房主发 game_start 时更新房间难度
    if (msg.type === 'game_start' && ws.role === 'host') {
      room.difficulty = msg.difficulty || room.difficulty;
    }
    // 房主切换难度时更新
    if (msg.type === 'difficulty_change' && ws.role === 'host') {
      room.difficulty = msg.difficulty;
    }

    // 转发
    if (target) {
      send(target, msg);
    }
  });

  ws.on('close', () => {
    console.log(`[server] 连接断开，角色=${ws.role}，房间=${ws.roomId}`);
    leaveRoom(ws);
    console.log(`[server] 当前在线 ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[server] 连接错误:', err.message);
  });
});

function leaveRoom(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) {
    ws.roomId = null;
    ws.role = null;
    return;
  }

  // 通知对方
  const other = ws.role === 'host' ? room.guest : room.host;
  if (other) {
    send(other, { type: 'opponent_left' });
  }

  rooms.delete(ws.roomId);
  ws.roomId = null;
  ws.role = null;
  console.log(`[server] 房间 ${room} 已销毁`);
}

// 健康检查（Render 用）
const http = require('http');
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      clients: wss.clients.size
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
const HEALTH_PORT = process.env.HEALTH_PORT || (PORT === 8080 ? 8081 : Number(PORT) + 1);
healthServer.listen(HEALTH_PORT, () => {
  console.log(`[server] 健康检查端口 ${HEALTH_PORT}，访问 /health`);
});
//（注：内容由AI生成）
