# Live Deploy Checklist: API 404 / Old Data on Production

Use this checklist when live admin shows errors like:

- `Cannot PUT /api/voice-assistant`
- `Cannot PUT /api/support-team`
- `Unexpected token '<' ... is not valid JSON`

These errors mean production is returning HTML error pages for API calls (old/wrong backend process), not JSON.

## 1) Upload full backend + frontend changes together

Do not upload only `public/` files. Upload these from local project:

- `server.js`
- `package.json`
- `package-lock.json`
- `public/` (all changed files)
- `database.db` (if you want latest edited data/content to appear live)

Recommended local command (creates one zip with all required files):

```bash
npm run deploy:pack
```

## 2) Install/update dependencies on server

```bash
npm install --omit=dev
```

## 3) Confirm startup file and running process

Startup file must be `server.js`.

### PM2

```bash
pm2 list
pm2 show <app-name-or-id>
pm2 restart <app-name-or-id>
pm2 save
```

### cPanel Node App / Passenger

- cPanel -> Setup Node.js App
- Startup file: `server.js`
- Click `Restart`

## 4) Verify live endpoints immediately after restart

Run from this repo:

```bash
./scripts/verify-live-api.sh https://softwarezoneinworld.store
```

Required endpoints must be `200` and `JSON=yes` (not FASTPANEL HTML):

- `/api/runtime-health`
- `/api/voice-assistant`
- `/api/support-team`
- `/api/service-voice-assistant?service_key=phone-service`
- `/api/tools-content`
- `/api/app-download`
- `/api/notifications/latest`

## 5) If some endpoints are still 404

- Domain may be pointing to another old Node app.
- Multiple Node instances may exist; restart all.
- Reverse proxy may target wrong app/port/path.
- cPanel app root may be wrong folder.

## 6) Data not updating after local edit

When you edit locally and want same data live:

1. Stop app on server.
2. Upload updated code and updated `database.db`.
3. Restart app.
4. Re-run `verify-live-api.sh`.
