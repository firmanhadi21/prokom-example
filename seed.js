const bcrypt = require('bcryptjs');
const db = require('./db');

const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
  );
  insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'Administrator', 'admin');
  insertUser.run('mahasiswa', bcrypt.hashSync('mhs123', 10), 'Mahasiswa Demo', 'user');
  insertUser.run('dosen', bcrypt.hashSync('dsn123', 10), 'Dosen Demo', 'user');
  console.log('Seeded users: admin/admin123, mahasiswa/mhs123, dosen/dsn123');
}

const roomCount = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
if (roomCount === 0) {
  const insertRoom = db.prepare(
    'INSERT INTO rooms (name, location, capacity, facilities) VALUES (?, ?, ?, ?)'
  );
  insertRoom.run('Ruang Kelas A101', 'Gedung A Lantai 1', 40, 'Proyektor, AC, Whiteboard');
  insertRoom.run('Ruang Kelas A102', 'Gedung A Lantai 1', 40, 'Proyektor, AC');
  insertRoom.run('Lab Komputer B201', 'Gedung B Lantai 2', 30, '30 PC, Proyektor, AC');
  insertRoom.run('Auditorium Utama', 'Gedung C Lantai 1', 200, 'Sound system, Proyektor, Panggung');
  insertRoom.run('Ruang Rapat Dosen', 'Gedung A Lantai 3', 15, 'TV, AC, Meja rapat');
  console.log('Seeded 5 rooms');
}

console.log('Seed selesai.');
