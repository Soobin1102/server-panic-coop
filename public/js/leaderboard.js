// ─── Live Leaderboard Client Logic ───────────────────────────────────────────

const socket = io({ transports: ['websocket', 'polling'] });

// DOM Elements
const tbody = document.getElementById('leaderboard-tbody');
const statTotal = document.getElementById('stat-total-teams');
const statActive = document.getElementById('stat-active-games');
const statVictories = document.getElementById('stat-victories');
const statMeltdowns = document.getElementById('stat-meltdowns');
const eventPauseIndicator = document.getElementById('event-pause-indicator');
const lastUpdatedTime = document.getElementById('last-updated-time');

// Subscribe to leaderboard updates
socket.emit('subscribe_leaderboard', (data) => {
  renderLeaderboard(data);
});

socket.on('leaderboard_update', (data) => {
  renderLeaderboard(data);
});

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function renderLeaderboard(data) {
  const rooms = data.rooms || [];
  const isPaused = data.isPaused || false;
  const target = data.winTarget || 500;

  // Toggle pause indicator
  eventPauseIndicator.style.display = isPaused ? 'block' : 'none';

  // Stats calculation
  const total = rooms.length;
  const active = rooms.filter(r => r.status === 'playing').length;
  const victories = rooms.filter(r => r.status === 'won').length;
  const meltdowns = rooms.filter(r => r.status === 'lost').length;

  statTotal.textContent = total;
  statActive.textContent = active;
  statVictories.textContent = victories;
  statMeltdowns.textContent = meltdowns;

  const now = new Date();
  lastUpdatedTime.textContent = `Updated: ${now.toLocaleTimeString()}`;

  if (rooms.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:3rem; color:var(--text-dim);">
          No teams registered yet. Teams can join from the Lobby page!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rooms.map((r, index) => {
    const rank = index + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    const pct = Math.min(100, Math.round((r.totalProcessed / target) * 100));

    let statusBadge = `<span class="status-badge waiting">⏳ Waiting</span>`;
    if (r.status === 'playing') {
      statusBadge = `<span class="status-badge playing">⚡ Live</span>`;
    } else if (r.status === 'won') {
      statusBadge = `<span class="status-badge won">🏆 Victory</span>`;
    } else if (r.status === 'lost') {
      statusBadge = `<span class="status-badge lost">💥 Meltdown</span>`;
    }

    return `
      <tr>
        <td><span class="rank-badge ${rankClass}">${rank}</span></td>
        <td style="font-weight:700; color:var(--text-primary); font-size:.95rem;">${r.teamName}</td>
        <td><span style="font-weight:700; color:var(--neon-green); letter-spacing:.1em;">[${r.code}]</span></td>
        <td>
          <div style="width:100%; min-width:140px;">
            <div style="display:flex; justify-content:space-between; font-size:.7rem; color:var(--text-dim); margin-bottom:.2rem;">
              <span>${pct}%</span>
              <span>${r.aliveServers}/${r.totalServers} Servers</span>
            </div>
            <div class="progress-bar-outer" style="height:8px;">
              <div class="progress-bar-inner" style="width:${pct}%; ${r.status === 'won' ? 'background:var(--heat-cool);' : r.status === 'lost' ? 'background:var(--heat-hot);' : ''}"></div>
            </div>
          </div>
        </td>
        <td style="font-weight:600;">${r.totalProcessed} / ${target}</td>
        <td style="color:var(--text-muted); font-weight:600;">⏱️ ${formatTime(r.elapsedSeconds)}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}
