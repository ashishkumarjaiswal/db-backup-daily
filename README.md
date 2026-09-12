# Daily MongoDB backup

A Node.js script that reads `MONGODB_URI` from the environment (or a local `.env` file), dumps the database with `mongodump`, and stores a gzip archive on disk. The container keeps running and takes a new backup every 24 hours.

## What you get

- One `.archive.gz` file per run, named like `mongodb-all-2026-09-12T070000Z.archive.gz`
- Optional single-database dumps via `MONGO_DB`
- Archives are kept forever; nothing is deleted automatically
- A first backup as soon as the container starts
- Ready to deploy on Coolify with a persistent host folder

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` or `MONGO_URL` | yes | — | MongoDB / Atlas connection string |
| `MONGO_DB` | no | empty (all DBs) | Dump only this database |
| `BACKUP_HOST_PATH` | no | `./backups` | Folder on the laptop/server that stores archives |
| `BACKUP_DIR` | no | `/backups` | Path inside the container |
| `BACKUP_PREFIX` | no | `mongodb` | Filename prefix |
| `BACKUP_INTERVAL_HOURS` | no | `24` | Hours between backups |
| `RUN_ON_START` | no | `true` | Take a backup immediately on boot |
| `TZ` | no | `UTC` | Container timezone for logs |

Copy `.env.example` to `.env` and put your real URI there. Never commit `.env`.

## Run locally

```bash
cp .env.example .env
# edit .env and set MONGODB_URI

docker compose up --build
```

Archives appear in `./backups`. One-off dump without the scheduler:

```bash
docker compose run --rm backup node backup.js --once
```

Without Docker (needs `mongodump` on your PATH):

```bash
npm install
npm start          # scheduler
npm run backup     # one-off dump
```

## Deploy on Coolify (laptop)

Coolify should already be installed and your laptop added as the destination server.

1. Push this repo to GitHub (the project already has a remote).
2. In Coolify: **+ New** → your Git repository.
3. Set **Build Pack** to **Docker Compose**.
4. Set **Docker Compose Location** to `/docker-compose.yml`.
5. Open **Environment Variables** and add:
   - `MONGODB_URI` — mark it as a secret
   - `BACKUP_HOST_PATH` — `/media/ashish/External1/db_backup_daily` if Coolify runs on Linux with that disk mounted. On this Mac, use the `/Volumes/...` path instead.
   - optional: `MONGO_DB`, `TZ=Asia/Kolkata`
6. Deploy.

Use an absolute `BACKUP_HOST_PATH`. A relative `./backups` path is fine for local compose, but Coolify clones the repo into a deploy directory that can be replaced. An absolute path keeps backups after redeploys.

If MongoDB Atlas rejects the dump, add this laptop's public IP to the Atlas Network Access list.

### Optional: Coolify Scheduled Tasks

The container already schedules backups itself. If you prefer Coolify's scheduler instead:

1. Set `RUN_ON_START=false` so it does not double-run.
2. Open the application → **Configuration → Scheduled Tasks → + Add**.
3. Command: `node backup.js --once`
4. Frequency: `0 2 * * *` (02:00 in the server timezone) or `daily`.
5. Timeout: `3600` or higher for large databases.
6. Save, then **Execute Now** once to confirm.

## Restore a backup

```bash
mongorestore \
  --uri="$MONGODB_URI" \
  --gzip \
  --archive=/path/to/mongodb-all-2026-09-12T070000Z.archive.gz
```

To restore one database into a new name:

```bash
mongorestore \
  --uri="$MONGODB_URI" \
  --gzip \
  --archive=/path/to/mongodb-mydb-2026-09-12T070000Z.archive.gz \
  --nsFrom="mydb.*" \
  --nsTo="mydb_restored.*"
```
