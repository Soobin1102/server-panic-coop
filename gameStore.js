// ─── Game Store — Advanced Strategic Game Engine ───────────────────────────
// Server-authoritative single source of truth with Server Specializations,
// Incident Engine, and Cooldown / Anti-Spam Mechanics.

const rooms = new Map();

// ── Request Types & Categories ────────────────────────────────────────────────
const REQUEST_TYPES = [
  { category: 'DB',   icon: '🗄️', label: 'DB Query',    weight: 20, color: 'Yellow' },
  { category: 'AUTH', icon: '🔐', label: 'Auth Request', weight: 15, color: 'Red'    },
  { category: 'WEB',  icon: '🌐', label: 'Page Load',    weight: 10, color: 'Blue'   },
  { category: 'WEB',  icon: '⚡', label: 'Asset Fetch',  weight: 5,  color: 'Green'  },
];

const SERVER_ROLES = ['WEB', 'DB', 'AUTH'];

// ── Balance Constants ────────────────────────────────────────────────────────
const MAX_QUEUE = 15;
const WIN_TARGET = 500;
const MAX_SERVERS = 6;
const MAX_UPGRADES = 2;

const ADD_SERVER_COST = 30;
const UPGRADE_COST = 20;
const REPAIR_COST = 5;
const REVIVE_COST = 20;
const ROLE_CHANGE_COST = 15;
const FIX_ACTION_COST = 10;

const REPAIR_COOLDOWN_MS = 4000; // 4 seconds per server
const BASE_CAPACITY = 50;
const BASE_PROCESS_SPEED = 5;
const HEAT_DISSIPATE = 5;

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
  const defaultRole = SERVER_ROLES[index % SERVER_ROLES.length] || 'WEB';
  return {
    id: index,
    name: `Server ${names[index] || index}`,
    load: 0,
    maxCapacity: BASE_CAPACITY,
    heat: 0,
    alive: true,
    upgradeLevel: 0,
    processSpeed: BASE_PROCESS_SPEED,
    roleType: defaultRole,     // WEB | DB | AUTH
    fanBroken: false,          // Coolant failure incident
    infected: false,           // Malware incident
    lastRepairTime: 0,
  };
}

function randomTraffic() {
  const item = REQUEST_TYPES[Math.floor(Math.random() * REQUEST_TYPES.length)];
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    color: item.color,
    weight: item.weight,
    category: item.category,
    icon: item.icon,
    label: item.label,
  };
}

// ── Event Pause & Room CRUD ──────────────────────────────────────────────────

let isEventPaused = false;

function setEventPause(paused) {
  isEventPaused = paused;
  return isEventPaused;
}

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
    startTime: null,
    finishTime: null,
    elapsedSeconds: 0,
    activeIncident: null,       // { type, name, description, duration, targetServerId }
    nextIncidentTick: 15,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase()) || null;
}

function resetRoom(code) {
  const room = getRoom(code);
  if (!room) return null;
  room.status = 'waiting';
  room.trafficQueue = [];
  room.servers = [makeServer(0), makeServer(1), makeServer(2)];
  room.totalProcessed = 0;
  room.tickNumber = 0;
  room.startTime = null;
  room.finishTime = null;
  room.elapsedSeconds = 0;
  room.activeIncident = null;
  room.nextIncidentTick = 15;
  return room;
}

function deleteRoom(code) {
  const codeUpper = code?.toUpperCase();
  if (rooms.has(codeUpper)) {
    rooms.delete(codeUpper);
    return true;
  }
  return false;
}

function clearAllRooms() {
  rooms.clear();
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
  for (const pid of Object.keys(room.players)) {
    if (room.players[pid].role === role && pid !== socketId) return null;
  }
  room.players[socketId].role = role;
  return room;
}

// ── Game Tick Loop ────────────────────────────────────────────────────────────

function triggerRandomIncident(room) {
  const aliveServers = room.servers.filter(s => s.alive);
  if (aliveServers.length === 0) return;

  const choice = Math.floor(Math.random() * 4);
  const targetServer = aliveServers[Math.floor(Math.random() * aliveServers.length)];

  if (choice === 0) {
    // 🌊 DDoS Attack
    room.activeIncident = {
      type: 'DDOS',
      name: '🌊 DDoS Attack',
      description: 'Heavy traffic surge flooding the queue!',
      duration: 10,
    };
    // Flood 4 heavy items
    for (let i = 0; i < 4; i++) {
      if (room.trafficQueue.length < MAX_QUEUE) {
        room.trafficQueue.push(REQUEST_TYPES[0]); // DB Query
      }
    }
  } else if (choice === 1 && targetServer) {
    // ❄️ Coolant Fan Failure
    targetServer.fanBroken = true;
    room.activeIncident = {
      type: 'COOLANT_FAILURE',
      name: '❄️ Fan Failure',
      description: `Cooling fan broken on ${targetServer.name}! Heat rising 3x faster!`,
      duration: 12,
      targetServerId: targetServer.id,
    };
  } else if (choice === 2 && targetServer) {
    // 👾 Malware Infection
    targetServer.infected = true;
    room.activeIncident = {
      type: 'MALWARE',
      name: '👾 Malware Infection',
      description: `${targetServer.name} infected by malware! Processing locked!`,
      duration: 10,
      targetServerId: targetServer.id,
    };
  } else {
    // ⚡ Power Surge
    room.activeIncident = {
      type: 'POWER_SURGE',
      name: '⚡ Power Surge',
      description: 'Voltage spike! +30% heat across all servers!',
      duration: 4,
    };
    for (const s of room.servers) {
      if (s.alive) s.heat = Math.min(100, s.heat + 30);
    }
  }
}

function tickRoom(room) {
  if (isEventPaused) return;
  if (room.status !== 'playing') return;

  if (!room.startTime) {
    room.startTime = Date.now();
  }
  room.elapsedSeconds = Math.floor((Date.now() - room.startTime) / 1000);
  room.tickNumber++;

  // 1. Incidents Engine
  if (room.activeIncident) {
    room.activeIncident.duration--;
    if (room.activeIncident.duration <= 0) {
      room.activeIncident = null;
    }
  } else if (room.tickNumber >= room.nextIncidentTick) {
    triggerRandomIncident(room);
    room.nextIncidentTick = room.tickNumber + 18 + Math.floor(Math.random() * 10);
  }

  // 2. Spawn traffic (1–3 items, or 3-4 during DDoS)
  const isDDoS = room.activeIncident?.type === 'DDOS';
  const spawnCount = isDDoS ? (2 + Math.floor(Math.random() * 3)) : (1 + Math.floor(Math.random() * 3));
  for (let i = 0; i < spawnCount; i++) {
    if (room.trafficQueue.length < MAX_QUEUE) {
      room.trafficQueue.push(randomTraffic());
    }
  }

  // 3. Process load on each server
  for (const srv of room.servers) {
    if (!srv.alive) continue;

    // Infected servers cannot process load
    if (!srv.infected) {
      const processed = Math.min(srv.load, srv.processSpeed);
      srv.load = Math.max(0, srv.load - processed);
      room.totalProcessed += processed;
    }

    // Heat mechanics
    const loadRatio = srv.load / srv.maxCapacity;
    let heatGain = Math.round(loadRatio * 12);
    if (srv.fanBroken) heatGain += 10; // Extra heat if fan broken

    srv.heat += heatGain;

    // Dissipate if under 50% load and fan is ok
    if (loadRatio < 0.5 && !srv.fanBroken) {
      srv.heat = Math.max(0, srv.heat - HEAT_DISSIPATE);
    }

    // Clamp heat
    srv.heat = Math.min(100, Math.max(0, srv.heat));

    // Overheat check
    if (srv.heat >= 100) {
      srv.alive = false;
    }
  }

  // 4. Win check
  if (room.totalProcessed >= WIN_TARGET) {
    room.status = 'won';
    room.finishTime = Date.now();
    room.elapsedSeconds = Math.floor((room.finishTime - room.startTime) / 1000);
    return;
  }

  // 5. Lose check — all servers dead
  if (room.servers.every(s => !s.alive)) {
    room.status = 'lost';
    room.finishTime = Date.now();
    room.elapsedSeconds = Math.floor((room.finishTime - room.startTime) / 1000);
  }
}

// ── Traffic Cop Actions ──────────────────────────────────────────────────────

function routeTraffic(room, itemId, serverId) {
  const idx = room.trafficQueue.findIndex(t => t.id === itemId);
  if (idx === -1) return { ok: false, error: 'Request no longer in queue' };

  const srv = room.servers.find(s => s.id === serverId);
  if (!srv || !srv.alive) return { ok: false, error: 'Server offline' };

  const item = room.trafficQueue.splice(idx, 1)[0];

  if (srv.infected) {
    // Locked by malware!
    srv.heat = Math.min(100, srv.heat + 15);
    return { ok: false, error: `${srv.name} is locked by malware!` };
  }

  const isMatch = srv.roleType === item.category;

  if (isMatch) {
    srv.load += item.weight;
    srv.heat = Math.min(100, srv.heat + Math.round(item.weight * 0.3));
  } else {
    // 💥 MISMATCH PENALTY: +25% heat spike, extra load burden!
    srv.load += Math.round(item.weight * 1.4);
    srv.heat = Math.min(100, srv.heat + 25);
  }

  if (srv.heat >= 100) srv.alive = false;
  return { ok: true, isMatch };
}

// ── Mechanic Actions ────────────────────────────────────────────────────────

function repairServer(room, serverId) {
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv) return { ok: false, error: 'Server not found' };

  const now = Date.now();
  if (now - srv.lastRepairTime < REPAIR_COOLDOWN_MS) {
    const remainingSecs = Math.ceil((REPAIR_COOLDOWN_MS - (now - srv.lastRepairTime)) / 1000);
    return { ok: false, error: `Cooling pump recharging (${remainingSecs}s)` };
  }

  if (!srv.alive) {
    // REVIVE ACTION
    if (room.totalProcessed < REVIVE_COST) return { ok: false, error: `Revive costs ${REVIVE_COST} points` };
    room.totalProcessed -= REVIVE_COST;
    srv.alive = true;
    srv.heat = 60;
    srv.load = 0;
    srv.fanBroken = false;
    srv.infected = false;
    srv.lastRepairTime = now;
    return { ok: true, action: 'revive' };
  }

  // REPAIR ACTION
  if (room.totalProcessed < REPAIR_COST) return { ok: false, error: `Repair costs ${REPAIR_COST} points` };
  if (srv.heat <= 10) return { ok: false, error: 'Server is already cool' };

  room.totalProcessed -= REPAIR_COST;
  srv.heat = Math.max(0, srv.heat - 35);
  srv.lastRepairTime = now;
  return { ok: true, action: 'repair' };
}

function changeServerRole(room, serverId, newRole) {
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv) return { ok: false, error: 'Server not found' };
  if (!SERVER_ROLES.includes(newRole)) return { ok: false, error: 'Invalid role' };
  if (srv.roleType === newRole) return { ok: false, error: 'Server already has this role' };
  if (room.totalProcessed < ROLE_CHANGE_COST) return { ok: false, error: `Role change costs ${ROLE_CHANGE_COST} points` };

  room.totalProcessed -= ROLE_CHANGE_COST;
  srv.roleType = newRole;
  return { ok: true };
}

function fixCoolant(room, serverId) {
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv || !srv.fanBroken) return { ok: false, error: 'Cooling fan is functional' };
  if (room.totalProcessed < FIX_ACTION_COST) return { ok: false, error: `Fixing fan costs ${FIX_ACTION_COST} points` };

  room.totalProcessed -= FIX_ACTION_COST;
  srv.fanBroken = false;
  return { ok: true };
}

function purgeMalware(room, serverId) {
  const srv = room.servers.find(s => s.id === serverId);
  if (!srv || !srv.infected) return { ok: false, error: 'No malware detected' };
  if (room.totalProcessed < FIX_ACTION_COST) return { ok: false, error: `Purging malware costs ${FIX_ACTION_COST} points` };

  room.totalProcessed -= FIX_ACTION_COST;
  srv.infected = false;
  return { ok: true };
}

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

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  rooms,
  get isEventPaused() { return isEventPaused; },
  setEventPause,
  resetRoom,
  deleteRoom,
  clearAllRooms,
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  setRole,
  tickRoom,
  routeTraffic,
  repairServer,
  changeServerRole,
  fixCoolant,
  purgeMalware,
  addServer,
  upgradeServer,
  WIN_TARGET,
  REPAIR_COST,
  REVIVE_COST,
  ROLE_CHANGE_COST,
  FIX_ACTION_COST,
  REPAIR_COOLDOWN_MS,
  SERVER_ROLES,
};
