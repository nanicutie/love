require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES, 10) || 15 * 1024 * 1024; // 15MB default

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set it to your Postgres connection string (see .env.example).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES }
});

function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS letter (
      id INT PRIMARY KEY DEFAULT 1,
      content TEXT
    );
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '💕',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      mimetype TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   SETTINGS
   ============================================================ */
app.get('/api/settings', async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='app'");
    res.json(rows.length ? JSON.parse(rows[0].value) : {});
  } catch (e) { next(e); }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const value = JSON.stringify(req.body || {});
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('app', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [value]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ============================================================
   LETTER
   ============================================================ */
app.get('/api/letter', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT content FROM letter WHERE id=1');
    res.json({ content: rows.length ? rows[0].content : null });
  } catch (e) { next(e); }
});

app.put('/api/letter', async (req, res, next) => {
  try {
    const content = (req.body && typeof req.body.content === 'string') ? req.body.content : '';
    await pool.query(
      `INSERT INTO letter (id, content) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`,
      [content]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/letter', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM letter WHERE id=1');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ============================================================
   SONGS
   ============================================================ */
app.get('/api/songs', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, title FROM songs ORDER BY created_at ASC');
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/songs', upload.array('songs', 30), async (req, res, next) => {
  try {
    const files = req.files || [];
    const out = [];
    for (const f of files) {
      const id = newId('song');
      const title = f.originalname.replace(/\.[^/.]+$/, '');
      await pool.query(
        'INSERT INTO songs (id, title, mimetype, data) VALUES ($1,$2,$3,$4)',
        [id, title, f.mimetype || 'audio/mpeg', f.buffer]
      );
      out.push({ id, title });
    }
    res.json(out);
  } catch (e) { next(e); }
});

app.delete('/api/songs/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM songs WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/songs/:id/stream', async (req, res, next) => {
  const startTime = Date.now();
  console.log(`STREAM START ${req.params.id} range=${req.headers.range || 'none'}`);
  try {
    const { rows } = await pool.query('SELECT mimetype, data FROM songs WHERE id=$1', [req.params.id]);
    if (!rows.length) {
      console.log(`STREAM MISSING ${req.params.id}`);
      return res.status(404).end();
    }
    const { mimetype, data } = rows[0];
    const buf = data;
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : buf.length - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${buf.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mimetype
      });
      res.end(buf.slice(start, end + 1));
      console.log(`STREAM SENT ${req.params.id} bytes=${start}-${end} time=${Date.now()-startTime}ms`);
    } else {
      res.writeHead(200, {
        'Content-Length': buf.length,
        'Content-Type': mimetype,
        'Accept-Ranges': 'bytes'
      });
      res.end(buf);
      console.log(`STREAM SENT ${req.params.id} bytes=full time=${Date.now()-startTime}ms`);
    }
  } catch (e) {
    console.error(`STREAM ERROR ${req.params.id}`, e);
    next(e);
  }
});

/* ============================================================
   ALBUMS + PHOTOS
   ============================================================ */
app.get('/api/albums', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.name, a.emoji, COUNT(p.id)::int AS "photoCount"
      FROM albums a LEFT JOIN photos p ON p.album_id = a.id
      GROUP BY a.id, a.name, a.emoji, a.created_at
      ORDER BY a.created_at ASC
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/albums', async (req, res, next) => {
  try {
    const { name, emoji } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const id = newId('album');
    const finalEmoji = emoji || '💕';
    await pool.query('INSERT INTO albums (id, name, emoji) VALUES ($1,$2,$3)', [id, name.trim(), finalEmoji]);
    res.json({ id, name: name.trim(), emoji: finalEmoji, photoCount: 0 });
  } catch (e) { next(e); }
});

app.delete('/api/albums/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM albums WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/albums/:id/photos', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id FROM photos WHERE album_id=$1 ORDER BY created_at ASC', [req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/albums/:id/photos', upload.array('photos', 30), async (req, res, next) => {
  try {
    const albumId = req.params.id;
    const { rows } = await pool.query('SELECT id FROM albums WHERE id=$1', [albumId]);
    if (!rows.length) return res.status(404).json({ error: 'album not found' });
    const files = req.files || [];
    const out = [];
    for (const f of files) {
      const id = newId('photo');
      await pool.query(
        'INSERT INTO photos (id, album_id, mimetype, data) VALUES ($1,$2,$3,$4)',
        [id, albumId, f.mimetype || 'image/jpeg', f.buffer]
      );
      out.push({ id });
    }
    res.json(out);
  } catch (e) { next(e); }
});

app.delete('/api/photos/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM photos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/photos/:id/file', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT mimetype, data FROM photos WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    res.writeHead(200, { 'Content-Type': rows[0].mimetype, 'Cache-Control': 'public, max-age=86400' });
    res.end(rows[0].data);
  } catch (e) { next(e); }
});

// Simple link endpoints: return link info and redirect to local app
app.get('/api/link', (req, res) => {
  res.json({ url: 'http://localhost:3001', text: 'Localhost' });
});

app.get('/go-local', (req, res) => {
  res.redirect('http://localhost:3001');
});

/* ============================================================
   ERROR HANDLER
   ============================================================ */
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`💕 Monthsary app listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to initialize database:', e);
    process.exit(1);
  });
