// ─── Game Store ─────────────────────────────────────────────────────────────
// In-memory state for all rooms. Server is the single source of truth.

const rooms = new Map();

const COLORS = [
  { name: 'Red',    weight: 15 },
  { name: 'Blue',   weight: 10 },
  { name: 'Green',  weight: 5  },
  { name: 'Yellow', weight: 20 },
];

const MAX_QUEUE = 15;
const WIN_TARGET = 500;
const MAX_SERVERS = 6;
const MAX_UPGRADES = 2;
const ADD_SERVER_COST = 30;
const UPGRADE_COST = 20;
const REPAIR_AMOUNT = 8;
const BASE_CAPACITY = 50;
const BASE_PROCESS_SPEED = 5;
const HEAT_DISSIPATE = 5;
const HEAT_WARN = 80;

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function makeServer(index) {
  const names = ['A','B','C','D','E','F'];
  return {
    id: index,
    name: `Server ${names[index] || index}`,
    load: 0,
    maxCapacity: BASE_CAPACITY,
    heat: 0,
    alive: true,
    upgradeLevel: 0,
    processSpeed: BASE_PROCESS_SPEED,
  };
}

function randomTraffic() {
  const c = COLORS[Math.floor(Math.random() * COLORS.length)];
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), color: c.name, weight: c.weight };
}

// ── Room CRUD ────────────────────────────────────────────────────────────────

function createRoom(teamName) {
  const code = generateCode();
  const room = {
    code,
    teamName,
    status: 'waiting',         // waiting | playing | won | lost
    players: {},               // socketId → { role, nickname }
    trafficQueue: [],
    servers: [makeServer(0), makeServer(1), makeServer(2)],
    totalProcessed: 0,
    tickNumber: 0,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase()) || null;
}

function joinRoom(code, socketId, nickname) {
  const room = getRoom(code);
  if (!room) return null;
  room.players[socketId] = { role: null, nickname };
  return room;
}

function removePlayer(socketId) {
  for (const [code, room] of rooms) {
    if (room.players[socketId]) {
      delete room.players[socketId];
      if (Object.keys(room.players).length === 0 && room.status !== 'playing') {
        rooms.delete(code);
      }
      return { code, room };
    }
  }
  return null;
}

function setRole(code, socketId, role) {
  const room = getRoom(code);
  if (!room || !room.players[socketId]) return null;
  // Ensure unique role per room
  for (const pid of Object.keys(room.players)) {
    if (room.players[pid].role === role && pid !== socketId) return null;
  }
  room.players[socketId].role = role;
  return room;
}

// ── Game Tick ────────────────────────────────────────────────────────────────

function tickRoom(room) {
  if (room.status !== 'playing') return;
  room.tickNumber++;

  // 1. Spawn traffic (1–3 items)
  const spawnCount = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < spawnCount; i++) {
    if (room.trafficQueue.length < MAX_QUEUE) {
      room.trafficQueue.push(randomTraffic());
    }
  }

  // 2. Process load on each alive server
  for (const srv of room.servers) {
    if (!srv.alive) continue;

    // Process requests
    const processed = Math.min(srv.load, srv.processSpeed);
    srv.load = Math.max(0, srv.load - processed);
    room.totalProcessed += processed;

    // Heat mechanics
    const loadRatio = srv.load / srv.maxCapacity;
    srv.heat += Math.round(loadRatio * 12);

    // Dissipate if under 50% capacity
    if (loadRatio < 0.5) {
      srv.heat = Math.max(0, srv.heat - HEAT_DISSIPATE);
    }

    // Clamp heat
    srv.heat = Math.min(100, Math.max(0, srv.heat));

    // Overheat → offline
    if (srv.heat >= 100) {
      srv.alive = false;
    }
  }

  // 3. Win check
  if (room.totalProcessed >= WIN_TARGET) {
    room.status = 'won';
    return;
  }

  // 4. Lose check — all servers dead
  if (room.servers.every(s => !s.alive)) {
    room.status = 'lost';
  }
}

// ── Traffic Cop actions ─────────────────────────────────────────────────────

function routeTraffic(room, itemId, serverId) {
  const idx = room.trafficQueue.findIndex(t => t.id === itemId);
  if (idx === -1) return false;
  const item = room.trafficQueue.splice(idx, 1)[0];
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv || !srv.alive) {
    // Put it back at front
    room.trafficQueue.unshift(item);
    return false;
  }
  srv.load += item.weight;
  // Immediate heat spike from sudden load
  srv.heat = Math.min(100, srv.heat + Math.round(item.weight * 0.5));
  if (srv.heat >= 100) srv.alive = false;
  return true;
}

// ── Mechanic actions ────────────────────────────────────────────────────────

function addServer(room) {
  if (room.servers.length >= MAX_SERVERS) return null;
  if (room.totalProcessed < ADD_SERVER_COST) return null;
  room.totalProcessed -= ADD_SERVER_COST;
  const srv = makeServer(room.servers.length);
  room.servers.push(srv);
  return srv;
}

function upgradeServer(room, serverId) {
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv || srv.upgradeLevel >= MAX_UPGRADES) return false;
  if (room.totalProcessed < UPGRADE_COST) return false;
  room.totalProcessed -= UPGRADE_COST;
  srv.upgradeLevel++;
  srv.maxCapacity = Math.round(srv.maxCapacity * 1.5);
  srv.processSpeed += 3;
  return true;
}

function repairServer(room, serverId) {
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv) return false;
  if (!srv.alive) {
    // Bring back online at high heat
    srv.alive = true;
    srv.heat = 85;
    srv.load = 0;
    return true;
  }
  if (srv.heat > 30) {
    srv.heat = Math.max(0, srv.heat - REPAIR_AMOUNT);
    return true;
  }
  return false;
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  rooms,
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  setRole,
  tickRoom,
  routeTraffic,
  addServer,
  upgradeServer,
  repairServer,
  WIN_TARGET,
};
