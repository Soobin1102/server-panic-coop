// ─── Game Client Logic — Strategic Co-Op Gameplay Engine ────────────────────

const socket = io({ transports: ['websocket', 'polling'] });

// ── Parse URL Params ────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
const myRole   = params.get('role');

if (!roomCode || !myRole) {
  window.location.href = '/';
}

// ── DOM Refs ────────────────────────────────────────────────────────────────
const gTeamName     = document.getElementById('g-team-name');
const gRoomCode     = document.getElementById('g-room-code');
const gRoleBadge    = document.getElementById('g-role-badge');
const gTimer        = document.getElementById('g-timer');
const gProgressText = document.getElementById('g-progress-text');
const gProgressBar  = document.getElementById('g-progress-bar');
const gameOverlay   = document.getElementById('game-over-overlay');
const goTitle       = document.getElementById('go-title');
const goSubtitle    = document.getElementById('go-subtitle');
const goStats       = document.getElementById('go-stats');
const pauseBanner   = document.getElementById('pause-banner');
const toastMsg      = document.getElementById('toast-msg');

const incidentBanner = document.getElementById('incident-banner');
const incidentTitle  = document.getElementById('incident-title');
const incidentDesc   = document.getElementById('incident-desc');

// Traffic Cop refs
const viewTC   = document.getElementById('view-traffic-cop');
const tcQueue  = document.getElementById('tc-queue');
const tcRoutes = document.getElementById('tc-routes');

// Mechanic refs
const viewMech     = document.getElementById('view-mechanic');
const mechServers  = document.getElementById('mech-servers');
const btnAddServer = document.getElementById('btn-add-server');
const upgradeBtns  = document.getElementById('upgrade-btns');

// ── Setup & Constants ──────────────────────────────────────────────────────
const WIN_TARGET = 500;
const REPAIR_COOLDOWN_MS = 4000;
let isDispatching = false;

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

function showToast(msg) {
  toastMsg.textContent = msg;
  toastMsg.classList.add('active');
  setTimeout(() => { toastMsg.classList.remove('active'); }, 3000);
}

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ── Rejoin Game ─────────────────────────────────────────────────────────────
socket.emit('rejoin_game', { code: roomCode, role: myRole }, (res) => {
  if (res.ok) {
    gTeamName.textContent = res.teamName;
  } else {
    window.location.href = '/';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TRAFFIC COP VIEW
// ═══════════════════════════════════════════════════════════════════════════

let currentQueue = [];
let availableServers = [];

function renderQueue() {
  tcQueue.innerHTML = '';
  if (currentQueue.length === 0) {
    tcQueue.innerHTML = '<p style="color:var(--text-dim); font-family:var(--font-mono); font-size:.8rem; padding:1rem;">Queue empty — servers are keeping up!</p>';
    return;
  }
  currentQueue.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.innerHTML = `
      <span class="queue-dot ${item.color}"></span>
      <span style="font-size:1.1rem;">${item.icon || '📨'}</span>
      <span class="queue-label"><strong style="color:var(--text-primary);">[${item.category}]</strong> ${item.label || item.color}</span>
      <span class="queue-weight">+${item.weight} load</span>
    `;
    tcQueue.appendChild(el);
  });
}

function renderRouteButtons() {
  tcRoutes.innerHTML = '';
  const aliveServers = availableServers.filter(s => s.alive);
  if (aliveServers.length === 0) {
    tcRoutes.innerHTML = '<p style="color:var(--heat-hot); font-family:var(--font-mono); font-size:.85rem; font-weight:700;">💥 ALL SERVERS OFFLINE!</p>';
    return;
  }

  availableServers.forEach(srv => {
    const btn = document.createElement('button');
    btn.className = `route-btn ${!srv.alive ? 'offline' : ''}`;
    
    let badgeText = srv.roleType || 'WEB';
    if (!srv.alive) badgeText = 'OFFLINE';
    else if (srv.infected) badgeText = '👾 INFECTED';
    else if (srv.fanBroken) badgeText = '❄️ FAN BROKEN';

    btn.innerHTML = `
      <span style="font-weight:700;">${srv.name}</span>
      <span class="role-tag ${srv.roleType || 'WEB'}">${badgeText}</span>
    `;
    btn.id = `route-btn-${srv.id}`;

    btn.addEventListener('click', () => {
      if (!srv.alive) return;
      if (currentQueue.length === 0) return;
      if (isDispatching) return; // Anti-spam dispatch cooldown

      isDispatching = true;
      btn.style.opacity = '0.5';
      setTimeout(() => { isDispatching = false; btn.style.opacity = '1'; }, 300);

      const topItem = currentQueue[0];
      socket.emit('route_traffic', { code: roomCode, itemId: topItem.id, serverId: srv.id }, (res) => {
        if (res && res.error) {
          showToast(`⚠️ ${res.error}`);
        } else if (res && res.isMatch === false) {
          showToast(`⚡ MISMATCH! Routed [${topItem.category}] to [${srv.roleType}] (+25% Heat Spike!)`);
        }
      });
    });

    tcRoutes.appendChild(btn);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MECHANIC VIEW
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
  const now = Date.now();

  currentServers.forEach(srv => {
    const loadPct = Math.min(100, Math.round((srv.load / srv.maxCapacity) * 100));
    const heatPct = Math.round(srv.heat);

    // Cooldown check for repair pump
    const lastRepair = srv.lastRepairTime || 0;
    const cooldownRemainingSecs = Math.max(0, Math.ceil((REPAIR_COOLDOWN_MS - (now - lastRepair)) / 1000));
    const isCoolingDown = cooldownRemainingSecs > 0;

    let alertBadges = '';
    if (srv.fanBroken) alertBadges += '<span style="background:rgba(59,130,246,.2); color:var(--neon-blue); border:1px solid var(--neon-blue); font-size:.65rem; padding:.1rem .4rem; border-radius:4px; font-weight:700;">❄️ FAN BROKEN</span> ';
    if (srv.infected) alertBadges += '<span style="background:rgba(168,85,247,.2); color:var(--neon-purple); border:1px solid var(--neon-purple); font-size:.65rem; padding:.1rem .4rem; border-radius:4px; font-weight:700;">👾 MALWARE</span> ';

    const card = document.createElement('div');
    card.className = cardClass(srv);
    card.innerHTML = `
      <div class="server-header">
        <div>
          <span class="server-name">${srv.name}</span>
          <span class="role-tag ${srv.roleType}">${srv.roleType}</span>
        </div>
        <span class="server-status ${srv.alive ? 'online' : 'offline'}">${srv.alive ? '● Online' : '● Offline'}</span>
      </div>

      ${alertBadges ? `<div style="margin-bottom:.5rem;">${alertBadges}</div>` : ''}

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

      <div style="font-family:var(--font-mono); font-size:.7rem; color:var(--text-dim); margin-top:.35rem; display:flex; justify-content:space-between;">
        <span>Speed: ${srv.processSpeed}/t</span>
        <span>Upgrades: ${srv.upgradeLevel}/2</span>
      </div>

      <!-- Server Actions -->
      <div class="server-actions" style="flex-wrap:wrap;">
        <button class="btn btn-danger btn-sm repair-btn" data-id="${srv.id}" ${(isCoolingDown || (srv.heat <= 10 && srv.alive) || totalProcessed < (srv.alive ? 5 : 20)) ? 'disabled' : ''}>
          🔧 ${srv.alive ? (isCoolingDown ? `Recharging (${cooldownRemainingSecs}s)` : 'Repair (5)') : 'Revive (20)'}
        </button>

        ${srv.fanBroken ? `
          <button class="btn btn-secondary btn-sm fix-fan-btn" data-id="${srv.id}" ${totalProcessed < 10 ? 'disabled' : ''}>
            ❄️ Fix Fan (10)
          </button>
        ` : ''}

        ${srv.infected ? `
          <button class="btn btn-secondary btn-sm purge-malware-btn" data-id="${srv.id}" ${totalProcessed < 10 ? 'disabled' : ''}>
            🧹 Purge Malware (10)
          </button>
        ` : ''}

        <select class="role-select" data-id="${srv.id}" style="background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border); font-family:var(--font-mono); font-size:.75rem; border-radius:var(--radius-xs); padding:.2rem .4rem;" ${totalProcessed < 15 ? 'disabled' : ''}>
          <option value="" disabled selected>Role (${srv.roleType}) - 15</option>
          <option value="WEB">Set WEB</option>
          <option value="DB">Set DB</option>
          <option value="AUTH">Set AUTH</option>
        </select>
      </div>
    `;
    mechServers.appendChild(card);
  });

  // Repair/Revive buttons
  document.querySelectorAll('.repair-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('repair_server', { code: roomCode, serverId: parseInt(btn.dataset.id) }, (res) => {
        if (res && res.error) showToast(`⚠️ ${res.error}`);
      });
    });
  });

  // Fix fan buttons
  document.querySelectorAll('.fix-fan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('fix_coolant', { code: roomCode, serverId: parseInt(btn.dataset.id) }, (res) => {
        if (res && res.error) showToast(`⚠️ ${res.error}`);
      });
    });
  });

  // Purge malware buttons
  document.querySelectorAll('.purge-malware-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('purge_malware', { code: roomCode, serverId: parseInt(btn.dataset.id) }, (res) => {
        if (res && res.error) showToast(`⚠️ ${res.error}`);
      });
    });
  });

  // Role change dropdowns
  document.querySelectorAll('.role-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const newRole = e.target.value;
      if (!newRole) return;
      socket.emit('change_server_role', { code: roomCode, serverId: parseInt(sel.dataset.id), newRole }, (res) => {
        if (res && res.error) showToast(`⚠️ ${res.error}`);
      });
    });
  });
}

// Add server button
btnAddServer.addEventListener('click', () => {
  socket.emit('add_server', { code: roomCode }, (res) => {
    if (res && res.error) showToast(`⚠️ ${res.error}`);
  });
});

function renderIncident(incident) {
  if (!incident) {
    incidentBanner.className = 'incident-banner';
    return;
  }
  incidentBanner.className = `incident-banner active ${incident.type}`;
  incidentTitle.textContent = `${incident.name} (${incident.duration}s)`;
  incidentDesc.textContent = incident.description;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════════════════

socket.on('game_state', (state) => {
  totalProcessed = state.totalProcessed || 0;
  const pct = Math.min(100, Math.round((totalProcessed / WIN_TARGET) * 100));
  gProgressText.textContent = `${totalProcessed} / ${WIN_TARGET}`;
  gProgressBar.style.width = pct + '%';
  gTimer.textContent = `⏱️ ${formatTime(state.elapsedSeconds)}`;

  renderIncident(state.activeIncident);

  if (state.isPaused) {
    pauseBanner.classList.add('active');
  } else {
    pauseBanner.classList.remove('active');
  }

  if (myRole === 'traffic_cop') {
    currentQueue = state.trafficQueue || [];
    availableServers = state.serverNames || [];
    renderQueue();
    renderRouteButtons();
  } else {
    currentServers = state.servers || [];
    renderServers();
    btnAddServer.disabled = currentServers.length >= 6 || totalProcessed < 30;
  }
});

socket.on('event_pause_update', ({ isPaused }) => {
  if (isPaused) {
    pauseBanner.classList.add('active');
  } else {
    pauseBanner.classList.remove('active');
  }
});

socket.on('infrastructure_change', (data) => {
  if (myRole === 'traffic_cop') {
    availableServers = data.servers.map(s => ({
      id: s.id,
      name: s.name,
      alive: s.alive,
      roleType: s.roleType,
      infected: s.infected,
      fanBroken: s.fanBroken,
    }));
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
    goSubtitle.textContent = 'All requests processed! The servers survived the GameDay!';
  } else {
    goTitle.textContent = '💥 MELTDOWN!';
    goTitle.className = 'game-over-title lost';
    goSubtitle.textContent = 'All servers overheated. Total infrastructure breakdown!';
  }
  goStats.textContent = `Team: ${data.teamName} · Processed: ${data.totalProcessed} / ${WIN_TARGET} · Time: ${formatTime(data.elapsedSeconds)}`;
});

socket.on('room_reset', () => {
  alert('🔄 The Game Master has reset this match!');
  window.location.href = '/';
});

socket.on('room_deleted', () => {
  alert('⚠️ This room was removed by the Game Master.');
  window.location.href = '/';
});

socket.on('disconnect', () => {
  setTimeout(() => {
    if (!socket.connected) {
      window.location.href = '/';
    }
  }, 5000);
});
