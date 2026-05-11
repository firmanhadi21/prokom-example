const state = { user: null, rooms: [], selectedRoom: null, selectedDate: todayStr() };

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target.id === 'modal') closeModal();
});

// ---------- Auth ----------
document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    const target = btn.dataset.authTab;
    document.getElementById('login-form').classList.toggle('active', target === 'login');
    document.getElementById('register-form').classList.toggle('active', target === 'register');
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: { username: fd.get('username'), password: fd.get('password') },
    });
    state.user = user;
    await enterApp();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: {
        username: fd.get('username'),
        password: fd.get('password'),
        full_name: fd.get('full_name'),
      },
    });
    state.user = user;
    toast('Pendaftaran berhasil');
    await enterApp();
  } catch (err) { toast(err.message, 'error'); }
});

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('user-bar').innerHTML = '';
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.add('hidden'));
}

// ---------- App init ----------
async function enterApp() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  const isAdmin = state.user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
  document.getElementById('user-bar').innerHTML = `
    <span>${state.user.full_name} <em>(${state.user.role})</em></span>
    <button id="btn-logout">Logout</button>
  `;
  document.getElementById('btn-logout').addEventListener('click', logout);
  await loadRooms();
  document.getElementById('cal-date').value = state.selectedDate;
  await renderCalendar();
}

// ---------- Tabs ----------
document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tab = btn.dataset.tab;
    if ((tab === 'rooms' || tab === 'approvals') && state.user?.role !== 'admin') {
      toast('Akses ditolak', 'error');
      return;
    }
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'calendar') await renderCalendar();
    if (tab === 'my-bookings') await renderMyBookings();
    if (tab === 'approvals') await renderApprovals();
    if (tab === 'rooms') await renderRooms();
  });
});

// ---------- Rooms ----------
async function loadRooms() {
  state.rooms = await api('/api/rooms');
  const select = document.getElementById('cal-room');
  select.innerHTML = state.rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  if (state.rooms.length) state.selectedRoom = state.rooms[0].id;
}

document.getElementById('cal-room').addEventListener('change', (e) => {
  state.selectedRoom = Number(e.target.value);
  renderCalendar();
});
document.getElementById('cal-date').addEventListener('change', (e) => {
  state.selectedDate = e.target.value;
  renderCalendar();
});

// ---------- Calendar (timeline grid 07:00-21:00, 1h slots) ----------
async function renderCalendar() {
  if (!state.selectedRoom) {
    document.getElementById('calendar').innerHTML = '<div class="empty">Belum ada ruangan</div>';
    return;
  }
  const date = state.selectedDate;
  const from = `${date}T00:00:00`;
  const to = `${date}T23:59:59`;
  const bookings = await api(
    `/api/bookings?room_id=${state.selectedRoom}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );

  const startHour = 7, endHour = 21;
  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    slots.push({ h, label: `${String(h).padStart(2,'0')}:00` });
  }

  const cells = ['<div class="cal-grid">'];
  cells.push('<div class="cal-cell cal-header">Jam</div>');
  cells.push(`<div class="cal-cell cal-header" style="grid-column: span 14">Status Booking</div>`);
  for (const s of slots) {
    cells.push(`<div class="cal-cell cal-time">${s.label}</div>`);
    const slotStart = new Date(`${date}T${String(s.h).padStart(2,'0')}:00:00`);
    const slotEnd = new Date(`${date}T${String(s.h+1).padStart(2,'0')}:00:00`);
    const hit = bookings.find((b) => {
      if (!['pending','approved'].includes(b.status)) return false;
      return new Date(b.start_time) < slotEnd && new Date(b.end_time) > slotStart;
    });
    if (hit) {
      const cls = hit.status === 'approved' ? 'approved' : 'pending';
      cells.push(
        `<div class="cal-cell cal-busy ${cls}" style="grid-column: span 14" data-booking-id="${hit.id}">
          ${hit.title} — ${hit.user_name} (${hit.status})
        </div>`
      );
    } else {
      cells.push(`<div class="cal-cell" style="grid-column: span 14">—</div>`);
    }
  }
  cells.push('</div>');
  document.getElementById('calendar').innerHTML = cells.join('');
}

document.getElementById('btn-new-booking').addEventListener('click', () => {
  const roomOptions = state.rooms
    .map((r) => `<option value="${r.id}" ${r.id === state.selectedRoom ? 'selected' : ''}>${r.name}</option>`)
    .join('');
  const defaultStart = `${state.selectedDate}T08:00`;
  const defaultEnd = `${state.selectedDate}T10:00`;
  openModal(`
    <h3>Booking Ruangan Baru</h3>
    <form id="new-booking-form">
      <label>Ruangan<select name="room_id" required>${roomOptions}</select></label>
      <label>Judul Acara<input name="title" required placeholder="Misal: Kuliah Algoritma" /></label>
      <label>Deskripsi<textarea name="description" rows="2"></textarea></label>
      <label>Mulai<input name="start_time" type="datetime-local" value="${defaultStart}" required /></label>
      <label>Selesai<input name="end_time" type="datetime-local" value="${defaultEnd}" required /></label>
      <div class="form-actions">
        <button type="button" class="btn-secondary" data-close>Batal</button>
        <button type="submit" class="btn-primary">Ajukan</button>
      </div>
    </form>
  `);
  document.getElementById('new-booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/bookings', {
        method: 'POST',
        body: {
          room_id: Number(fd.get('room_id')),
          title: fd.get('title'),
          description: fd.get('description'),
          start_time: fd.get('start_time') + ':00',
          end_time: fd.get('end_time') + ':00',
        },
      });
      toast('Booking diajukan, menunggu persetujuan admin');
      closeModal();
      await renderCalendar();
    } catch (err) { toast(err.message, 'error'); }
  });
});

// ---------- My bookings ----------
function fmtDateTime(s) {
  return new Date(s).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function renderMyBookings() {
  const list = await api('/api/bookings?mine=1');
  const root = document.getElementById('my-bookings-list');
  if (!list.length) { root.innerHTML = '<div class="empty">Belum ada booking</div>'; return; }
  root.innerHTML = list.map((b) => `
    <div class="booking-card ${b.status}">
      <div>
        <strong>${b.title}</strong>
        <span class="status-badge status-${b.status}">${b.status}</span>
        <div class="meta">${b.room_name} • ${fmtDateTime(b.start_time)} – ${fmtDateTime(b.end_time)}</div>
        ${b.description ? `<div class="meta">${b.description}</div>` : ''}
        ${b.admin_note ? `<div class="meta">Catatan admin: ${b.admin_note}</div>` : ''}
      </div>
      <div class="actions">
        ${['pending','approved'].includes(b.status) ? `<button class="btn-danger" data-cancel="${b.id}">Batalkan</button>` : ''}
      </div>
    </div>
  `).join('');
  root.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Batalkan booking ini?')) return;
      try {
        await api(`/api/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST' });
        toast('Booking dibatalkan');
        renderMyBookings();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ---------- Approvals (admin) ----------
document.getElementById('approval-status').addEventListener('change', renderApprovals);

async function renderApprovals() {
  const status = document.getElementById('approval-status').value;
  const list = await api(`/api/bookings${status ? `?status=${status}` : ''}`);
  const root = document.getElementById('approvals-list');
  if (!list.length) { root.innerHTML = '<div class="empty">Tidak ada data</div>'; return; }
  root.innerHTML = list.map((b) => `
    <div class="booking-card ${b.status}">
      <div>
        <strong>${b.title}</strong>
        <span class="status-badge status-${b.status}">${b.status}</span>
        <div class="meta">Pemohon: ${b.user_name} (${b.username})</div>
        <div class="meta">${b.room_name} • ${fmtDateTime(b.start_time)} – ${fmtDateTime(b.end_time)}</div>
        ${b.description ? `<div class="meta">${b.description}</div>` : ''}
        ${b.admin_note ? `<div class="meta">Catatan: ${b.admin_note}</div>` : ''}
      </div>
      <div class="actions">
        ${b.status === 'pending' ? `
          <button class="btn-success" data-approve="${b.id}">Setujui</button>
          <button class="btn-danger" data-reject="${b.id}">Tolak</button>
        ` : ''}
      </div>
    </div>
  `).join('');
  root.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const note = prompt('Catatan persetujuan (opsional):') || '';
      try {
        await api(`/api/bookings/${btn.dataset.approve}/approve`, { method: 'POST', body: { note } });
        toast('Booking disetujui');
        renderApprovals();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  root.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const note = prompt('Alasan penolakan:') || '';
      try {
        await api(`/api/bookings/${btn.dataset.reject}/reject`, { method: 'POST', body: { note } });
        toast('Booking ditolak');
        renderApprovals();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ---------- Rooms management (admin) ----------
async function renderRooms() {
  const rooms = await api('/api/rooms/all');
  const root = document.getElementById('rooms-list');
  if (!rooms.length) { root.innerHTML = '<div class="empty">Belum ada ruangan</div>'; return; }
  root.innerHTML = rooms.map((r) => `
    <div class="room-card ${r.is_active ? '' : 'inactive'}">
      <div>
        <strong>${r.name}</strong> ${r.is_active ? '' : '<em>(nonaktif)</em>'}
        <div class="meta">${r.location || '-'} • Kapasitas ${r.capacity} orang</div>
        <div class="meta">${r.facilities || '-'}</div>
      </div>
      <div class="actions">
        <button class="btn-secondary" data-edit-room="${r.id}">Edit</button>
        <button class="btn-danger" data-del-room="${r.id}">Hapus</button>
      </div>
    </div>
  `).join('');
  root.querySelectorAll('[data-edit-room]').forEach((btn) => {
    btn.addEventListener('click', () => roomForm(rooms.find((r) => r.id === Number(btn.dataset.editRoom))));
  });
  root.querySelectorAll('[data-del-room]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus ruangan ini? Booking terkait juga ikut terhapus.')) return;
      try {
        await api(`/api/rooms/${btn.dataset.delRoom}`, { method: 'DELETE' });
        toast('Ruangan dihapus');
        await loadRooms();
        renderRooms();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

document.getElementById('btn-new-room').addEventListener('click', () => roomForm(null));

function roomForm(room) {
  const isEdit = !!room;
  openModal(`
    <h3>${isEdit ? 'Edit' : 'Tambah'} Ruangan</h3>
    <form id="room-form">
      <label>Nama<input name="name" required value="${room?.name || ''}" /></label>
      <label>Lokasi<input name="location" value="${room?.location || ''}" /></label>
      <label>Kapasitas<input name="capacity" type="number" min="0" value="${room?.capacity || 0}" /></label>
      <label>Fasilitas<input name="facilities" value="${room?.facilities || ''}" placeholder="Proyektor, AC, ..." /></label>
      ${isEdit ? `<label><input type="checkbox" name="is_active" ${room.is_active ? 'checked' : ''} /> Aktif</label>` : ''}
      <div class="form-actions">
        <button type="button" class="btn-secondary" data-close>Batal</button>
        <button type="submit" class="btn-primary">Simpan</button>
      </div>
    </form>
  `);
  document.getElementById('room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'),
      location: fd.get('location'),
      capacity: Number(fd.get('capacity')),
      facilities: fd.get('facilities'),
    };
    if (isEdit) body.is_active = fd.get('is_active') === 'on';
    try {
      if (isEdit) await api(`/api/rooms/${room.id}`, { method: 'PUT', body });
      else await api('/api/rooms', { method: 'POST', body });
      toast('Ruangan tersimpan');
      closeModal();
      await loadRooms();
      renderRooms();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- Bootstrap ----------
(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (user) { state.user = user; await enterApp(); }
  } catch {}
})();
