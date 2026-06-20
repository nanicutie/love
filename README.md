# 💕 Monthsary App — with a real backend

This is your monthsary site, now with an actual server + database behind it.
Songs, photos, the letter, and your settings are saved in a **Postgres
database**, not in the browser — so nothing disappears when you refresh,
close the tab, or open it on a different phone/laptop.

Every screen also now has a delete button:
- 🗑 next to each song in the playlist
- 🗑 in the photo lightbox (top controls)
- 🗑 on each album card (deletes the whole album + its photos)
- "CLEAR 🗑" button on the Letter tab

## Why a database, and not just files saved on disk?

Render's **free** web services don't keep a persistent disk — every time the
app redeploys or spins down from inactivity, anything saved to the local
filesystem is wiped. A database is the one piece of storage that *does*
survive that, and it's free too. So this app stores everything (settings,
the letter, and the actual song/photo files) inside Postgres. That also
means you can swap hosts later (Railway, your own VPS, etc.) without
touching the code — just point `DATABASE_URL` at wherever your database is.

## 1. Get a free Postgres database

Pick one (both have a free tier that doesn't expire):

- **Neon** → https://neon.tech → "Create a project" → copy the connection
  string it gives you (starts with `postgresql://...`)
- **Supabase** → https://supabase.com → "New project" → Project Settings →
  Database → copy the "Connection string" (URI, with the password filled in)

You'll get something like:
```
postgresql://user:password@host.neon.tech/dbname?sslmode=require
```
Keep this safe — you'll paste it into Render in step 3. You don't need to
create any tables yourself; the app creates them automatically on first run.

## 2. Put this code on GitHub

1. Create a new repo on GitHub (can be private).
2. Upload everything in this folder to that repo (or `git init`, `git add .`,
   `git commit -m "init"`, `git push`).
   - Don't worry about `node_modules` — it's excluded via `.gitignore`, and
     Render installs dependencies itself.

## 3. Deploy on Render

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo.
3. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (you can upgrade later to avoid spin-down)
4. Under **Environment Variables**, add:
   - `DATABASE_URL` = the connection string from step 1
5. Click **Deploy**. After the build finishes, Render gives you a live URL
   like `https://your-app.onrender.com` — that's your monthsary site.

That's it — open the link, set your names/date in ⚙️ Settings, and start
adding songs, photos, and your letter. They'll stay there.

## Good to know about the free plan

- The free Render instance "sleeps" after ~15 minutes without traffic. The
  next visit takes ~30–60 seconds to wake back up — totally fine for a
  personal site, just don't be alarmed by the first load.
- If you want it always-on with no wake-up delay, upgrade the Render service
  to the **Starter** plan (~$7/mo). No code changes needed — same
  `DATABASE_URL` setup.
- Per-file upload limit is 15MB (adjustable via the `MAX_FILE_BYTES`
  environment variable, in bytes).

## Running it on your own computer first (optional)

```bash
npm install
cp .env.example .env
# edit .env and paste your DATABASE_URL
npm start
```
Then open http://localhost:3000

## Project structure

```
server.js          → Express backend + all API routes
public/index.html  → the frontend (same look, now talks to the backend)
package.json       → dependencies (express, multer, pg, dotenv)
.env.example        → template for local environment variables
```
