// ─── Socket Handler ─────────────────────────────────────────────────────────
// All Socket.io event handlers, wired up from server.js

const store = require('./gameStore');

function registerHandlers(io, socket) {

  // ── Lobby Events ────────────────────────────────────────────────────────

  socket.on('create_room', ({ teamName, nickname }, cb) => {
    const room = store.createRoom(teamName || 'Team Unknown');
    room.players[socket.id] = { role: null, nickname: nickname || 'Player 1' };
    socket.join(room.code);
    cb({ ok: true, code: room.code, room: sanitizeRoom(room) });
    broadcastAdminRooms(io);
  });

  socket.on('join_room', ({ code, nickname }, cb) => {
    const room = store.joinRoom(code, socket.id, nickname || 'Player 2');
    if (!room) return cb({ ok: false, error: 'Room not found' });
    const playerCount = Object.keys(room.players).length;
    if (playerCount > 2) {
      delete room.players[socket.id];
      return cb({ ok: false, error: 'Room is full' });
    }
    socket.join(room.code);
    cb({ ok: true, code: room.code, room: sanitizeRoom(room) });
    io.to(room.code).emit('room_update', sanitizeRoom(room));
    broadcastAdminRooms(io);
  });

  socket.on('select_role', ({ code, role }, cb) => {
    if (!['traffic_cop', 'mechanic'].includes(role)) return cb({ ok: false, error: 'Invalid role' });
    const room = store.setRole(code, socket.id, role);
    if (!room) return cb({ ok: false, error: 'Role already taken' });
    cb({ ok: true, room: sanitizeRoom(room) });
    io.to(room.code).emit('room_update', sanitizeRoom(room));
  });

  // ── Rejoin Game (page navigation creates a new socket) ─────────────────

  socket.on('rejoin_game', ({ code, role }, cb) => {
    const room = store.getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });

    // Evict any stale player entries holding this role (old sockets that
    // haven't fully disconnected yet due to the navigation race condition)
    for (const [sid, player] of Object.entries(room.players)) {
      if (player.role === role && sid !== socket.id) {
        // Check if the old socket is actually disconnected or stale
        const oldSock = io.sockets.sockets.get(sid);
        if (!oldSock || !oldSock.connected) {
          delete room.players[sid];
        }
      }
    }

    // Also remove any existing entry for THIS socket (in case of double-join)
    delete room.players[socket.id];

    // Add as player with role already set
    room.players[socket.id] = { role, nickname: role === 'traffic_cop' ? 'Traffic Cop' : 'Mechanic' };
    socket.join(room.code);

    cb({ ok: true, teamName: room.teamName, status: room.status });
    broadcastAdminRooms(io);
  });

  // ── Game Actions ────────────────────────────────────────────────────────

  socket.on('route_traffic', ({ code, itemId, serverId }) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const success = store.routeTraffic(room, itemId, serverId);
    if (success) {
      emitGameState(io, room);
    }
  });

  socket.on('repair_server', ({ code, serverId }) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    store.repairServer(room, serverId);
    emitGameState(io, room);
  });

  socket.on('add_server', ({ code }) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const srv = store.addServer(room);
    if (srv) {
      io.to(room.code).emit('infrastructure_change', {
        action: 'add_server',
        servers: room.servers.map(sanitizeServer),
        totalProcessed: room.totalProcessed,
      });
      emitGameState(io, room);
    }
  });

  socket.on('upgrade_server', ({ code, serverId }) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const ok = store.upgradeServer(room, serverId);
    if (ok) {
      io.to(room.code).emit('infrastructure_change', {
        action: 'upgrade_server',
        servers: room.servers.map(sanitizeServer),
        totalProcessed: room.totalProcessed,
      });
      emitGameState(io, room);
    }
  });

  // ── Admin Events ────────────────────────────────────────────────────────

  socket.on('start_all_games', () => {
    for (const [code, room] of store.rooms) {
      if (room.status === 'waiting') {
        // Check both roles are filled
        const roles = Object.values(room.players).map(p => p.role);
        if (roles.includes('traffic_cop') && roles.includes('mechanic')) {
          room.status = 'playing';
          io.to(code).emit('game_start', { room: sanitizeRoom(room) });
        }
      }
    }
    broadcastAdminRooms(io);
  });

  socket.on('admin_get_rooms', (cb) => {
    cb(getAdminRoomList());
  });

  // ── Disconnect ──────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const result = store.removePlayer(socket.id);
    if (result) {
      io.to(result.code).emit('room_update', sanitizeRoom(result.room));
      broadcastAdminRooms(io);
    }
  });
}

// ── State Emission ──────────────────────────────────────────────────────────

function emitGameState(io, room) {
  // Send role-appropriate data to each player in the room
  for (const [sid, player] of Object.entries(room.players)) {
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;

    if (player.role === 'traffic_cop') {
      sock.emit('game_state', {
        trafficQueue: room.trafficQueue,
        serverNames: room.servers.filter(s => s.alive).map(s => ({ id: s.id, name: s.name })),
        totalProcessed: room.totalProcessed,
        status: room.status,
        tickNumber: room.tickNumber,
      });
    } else if (player.role === 'mechanic') {
      sock.emit('game_state', {
        servers: room.servers.map(sanitizeServer),
        totalProcessed: room.totalProcessed,
        status: room.status,
        tickNumber: room.tickNumber,
      });
    }
  }

  // Win / Lose
  if (room.status === 'won' || room.status === 'lost') {
    io.to(room.code).emit('game_over', {
      result: room.status,
      totalProcessed: room.totalProcessed,
      teamName: room.teamName,
    });
  }
}

function sanitizeServer(s) {
  return {
    id: s.id,
    name: s.name,
    load: s.load,
    maxCapacity: s.maxCapacity,
    heat: s.heat,
    alive: s.alive,
    upgradeLevel: s.upgradeLevel,
    processSpeed: s.processSpeed,
  };
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    teamName: room.teamName,
    status: room.status,
    players: Object.entries(room.players).map(([id, p]) => ({
      id,
      nickname: p.nickname,
      role: p.role,
    })),
    serverCount: room.servers.length,
  };
}

function getAdminRoomList() {
  const list = [];
  for (const [code, room] of store.rooms) {
    list.push({
      code,
      teamName: room.teamName,
      status: room.status,
      playerCount: Object.keys(room.players).length,
      roles: Object.values(room.players).map(p => p.role).filter(Boolean),
    });
  }
  return list;
}

function broadcastAdminRooms(io) {
  io.emit('admin_rooms_update', getAdminRoomList());
}

module.exports = { registerHandlers, emitGameState };
