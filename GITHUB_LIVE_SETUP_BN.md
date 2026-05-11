# GitHub + Auto Live Deploy Setup (Bangla)

এই ফাইলের ধাপগুলো একবার ঠিকমতো করলে, এরপর `main` ব্রাঞ্চে push দিলেই live server আপডেট হবে।

## 1) GitHub-এ নতুন repository create

- Repository name: `softwarezoneinworld` (বা তোমার পছন্দমতো)
- Visibility: Public বা Private (যেটা চাও)
- `Add README`: **Off**
- `.gitignore`: **No .gitignore**
- License: **No license**

তারপর `Create repository` চাপো।

## 2) Local project থেকে প্রথম push

টার্মিনাল থেকে এই command চালাও (তোমার repository URL বসিয়ে):

```bash
cd "/Users/muhammadrasel/Desktop/ softwarezoneinworld"
git init
git branch -M main
git add .
git commit -m "Initial commit: project + GitHub deploy workflow"
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```

## 3) GitHub Secrets সেট করা (অত্যন্ত জরুরি)

GitHub repo -> `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

এইগুলো add করো:

- `SSH_HOST` = তোমার live server host/ip
- `SSH_PORT` = `22` (বা custom port)
- `SSH_USER` = server SSH username
- `SSH_PRIVATE_KEY` = private key content (পুরো key)
- `APP_DIR` = server-এ app folder path (যেমন `/home/deploy/softwarezoneinworld`)
- `RESTART_CMD` = app restart command  
  example: `pm2 restart softwarezoneinworld || pm2 start server.js --name softwarezoneinworld && pm2 save`
- `LIVE_URL` = `https://softwarezoneinworld.store` (optional but recommended)

## 4) Server-এ একবার prepare

SSH দিয়ে server-এ গিয়ে:

```bash
mkdir -p /home/deploy/softwarezoneinworld
cd /home/deploy/softwarezoneinworld
```

`APP_DIR` secret-এ এই path-টাই দেবে।

## 5) Deploy test

Repo -> `Actions` -> `Deploy Live Server` -> `Run workflow`

success হলে live site update হবে।

## 6) এরপর নিয়মিত update flow

লোকালে change করার পর:

```bash
git add .
git commit -m "your update message"
git push origin main
```

push হলেই GitHub Action auto deploy করবে।

## 7) 1-command update (সহজ উপায়)

আরও সহজভাবে (commit + push একসাথে):

```bash
bash scripts/update-and-deploy.sh "your update message"
```

message না দিলে current date-time দিয়ে commit করবে।

## Notes

- `.gitignore` এ `database.db` ignore করা আছে (ডাটা leak না করার জন্য)।
- যদি live-এ local DB data তুলতে চাও, আলাদা করে `database.db` upload করতে হবে।
