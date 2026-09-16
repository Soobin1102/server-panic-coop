// ─── Game Client Logic ──────────────────────────────────────────────────────
// Reads role from URL, renders the appropriate UI, handles all game events.

const socket = io({ transports: ['websocket', 'polling'] });

// ── Parse URL params ────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
const myRole   = params.get('role');

if (!roomCode || !myRole) {
  window.location.href = '/';
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const gTeamName    = document.getElementById('g-team-name');
const gRoomCode    = document.getElementById('g-room-code');
const gRoleBadge   = document.getElementById('g-role-badge');
const gProgressText = document.getElementById('g-progress-text');
const gProgressBar  = document.getElementById('g-progress-bar');
const gameOverlay   = document.getElementById('game-over-overlay');
const goTitle       = document.getElementById('go-title');
const goSubtitle    = document.getElementById('go-subtitle');
const goStats       = document.getElementById('go-stats');

// Traffic Cop refs
const viewTC   = document.getElementById('view-traffic-cop');
const tcQueue  = document.getElementById('tc-queue');
const tcRoutes = document.getElementById('tc-routes');

// Mechanic refs
const viewMech     = document.getElementById('view-mechanic');
const mechServers  = document.getElementById('mech-servers');
const btnAddServer = document.getElementById('btn-add-server');
const upgradeBtns  = document.getElementById('upgrade-btns');

// ── Setup ───────────────────────────────────────────────────────────────────

const WIN_TARGET = 500;

gRoomCode.textContent = `[${roomCode}]`;

if (myRole === 'traffic_cop') {
  gRoleBadge.textContent = '🚦 TRAFFIC COP';
  gRoleBadge.classList.add('cop');
  viewTC.style.display = 'block';
} else {
  gRoleBadge.textContent = '🔧 MECHANIC';
  gRoleBadge.classList.add('mech');
  viewMech.style.display = 'block';
}

// ── Rejoin the room on the new socket connection ────────────────────────────
// Navigating from lobby creates a new socket. Use rejoin_game to atomically
// reclaim our role (evicting the stale old socket if it hasn't disconnected yet).
socket.emit('rejoin_game', { code: roomCode, role: myRole }, (res) => {
  if (res.ok) {
    gTeamName.textContent = res.teamName;
  } else {
    // Room gone or error — back to lobby
    window.location.href = '/';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TRAFFIC COP
// ═══════════════════════════════════════════════════════════════════════════

let currentQueue = [];
let availableServers = [];

function renderQueue() {
  tcQueue.innerHTML = '';
  if (currentQueue.length === 0) {
    tcQueue.innerHTML = '<p style="color:var(--text-dim); font-family:var(--font-mono); font-size:.8rem; padding:1rem;">Queue empty — servers are keeping up!</p>';
    return;
  }
  currentQueue.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.innerHTML = `
      <span class="queue-dot ${item.color}"></span>
      <span class="queue-label">${item.color} Request</span>
      <span class="queue-weight">+${item.weight} load</span>
    `;
    tcQueue.appendChild(el);
  });
}

function renderRouteButtons() {
  tcRoutes.innerHTML = '';
  if (availableServers.length === 0) {
    tcRoutes.innerHTML = '<p style="color:var(--text-dim); font-family:var(--font-mono); font-size:.8rem;">No servers available!</p>';
    return;
  }
  availableServers.forEach(srv => {
    const btn = document.createElement('button');
    btn.className = 'route-btn';
    btn.textContent = srv.name;
    btn.id = `route-btn-${srv.id}`;
    btn.addEventListener('click', () => {
      if (currentQueue.length === 0) return;
      const topItem = currentQueue[0];
      socket.emit('route_traffic', { code: roomCode, itemId: topItem.id, serverId: srv.id });
    });
    tcRoutes.appendChild(btn);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MECHANIC
// ═══════════════════════════════════════════════════════════════════════════

let currentServers = [];
let totalProcessed = 0;

function heatClass(heat) {
  if (heat >= 90) return 'critical';
  if (heat >= 70) return 'hot';
  if (heat >= 45) return 'warm';
  return '';
}

function cardClass(srv) {
  let cls = 'server-card';
  if (!srv.alive) cls += ' dead';
  else if (srv.heat >= 80) cls += ' shake danger';
  else if (srv.heat >= 60) cls += ' warn';
  return cls;
}

function renderServers() {
  mechServers.innerHTML = '';
  currentServers.forEach(srv => {
    const loadPct = Math.min(100, Math.round((srv.load / srv.maxCapacity) * 100));
    const heatPct = Math.round(srv.heat);

    const card = document.createElement('div');
    card.className = cardClass(srv);
    card.innerHTML = `
      <div class="server-header">
        <span class="server-name">${srv.name}</span>
        <span class="server-status ${srv.alive ? 'online' : 'offline'}">${srv.alive ? '● Online' : '● Offline'}</span>
      </div>
      <div class="gauge">
        <div class="gauge-label"><span>Heat</span><span>${heatPct}%</span></div>
        <div class="gauge-track">
          <div class="gauge-fill heat ${heatClass(srv.heat)}" style="width:${heatPct}%"></div>
        </div>
      </div>
      <div class="gauge">
        <div class="gauge-label"><span>Load</span><span>${srv.load} / ${srv.maxCapacity}</span></div>
        <div class="gauge-track">
          <div class="gauge-fill load" style="width:${loadPct}%"></div>
        </div>
      </div>
      <div style="font-family:var(--font-mono); font-size:.7rem; color:var(--text-dim); margin-top:.35rem;">
        Speed: ${srv.processSpeed}/tick · Upgrades: ${srv.upgradeLevel}/2
      </div>
      <div class="server-actions">
        <button class="btn btn-danger btn-sm repair-btn" data-id="${srv.id}" ${(srv.heat <= 30 && srv.alive) ? 'disabled' : ''}>
          🔧 ${srv.alive ? 'Repair' : 'Revive'}
        </button>
        <button class="btn btn-secondary btn-sm upgrade-btn" data-id="${srv.id}" ${srv.upgradeLevel >= 2 || totalProcessed < 20 ? 'disabled' : ''}>
          ⬆ Upgrade <span style="font-size:.65rem; opacity:.6;">(20)</span>
        </button>
      </div>
    `;
    mechServers.appendChild(card);
  });

  // Wire up repair buttons
  document.querySelectorAll('.repair-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('repair_server', { code: roomCode, serverId: parseInt(btn.dataset.id) });
    });
  });

  // Wire up upgrade buttons
  document.querySelectorAll('.upgrade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('upgrade_server', { code: roomCode, serverId: parseInt(btn.dataset.id) });
    });
  });
}

// Add server button
btnAddServer.addEventListener('click', () => {
  socket.emit('add_server', { code: roomCode });
});

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════════════════

socket.on('game_state', (state) => {
  totalProcessed = state.totalProcessed || 0;
  const pct = Math.min(100, Math.round((totalProcessed / WIN_TARGET) * 100));
  gProgressText.textContent = `${totalProcessed} / ${WIN_TARGET}`;
  gProgressBar.style.width = pct + '%';

  if (myRole === 'traffic_cop') {
    currentQueue = state.trafficQueue || [];
    availableServers = state.serverNames || [];
    renderQueue();
    renderRouteButtons();
  } else {
    currentServers = state.servers || [];
    renderServers();
    // Update add-server button state
    btnAddServer.disabled = currentServers.length >= 6 || totalProcessed < 30;
  }
});

socket.on('infrastructure_change', (data) => {
  if (myRole === 'traffic_cop') {
    // New routing targets available
    availableServers = data.servers.filter(s => s.alive).map(s => ({ id: s.id, name: s.name }));
    renderRouteButtons();
  } else {
    currentServers = data.servers;
    totalProcessed = data.totalProcessed;
    renderServers();
  }
});

socket.on('game_over', (data) => {
  gameOverlay.classList.add('active');
  if (data.result === 'won') {
    goTitle.textContent = '🎉 VICTORY!';
    goTitle.className = 'game-over-title won';
    goSubtitle.textContent = 'All requests processed! The servers survived!';
  } else {
    goTitle.textContent = '💥 MELTDOWN!';
    goTitle.className = 'game-over-title lost';
    goSubtitle.textContent = 'All servers overheated. Total system failure.';
  }
  goStats.textContent = `Team: ${data.teamName} · Processed: ${data.totalProcessed} / ${WIN_TARGET}`;
});

// Redirect to lobby if disconnected for too long
socket.on('disconnect', () => {
  setTimeout(() => {
    if (!socket.connected) {
      window.location.href = '/';
    }
  }, 5000);
});
