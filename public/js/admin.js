// ─── Game Master Admin Panel Logic ───────────────────────────────────────────

const socket = io({ transports: ['websocket', 'polling'] });

const roomsTbody    = document.getElementById('rooms-tbody');
const roomCount     = document.getElementById('room-count');
const btnStartAll   = document.getElementById('btn-start-all');
const btnTogglePause = document.getElementById('btn-toggle-pause');
const btnClearAll   = document.getElementById('btn-clear-all');

let isPaused = false;

// Fetch initial room list
socket.emit('admin_get_rooms', (data) => {
  if (data) renderAdminPanel(data);
});

// Live updates
socket.on('admin_rooms_update', (data) => {
  if (data) renderAdminPanel(data);
});

socket.on('event_pause_update', ({ isPaused: paused }) => {
  isPaused = paused;
  updatePauseButtonUI();
});

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updatePauseButtonUI() {
  if (isPaused) {
    btnTogglePause.textContent = '▶️ Resume Event';
    btnTogglePause.classList.remove('btn-secondary');
    btnTogglePause.classList.add('btn-primary');
  } else {
    btnTogglePause.textContent = '⏸️ Pause Event';
    btnTogglePause.classList.remove('btn-primary');
    btnTogglePause.classList.add('btn-secondary');
  }
}

function renderAdminPanel(data) {
  const rooms = data.rooms || [];
  isPaused = data.isPaused || false;
  updatePauseButtonUI();

  roomCount.textContent = `${rooms.length} room${rooms.length !== 1 ? 's' : ''}`;

  if (rooms.length === 0) {
    roomsTbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-dim); text-align:center; padding:2rem;">No rooms created yet</td></tr>';
    return;
  }

  roomsTbody.innerHTML = rooms.map(r => `
    <tr>
      <td style="font-weight:700; color:var(--neon-green); letter-spacing:.15em;">${r.code}</td>
      <td style="font-weight:600;">${r.teamName}</td>
      <td>${r.playerCount}/2</td>
      <td>${r.roles.map(role => role === 'traffic_cop' ? '🚦' : '🔧').join(' ') || '—'}</td>
      <td style="font-family:var(--font-mono);">${r.totalProcessed}</td>
      <td style="font-family:var(--font-mono); color:var(--text-dim);">${formatTime(r.elapsedSeconds)}</td>
      <td><span class="status-dot ${r.status}"></span>${r.status}</td>
      <td style="text-align:right;">
        <div style="display:inline-flex; gap:.35rem;">
          ${r.status === 'waiting' ? `
            <button class="btn btn-primary btn-sm action-start-room" data-code="${r.code}" title="Start Game">▶️</button>
          ` : ''}
          <button class="btn btn-secondary btn-sm action-reset-room" data-code="${r.code}" title="Reset / Restart Room">🔄</button>
          <button class="btn btn-danger btn-sm action-delete-room" data-code="${r.code}" title="Delete Room">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Wire up per-room actions
  document.querySelectorAll('.action-start-room').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('admin_start_room', { code: btn.dataset.code });
    });
  });

  document.querySelectorAll('.action-reset-room').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Reset room [${btn.dataset.code}]? Players will return to lobby status.`)) {
        socket.emit('admin_reset_room', { code: btn.dataset.code });
      }
    });
  });

  document.querySelectorAll('.action-delete-room').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Delete room [${btn.dataset.code}]? This will remove the room permanently.`)) {
        socket.emit('admin_delete_room', { code: btn.dataset.code });
      }
    });
  });
}

// Start all games
btnStartAll.addEventListener('click', () => {
  socket.emit('start_all_games');
  btnStartAll.textContent = '✅ Signals Sent!';
  btnStartAll.disabled = true;
  setTimeout(() => {
    btnStartAll.textContent = '🚀 Start All Ready Games';
    btnStartAll.disabled = false;
  }, 3000);
});

// Toggle pause
btnTogglePause.addEventListener('click', () => {
  socket.emit('admin_toggle_pause');
});

// Clear all rooms
btnClearAll.addEventListener('click', () => {
  if (confirm('⚠️ WARNING: Clear all rooms in the event? This cannot be undone.')) {
    socket.emit('admin_clear_all_rooms');
  }
});
