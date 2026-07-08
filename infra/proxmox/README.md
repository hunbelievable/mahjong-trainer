# Proxmox dev/deploy box

Terraform for a single Debian 12 LXC on your Proxmox host, sized to run the
full docker-compose stack (app + Postgres + NATS). Deliberately scoped:
Terraform creates the container; a separate `bootstrap.sh` installs Docker and
clones the repo; filling in real secrets and the first `docker compose up` are
manual, on purpose — see [docs/multiplayer-design.md](../../docs/multiplayer-design.md)
for why the app needs this box at all (Google OAuth's redirect URI and
Cloudflare Tunnel both want a stable target, not a laptop that sleeps or
changes networks).

## Why a privileged container

Docker inside an LXC needs `unprivileged = false` with `nesting`/`keyctl`
enabled — an unprivileged container's restrictions conflict with Docker's
overlay filesystem. This is set in `main.tf`; you don't need to do anything,
just know why the container isn't unprivileged like a typical LXC.

## One-time setup

1. **Install Terraform** (or OpenTofu) on your laptop — not on Proxmox itself.

2. **Create a Proxmox API token**: Datacenter → Permissions → API Tokens → Add.
   Give it a role with permission to create/manage containers (e.g. `PVEVMAdmin`
   on `/`, or a narrower custom role if you'd rather scope it down). Uncheck
   "Privilege Separation" only if you understand the tradeoff — the example
   below assumes it's checked (the token needs its own explicit permissions).

3. **Copy the vars file and fill it in:**
   ```
   cd infra/proxmox
   cp terraform.tfvars.example terraform.tfvars
   ```
   Edit `terraform.tfvars`: your Proxmox API URL, the token, your node name,
   and your SSH public key. `terraform.tfvars` is gitignored — it holds real
   credentials, never commit it.

4. **Apply:**
   ```
   terraform init
   terraform plan
   terraform apply
   ```
   This downloads the Debian 12 LXC template (if not already cached on your
   node) and creates the container. Takes a few minutes the first time
   (template download), seconds after that.

   If the template download 404s, Proxmox has likely rotated the version —
   see the comment on `var.debian_template_version` in `variables.tf`.

5. **Reserve a DHCP lease** for the container in your router, using its MAC
   address (Proxmox UI → the CT → Hardware → Network Device). This is what
   you asked for by choosing DHCP-reservation over a static IP in the
   Terraform config itself — same practical result (a stable address), set at
   your router instead of baked into this repo.

6. **Bootstrap it** (installs Docker, clones the repo):
   ```
   ssh root@<container-ip> 'bash -s' < bootstrap.sh
   ```

7. **Fill in secrets and start the stack** — printed at the end of step 6's
   output, also in `.env.example` at the repo root. Then:
   ```
   ssh root@<container-ip>
   cd /opt/mahjong-trainer
   docker compose up -d
   docker compose logs -f app
   ```

## Re-applying / changing the box

Edit the `.tf` files or `terraform.tfvars` and run `terraform apply` again —
e.g. to bump `cpu_cores`/`memory_mb`/`disk_gb` if the stack needs more
headroom. Terraform will show a plan before changing anything.

## Not in scope here (yet)

- **Cloudflare Tunnel** — set up separately, pointed at this box's IP once
  it's up (design doc §4). Not part of this Terraform module since it's a
  Cloudflare-account-level resource, not a Proxmox one.
- **NATS/Postgres data backups** — the docker-compose volumes are local to
  this box; no off-box backup is wired up yet.
