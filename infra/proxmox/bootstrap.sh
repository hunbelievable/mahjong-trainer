#!/usr/bin/env bash
# =============================================================================
# Run ONCE on the freshly-created LXC (as root), after `terraform apply`:
#
#   ssh root@<container-ip> 'bash -s' < infra/proxmox/bootstrap.sh
#
# Installs Docker (official apt repo, not the curl|sh convenience script),
# clones the repo, and scaffolds a .env file. Deliberately does NOT run
# `docker compose up` — that needs real secrets (AUTH_SECRET, Google OAuth
# creds) filled in first, which is a manual step (see the printed next-steps).
#
# Idempotent — safe to re-run.
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/hunbelievable/mahjong-trainer.git}"
APP_DIR="${APP_DIR:-/opt/mahjong-trainer}"

echo "==> Installing prerequisites"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git

echo "==> Installing Docker (official apt repo)"
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
fi

apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> Cloning the repo"
if [ -d "${APP_DIR}/.git" ]; then
  git -C "${APP_DIR}" pull
else
  git clone "${REPO_URL}" "${APP_DIR}"
fi

echo "==> Scaffolding .env"
if [ ! -f "${APP_DIR}/.env" ]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  echo "    Created ${APP_DIR}/.env from .env.example — it still needs real values."
else
  echo "    ${APP_DIR}/.env already exists — left untouched."
fi

cat <<EOT

==> Bootstrap complete.

Docker is installed and running. The repo is at ${APP_DIR}.

Next (manual — needs real secrets, not something to automate):
  1. Edit ${APP_DIR}/.env and fill in:
       - DATABASE_URL (or leave the default; docker-compose provisions Postgres)
       - AUTH_SECRET       — generate with: npx auth secret
       - AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET — from Google Cloud Console
         (OAuth client, authorized redirect URI:
          https://<this-box's-domain>/api/auth/callback/google)
       - NATS_URL — leave as nats://nats:4222 (docker-compose provisions NATS)
  2. cd ${APP_DIR} && docker compose up -d
  3. docker compose logs -f app   # confirm it comes up clean

EOT
