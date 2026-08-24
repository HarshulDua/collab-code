# Deploying to AWS (EC2) with GitHub Actions CI/CD

This is a runbook for the deployment topology this project actually runs:
**one EC2 instance running both the server and client as containers**,
with Caddy as the reverse proxy and automatic TLS (see `ARCHITECTURE.md`
§17.3 for the full narrative, including the bugs found getting here). It
does not use S3/CloudFront — an earlier draft of this document described
that as the client-hosting path, but the deployed reality is simpler: both
halves are containers on the same box, kept in sync by one CI/CD job.

Every step below uses an IAM user/role, never the root account. If you
pasted your root password anywhere outside the AWS console, rotate it now
(IAM → Security credentials → root user → change password) before doing
anything else here.

## 1. Create an IAM user for setup (not root)

AWS Console → IAM → Users → Create user → name it e.g. `deploy-admin` →
attach `AdministratorAccess` temporarily (only for the setup steps below;
tighten afterward). Generate an access key if you want to run AWS CLI
commands from your own machine instead of clicking through the console.

## 2. EC2 instance (server + client + Mongo/Redis via docker-compose)

- EC2 → Launch instance → Ubuntu 22.04 LTS, `t3.small` or larger (the
  execution sandbox needs real CPU/memory headroom — see `ARCHITECTURE.md`
  §7, and §7.10 for why compiled languages specifically need more than the
  smallest instance sizes).
- Security group: allow inbound 22 (SSH, restrict to your IP), 443 (HTTPS),
  80 (HTTP, for the ACME/Let's Encrypt challenge).
- Create/attach an SSH key pair — you'll need the private key for step 4.
- Once running, SSH in and install Docker + Docker Compose + Caddy:
  ```
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  sudo apt-get install -y docker-compose-plugin caddy
  ```
- Clone the repo and create the production env file (this file stays on the
  server only — never in GitHub):
  ```
  sudo mkdir -p /opt/collab-code && sudo chown $USER /opt/collab-code
  git clone git@github.com:HarshulDua/collab-code.git /opt/collab-code
  cd /opt/collab-code
  ```
  Create `/opt/collab-code/.env.prod`:
  ```
  CLIENT_ORIGIN=https://<your-domain-or-elastic-ip>.nip.io
  JWT_SECRET=<generate: openssl rand -hex 32>
  GIT_TOKEN_ENCRYPTION_KEY=<generate: openssl rand -hex 32>
  ADMIN_EMAIL=<the email you registered with in the app>
  EXEC_HOST_TMP_DIR=/opt/collab-exec-shared
  DOCKER_GID=<run: getent group docker | cut -d: -f3>
  ```
  `ADMIN_EMAIL` must exactly match the email of the account you'll log into
  the deployed app with — that's what `/admin` checks (`ARCHITECTURE.md`
  §16.1). No domain to register? `<elastic-ip>.nip.io` resolves straight
  back to that IP with zero setup and still gets Caddy a real Let's Encrypt
  cert (`ARCHITECTURE.md` §17.3) — what this project's own live deployment
  actually uses.
- The server container runs code execution as an unprivileged `app` user,
  which needs two things on the host to actually reach the sandbox (found
  the hard way — see `ARCHITECTURE.md` §17.3 for the full debugging story):
  ```
  sudo mkdir -p /opt/collab-exec-shared
  sudo chown 100:101 /opt/collab-exec-shared   # matches the container's `app` uid:gid
  ```
  and `DOCKER_GID` above (the host's `docker` group id) so that user can
  reach `/var/run/docker.sock` — both are required for `execution:run` to
  work at all; skip either and every execution fails with a generic
  "Execution failed" (the real `EACCES` only shows up in
  `docker logs collab-server-prod`).
- Build the sandbox image once:
  `docker build -t collab-sandbox:latest -f docker/sandbox.Dockerfile docker/`
- First manual start:
  `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build server client mongo redis`
- Point Caddy at both containers — `/etc/caddy/Caddyfile`:
  ```
  <your-domain-or-elastic-ip>.nip.io {
      handle /api/* {
          reverse_proxy localhost:4000
      }
      handle /socket.io/* {
          reverse_proxy localhost:4000
      }
      handle {
          reverse_proxy localhost:8080
      }
  }
  ```
  then `sudo systemctl reload caddy`. Caddy issues and renews the TLS
  certificate automatically — no separate certbot step.

## 3. GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `EC2_HOST` | your EC2 instance's public IP or domain |
| `EC2_USER` | `ubuntu` (default for Ubuntu AMIs) |
| `EC2_SSH_PRIVATE_KEY` | the private key from step 2, full contents |

That's the whole list — no AWS OIDC role, no S3 bucket, no CloudFront. An
earlier version of this pipeline had a separate `deploy-client` job pushing
to S3 with a five-secret AWS role setup; it was removed because nothing
was actually configured for it (no bucket, no OIDC role) and — the part
that would have stayed silently wrong even after wiring those up — Caddy
was never pointed at S3 in the first place, so that job going green would
never have actually updated what a real visitor sees. See
`ARCHITECTURE.md` §17.3 for the full story of finding and fixing this.

## 4. Verify the pipeline

Push any commit to `main` → the `CI` workflow (`.github/workflows/ci.yml`)
runs the server and client test jobs first, then — only on `main`, only if
both pass — its `deploy` job SSHes into EC2, rebuilds the sandbox image,
and brings up `server`, `client`, `mongo`, `redis` together via
`docker compose ... up -d --build`, so both halves of the app always
redeploy in the same step and never drift out of sync with each other.
Check the Actions tab on GitHub for the run.

## 5. Confirm the admin dashboard works in production

Register/log in on the deployed app using the exact email set as
`ADMIN_EMAIL` in `.env.prod`, then visit `/admin` — you should see the real
live rooms/users/logs from the production server (`ARCHITECTURE.md` §16).

## What this buys you going forward

Every `git push` to `main` (once merged from wherever you actually work)
rebuilds and redeploys the whole app automatically — no manual EC2 SSH
session needed after this initial setup. The one thing that stays manual
on purpose: `.env.prod` on the EC2 host, so secrets never pass through
GitHub Actions logs or repo history at all.
