// ─── Socket Handler — Strategic Events & Real-time State Sync ───────────────
// Handles traffic routing, mechanic repairs, server role changes, incident fixes,
// and admin/leaderboard broadcasts.

const store = require('./gameStore');

function registerHandlers(io, socket) {

  // ── Lobby Events ────────────────────────────────────────────────────────

  socket.on('create_room', ({ teamName, nickname }, cb) => {
    const room = store.createRoom(teamName || 'Team Unknown');
    room.players[socket.id] = { role: null, nickname: nickname || 'Player 1' };
    socket.join(room.code);
    cb({ ok: true, code: room.code, room: sanitizeRoom(room) });
    broadcastAdminAndLeaderboard(io);
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
    broadcastAdminAndLeaderboard(io);
  });

  socket.on('select_role', ({ code, role }, cb) => {
    if (!['traffic_cop', 'mechanic'].includes(role)) return cb({ ok: false, error: 'Invalid role' });
    const room = store.setRole(code, socket.id, role);
    if (!room) return cb({ ok: false, error: 'Role already taken' });
    cb({ ok: true, room: sanitizeRoom(room) });
    io.to(room.code).emit('room_update', sanitizeRoom(room));
  });

  // ── Rejoin Game ─────────────────────────────────────────────────────────

  socket.on('rejoin_game', ({ code, role }, cb) => {
    const room = store.getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });

    for (const [sid, player] of Object.entries(room.players)) {
      if (player.role === role && sid !== socket.id) {
        const oldSock = io.sockets.sockets.get(sid);
        if (!oldSock || !oldSock.connected) {
          delete room.players[sid];
        }
      }
    }

    delete room.players[socket.id];
    room.players[socket.id] = { role, nickname: role === 'traffic_cop' ? 'Traffic Cop' : 'Mechanic' };
    socket.join(room.code);

    cb({ ok: true, teamName: room.teamName, status: room.status });
    broadcastAdminAndLeaderboard(io);
  });

  // ── Game Actions ────────────────────────────────────────────────────────

  socket.on('route_traffic', ({ code, itemId, serverId }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const result = store.routeTraffic(room, itemId, serverId);
    if (cb) cb(result);
    emitGameState(io, room);
  });

  socket.on('repair_server', ({ code, serverId }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const result = store.repairServer(room, serverId);
    if (cb) cb(result);
    emitGameState(io, room);
  });

  socket.on('change_server_role', ({ code, serverId, newRole }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const result = store.changeServerRole(room, serverId, newRole);
    if (cb) cb(result);
    emitGameState(io, room);
  });

  socket.on('fix_coolant', ({ code, serverId }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const result = store.fixCoolant(room, serverId);
    if (cb) cb(result);
    emitGameState(io, room);
  });

  socket.on('purge_malware', ({ code, serverId }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const result = store.purgeMalware(room, serverId);
    if (cb) cb(result);
    emitGameState(io, room);
  });

  socket.on('add_server', ({ code }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const srv = store.addServer(room);
    if (srv) {
      if (cb) cb({ ok: true });
      io.to(room.code).emit('infrastructure_change', {
        action: 'add_server',
        servers: room.servers.map(sanitizeServer),
        totalProcessed: room.totalProcessed,
      });
      emitGameState(io, room);
    } else {
      if (cb) cb({ ok: false, error: 'Requires 30 processed points or max servers reached' });
    }
  });

  socket.on('upgrade_server', ({ code, serverId }, cb) => {
    const room = store.getRoom(code);
    if (!room || room.status !== 'playing') return;
    const ok = store.upgradeServer(room, serverId);
    if (ok) {
      if (cb) cb({ ok: true });
      io.to(room.code).emit('infrastructure_change', {
        action: 'upgrade_server',
        servers: room.servers.map(sanitizeServer),
        totalProcessed: room.totalProcessed,
      });
      emitGameState(io, room);
    } else {
      if (cb) cb({ ok: false, error: 'Requires 20 processed points or max upgrades reached' });
    }
  });

  // ── Admin & Leaderboard Events ──────────────────────────────────────────

  socket.on('subscribe_leaderboard', (cb) => {
    socket.join('leaderboard');
    if (typeof cb === 'function') {
      cb(getLeaderboardData());
    }
  });

  socket.on('start_all_games', () => {
    for (const [code, room] of store.rooms) {
      if (room.status === 'waiting') {
        const roles = Object.values(room.players).map(p => p.role);
        if (roles.includes('traffic_cop') && roles.includes('mechanic')) {
          room.status = 'playing';
          io.to(code).emit('game_start', { room: sanitizeRoom(room) });
        }
      }
    }
    broadcastAdminAndLeaderboard(io);
  });

  socket.on('admin_start_room', ({ code }, cb) => {
    const room = store.getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    if (room.status === 'waiting') {
      room.status = 'playing';
      io.to(code).emit('game_start', { room: sanitizeRoom(room) });
      broadcastAdminAndLeaderboard(io);
      if (cb) cb({ ok: true });
    } else {
      if (cb) cb({ ok: false, error: 'Room is already in progress' });
    }
  });

  socket.on('admin_reset_room', ({ code }, cb) => {
    const room = store.resetRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    io.to(code).emit('room_reset', { room: sanitizeRoom(room) });
    broadcastAdminAndLeaderboard(io);
    if (cb) cb({ ok: true });
  });

  socket.on('admin_delete_room', ({ code }, cb) => {
    const deleted = store.deleteRoom(code);
    if (deleted) {
      io.to(code).emit('room_deleted');
      broadcastAdminAndLeaderboard(io);
      if (cb) cb({ ok: true });
    } else {
      if (cb) cb({ ok: false, error: 'Room not found' });
    }
  });

  socket.on('admin_toggle_pause', (cb) => {
    const isPaused = store.setEventPause(!store.isEventPaused);
    io.emit('event_pause_update', { isPaused });
    broadcastAdminAndLeaderboard(io);
    if (cb) cb({ ok: true, isPaused });
  });

  socket.on('admin_clear_all_rooms', (cb) => {
    store.clearAllRooms();
    broadcastAdminAndLeaderboard(io);
    if (cb) cb({ ok: true });
  });

  socket.on('admin_get_rooms', (cb) => {
    cb(getAdminRoomList());
  });

  socket.on('get_leaderboard_data', (cb) => {
    if (typeof cb === 'function') cb(getLeaderboardData());
  });

  socket.on('disconnect', () => {
    const result = store.removePlayer(socket.id);
    if (result) {
      io.to(result.code).emit('room_update', sanitizeRoom(result.room));
      broadcastAdminAndLeaderboard(io);
    }
  });
}

// ── State Emission ──────────────────────────────────────────────────────────

function emitGameState(io, room) {
  for (const [sid, player] of Object.entries(room.players)) {
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;

    if (player.role === 'traffic_cop') {
      sock.emit('game_state', {
        trafficQueue: room.trafficQueue,
        serverNames: room.servers.map(s => ({
          id: s.id,
          name: s.name,
          alive: s.alive,
          roleType: s.roleType,
          infected: s.infected,
          fanBroken: s.fanBroken,
        })),
        totalProcessed: room.totalProcessed,
        status: room.status,
        tickNumber: room.tickNumber,
        elapsedSeconds: room.elapsedSeconds,
        isPaused: store.isEventPaused,
        activeIncident: room.activeIncident,
      });
    } else if (player.role === 'mechanic') {
      sock.emit('game_state', {
        servers: room.servers.map(sanitizeServer),
        totalProcessed: room.totalProcessed,
        status: room.status,
        tickNumber: room.tickNumber,
        elapsedSeconds: room.elapsedSeconds,
        isPaused: store.isEventPaused,
        activeIncident: room.activeIncident,
      });
    }
  }

  // Win / Lose
  if (room.status === 'won' || room.status === 'lost') {
    io.to(room.code).emit('game_over', {
      result: room.status,
      totalProcessed: room.totalProcessed,
      teamName: room.teamName,
      elapsedSeconds: room.elapsedSeconds,
    });
  }

  broadcastAdminAndLeaderboard(io);
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
    roleType: s.roleType,
    fanBroken: s.fanBroken,
    infected: s.infected,
    lastRepairTime: s.lastRepairTime || 0,
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
    elapsedSeconds: room.elapsedSeconds || 0,
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
      totalProcessed: room.totalProcessed,
      elapsedSeconds: room.elapsedSeconds || 0,
      activeIncident: room.activeIncident ? room.activeIncident.name : null,
    });
  }
  return {
    isPaused: store.isEventPaused,
    rooms: list,
  };
}

function getLeaderboardData() {
  const list = [];
  for (const [code, room] of store.rooms) {
    const aliveServers = room.servers.filter(s => s.alive).length;
    list.push({
      code,
      teamName: room.teamName,
      status: room.status,
      totalProcessed: room.totalProcessed,
      winTarget: store.WIN_TARGET,
      elapsedSeconds: room.elapsedSeconds || 0,
      aliveServers,
      totalServers: room.servers.length,
      playerCount: Object.keys(room.players).length,
      activeIncident: room.activeIncident ? room.activeIncident.name : null,
    });
  }

  list.sort((a, b) => {
    const statusOrder = { won: 1, playing: 2, lost: 3, waiting: 4 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    if (a.status === 'won') {
      return a.elapsedSeconds - b.elapsedSeconds;
    }
    return b.totalProcessed - a.totalProcessed;
  });

  return {
    isPaused: store.isEventPaused,
    winTarget: store.WIN_TARGET,
    rooms: list,
  };
}

function broadcastAdminAndLeaderboard(io) {
  io.emit('admin_rooms_update', getAdminRoomList());
  io.to('leaderboard').emit('leaderboard_update', getLeaderboardData());
}

module.exports = { registerHandlers, emitGameState };
