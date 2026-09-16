// ─── Admin Panel Client ─────────────────────────────────────────────────────

const socket = io({ transports: ['websocket', 'polling'] });

const roomsTbody = document.getElementById('rooms-tbody');
const roomCount  = document.getElementById('room-count');
const btnStartAll = document.getElementById('btn-start-all');

// Fetch initial room list
socket.emit('admin_get_rooms', (rooms) => {
  renderRooms(rooms);
});

// Live updates
socket.on('admin_rooms_update', (rooms) => {
  renderRooms(rooms);
});

function renderRooms(rooms) {
  roomCount.textContent = `${rooms.length} room${rooms.length !== 1 ? 's' : ''}`;

  if (rooms.length === 0) {
    roomsTbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim); text-align:center; padding:2rem;">No rooms yet</td></tr>';
    return;
  }

  roomsTbody.innerHTML = rooms.map(r => `
    <tr>
      <td style="font-weight:700; color:var(--neon-green); letter-spacing:.15em;">${r.code}</td>
      <td>${r.teamName}</td>
      <td>${r.playerCount}/2</td>
      <td>${r.roles.map(role => role === 'traffic_cop' ? '🚦' : '🔧').join(' ') || '—'}</td>
      <td><span class="status-dot ${r.status}"></span>${r.status}</td>
    </tr>
  `).join('');
}

// Start all games
btnStartAll.addEventListener('click', () => {
  socket.emit('start_all_games');
  btnStartAll.textContent = '✅ Signal Sent!';
  btnStartAll.disabled = true;
  setTimeout(() => {
    btnStartAll.textContent = '🚀 Start All Games';
    btnStartAll.disabled = false;
  }, 3000);
});
