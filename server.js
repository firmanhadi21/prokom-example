const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin' });
  next();
}

// ---------- Auth ----------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, full_name } = req.body || {};
  if (!username || !password || !full_name) return res.status(400).json({ error: 'Semua field wajib diisi' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Username sudah dipakai' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run(username, hash, full_name, 'user');
  req.session.user = { id: result.lastInsertRowid, username, full_name, role: 'user' };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---------- Rooms ----------
app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms WHERE is_active = 1 ORDER BY name').all();
  res.json(rooms);
});

app.get('/api/rooms/all', requireAdmin, (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
  res.json(rooms);
});

app.post('/api/rooms', requireAdmin, (req, res) => {
  const { name, location, capacity, facilities } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nama ruangan wajib' });
  const result = db
    .prepare('INSERT INTO rooms (name, location, capacity, facilities) VALUES (?, ?, ?, ?)')
    .run(name, location || '', Number(capacity) || 0, facilities || '');
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/rooms/:id', requireAdmin, (req, res) => {
  const { name, location, capacity, facilities, is_active } = req.body || {};
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
  db.prepare(
    'UPDATE rooms SET name = ?, location = ?, capacity = ?, facilities = ?, is_active = ? WHERE id = ?'
  ).run(
    name ?? existing.name,
    location ?? existing.location,
    capacity !== undefined ? Number(capacity) : existing.capacity,
    facilities ?? existing.facilities,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    id
  );
  res.json({ ok: true });
});

app.delete('/api/rooms/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Bookings ----------
function overlapExists(roomId, start, end, excludeId = 0) {
  return db
    .prepare(
      `SELECT id FROM bookings
       WHERE room_id = ? AND id != ? AND status IN ('pending','approved')
         AND NOT (end_time <= ? OR start_time >= ?)
       LIMIT 1`
    )
    .get(roomId, excludeId, start, end);
}

app.get('/api/bookings', requireAuth, (req, res) => {
  const { room_id, from, to, mine, status } = req.query;
  const where = [];
  const params = [];
  if (room_id) { where.push('b.room_id = ?'); params.push(Number(room_id)); }
  if (from) { where.push('b.end_time > ?'); params.push(from); }
  if (to) { where.push('b.start_time < ?'); params.push(to); }
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (mine === '1') { where.push('b.user_id = ?'); params.push(req.session.user.id); }
  const sql = `
    SELECT b.*, r.name AS room_name, u.full_name AS user_name, u.username
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    JOIN users u ON u.id = b.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY b.start_time DESC
  `;
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/bookings', requireAuth, (req, res) => {
  const { room_id, title, description, start_time, end_time } = req.body || {};
  if (!room_id || !title || !start_time || !end_time) {
    return res.status(400).json({ error: 'room_id, title, start_time, end_time wajib diisi' });
  }
  if (new Date(start_time) >= new Date(end_time)) {
    return res.status(400).json({ error: 'Waktu mulai harus sebelum waktu selesai' });
  }
  if (new Date(start_time) < new Date(Date.now() - 60_000)) {
    return res.status(400).json({ error: 'Tidak bisa booking di masa lalu' });
  }
  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND is_active = 1').get(Number(room_id));
  if (!room) return res.status(404).json({ error: 'Ruangan tidak tersedia' });
  if (overlapExists(Number(room_id), start_time, end_time)) {
    return res.status(409).json({ error: 'Jadwal bentrok dengan booking lain' });
  }
  const result = db
    .prepare(
      `INSERT INTO bookings (room_id, user_id, title, description, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(Number(room_id), req.session.user.id, title, description || '', start_time, end_time);
  res.json({ id: result.lastInsertRowid, status: 'pending' });
});

app.post('/api/bookings/:id/cancel', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (booking.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Tidak diizinkan' });
  }
  if (!['pending', 'approved'].includes(booking.status)) {
    return res.status(400).json({ error: 'Status tidak dapat dibatalkan' });
  }
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('cancelled', id);
  res.json({ ok: true });
});

app.post('/api/bookings/:id/approve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (booking.status !== 'pending') return res.status(400).json({ error: 'Status bukan pending' });
  if (overlapExists(booking.room_id, booking.start_time, booking.end_time, id)) {
    return res.status(409).json({ error: 'Bentrok dengan booking lain yang sudah disetujui' });
  }
  db.prepare('UPDATE bookings SET status = ?, admin_note = ? WHERE id = ?').run(
    'approved',
    req.body?.note || '',
    id
  );
  res.json({ ok: true });
});

app.post('/api/bookings/:id/reject', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (booking.status !== 'pending') return res.status(400).json({ error: 'Status bukan pending' });
  db.prepare('UPDATE bookings SET status = ?, admin_note = ? WHERE id = ?').run(
    'rejected',
    req.body?.note || '',
    id
  );
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Sistem booking ruangan berjalan di http://localhost:${PORT}`);
});
