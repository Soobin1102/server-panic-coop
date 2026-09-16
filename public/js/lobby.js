// ─── Lobby Client Logic ─────────────────────────────────────────────────────

const socket = io({ transports: ['websocket', 'polling'] });

// ── State ───────────────────────────────────────────────────────────────────
let currentRoom = null;
let myRole = null;

// ── DOM refs ────────────────────────────────────────────────────────────────
const screenLanding = document.getElementById('screen-landing');
const screenRoom    = document.getElementById('screen-room');
const inputNickname = document.getElementById('input-nickname');
const inputTeam     = document.getElementById('input-team');
const inputCode     = document.getElementById('input-code');
const btnCreate     = document.getElementById('btn-create');
const btnJoin       = document.getElementById('btn-join');
const displayCode   = document.getElementById('display-code');
const displayTeam   = document.getElementById('display-team');
const landingError  = document.getElementById('landing-error');
const roomError     = document.getElementById('room-error');
const roomStatus    = document.getElementById('room-status');
const roleCop       = document.getElementById('role-traffic_cop');
const roleMech      = document.getElementById('role-mechanic');

// ── Helpers ─────────────────────────────────────────────────────────────────

function showScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function nickname() {
  return inputNickname.value.trim() || 'Anon';
}

// ── Create Room ─────────────────────────────────────────────────────────────

btnCreate.addEventListener('click', () => {
  const teamName = inputTeam.value.trim() || 'Team Unknown';
  socket.emit('create_room', { teamName, nickname: nickname() }, (res) => {
    if (!res.ok) return showError(landingError, res.error);
    currentRoom = res.code;
    displayCode.textContent = res.code;
    displayTeam.textContent = res.room.teamName;
    showScreen(screenRoom);
  });
});

// ── Join Room ───────────────────────────────────────────────────────────────

btnJoin.addEventListener('click', () => {
  const code = inputCode.value.trim().toUpperCase();
  if (code.length !== 4) return showError(landingError, 'Enter a 4-letter code');
  socket.emit('join_room', { code, nickname: nickname() }, (res) => {
    if (!res.ok) return showError(landingError, res.error);
    currentRoom = res.code;
    displayCode.textContent = res.code;
    displayTeam.textContent = res.room.teamName;
    showScreen(screenRoom);
    updateRoleCards(res.room);
  });
});

// Allow Enter key to join
inputCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

// ── Role Selection ──────────────────────────────────────────────────────────

[roleCop, roleMech].forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('taken')) return;
    const role = card.dataset.role;
    socket.emit('select_role', { code: currentRoom, role }, (res) => {
      if (!res.ok) return showError(roomError, res.error);
      myRole = role;
      updateRoleCards(res.room);
    });
  });
});

function updateRoleCards(room) {
  const takenRoles = {};
  room.players.forEach(p => {
    if (p.role) takenRoles[p.role] = p.id;
  });

  [roleCop, roleMech].forEach(card => {
    const role = card.dataset.role;
    card.classList.remove('selected', 'taken');
    if (takenRoles[role] === socket.id) {
      card.classList.add('selected');
    } else if (takenRoles[role]) {
      card.classList.add('taken');
    }
  });

  // Update status text
  const bothReady = takenRoles['traffic_cop'] && takenRoles['mechanic'];
  if (bothReady) {
    roomStatus.innerHTML = 'Both roles selected — waiting for admin to start the game<span class="waiting-dots"></span>';
  } else {
    roomStatus.innerHTML = 'Waiting for teammate to join and pick a role<span class="waiting-dots"></span>';
  }
}

// ── Room Updates ────────────────────────────────────────────────────────────

socket.on('room_update', (room) => {
  if (room.code === currentRoom) {
    updateRoleCards(room);
  }
});

// ── Game Start ──────────────────────────────────────────────────────────────

socket.on('game_start', (data) => {
  // Navigate to game page
  const url = `/game.html?room=${currentRoom}&role=${myRole}`;
  window.location.href = url;
});
