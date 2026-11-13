#!/usr/bin/env bash
# Run ON THE SERVER after the new code is in ~/LifeTime-main (unzip or git pull).
set -euo pipefail
cd ~/LifeTime-main/backend
npm ci
npx prisma migrate deploy
npm run build
sudo systemctl restart lifetime
sleep 3
systemctl is-active lifetime
curl -s localhost:3001/api/health
echo
