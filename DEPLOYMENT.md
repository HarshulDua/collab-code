# Deploying to AWS (EC2 + S3) with GitHub Actions CI/CD

This is a runbook, not something already executed — it needs actions taken
inside your AWS console with your own login, which nothing outside your
own browser session can do. Every step below uses an IAM user/role, never
the root account. If you pasted your root password anywhere outside the
AWS console, rotate it now (IAM → Security credentials → root user →
change password) before doing anything else here.

## 1. Create an IAM user for one-time setup (not root)

AWS Console → IAM → Users → Create user → name it e.g. `deploy-admin` →
attach `AdministratorAccess` temporarily (only for the setup steps below;
you can tighten this afterward). Generate an access key for CLI use if you
want to run the AWS CLI commands below from your own machine instead of
clicking through the console — either works.

## 2. S3 bucket for the client (static files)

- S3 → Create bucket → globally unique name (e.g. `collab-code-client-<yourname>`) → your preferred region.
- Enable **Static website hosting** (bucket Properties tab), index document `index.html`, error document `index.html` (needed so React Router's client-side routes don't 404 on refresh).
- Bucket policy → allow public `s3:GetObject` (or, better, put CloudFront in front and keep the bucket private — CloudFront is optional but recommended for HTTPS, which `getUserMedia`/camera access requires per `ARCHITECTURE.md` §17).

## 3. EC2 instance for the server (+ Mongo/Redis via docker-compose)

- EC2 → Launch instance → Ubuntu 22.04 LTS, `t3.small` or larger (the execution sandbox needs real CPU/memory headroom — see `ARCHITECTURE.md` §7).
- Security group: allow inbound 22 (SSH, restrict to your IP), 443 (HTTPS), 80 (HTTP, for the ACME/Let's Encrypt challenge if using it).
- Create/attach an SSH key pair — you'll need the private key for step 6.
- Once running, SSH in and install Docker + Docker Compose:
  ```
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  sudo apt-get install -y docker-compose-plugin
  ```
- Clone the repo and create the production env file (this file stays on the server only — never in GitHub):
  ```
  sudo mkdir -p /opt/collab-code && sudo chown $USER /opt/collab-code
  git clone git@github.com:HarshulDua/collab-code.git /opt/collab-code
  cd /opt/collab-code
  ```
  Create `/opt/collab-code/.env.prod`:
  ```
  CLIENT_ORIGIN=https://<your-s3-or-cloudfront-domain>
  JWT_SECRET=<generate: openssl rand -hex 32>
  GIT_TOKEN_ENCRYPTION_KEY=<generate: openssl rand -hex 32>
  ADMIN_EMAIL=<the email you registered with in the app>
  EXEC_HOST_TMP_DIR=/opt/collab-exec-shared
  ```
  `ADMIN_EMAIL` must exactly match the email of the account you'll log into the deployed app with — that's what `/admin` checks (`ARCHITECTURE.md` §16.1).
- Build the sandbox image once: `docker build -t collab-python-sandbox:latest -f docker/python-sandbox.Dockerfile docker/`
- First manual start: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build server mongo redis`
- Put a reverse proxy (nginx or Caddy) in front of the server container for real TLS — Caddy is the simplest (automatic Let's Encrypt certs with a one-line config: `your-api-domain.com { reverse_proxy localhost:4000 }`).

## 4. GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret, add:

| Secret | Value |
|---|---|
| `EC2_HOST` | your EC2 instance's public IP or domain |
| `EC2_USER` | `ubuntu` (default for Ubuntu AMIs) |
| `EC2_SSH_PRIVATE_KEY` | the private key from step 3, full contents |
| `AWS_DEPLOY_ROLE_ARN` | the IAM role ARN from step 5 below |
| `AWS_REGION` | e.g. `ap-south-1` |
| `S3_BUCKET_NAME` | the bucket name from step 2 |
| `CLOUDFRONT_DISTRIBUTION_ID` | optional, if you set up CloudFront |

## 5. GitHub OIDC role for the S3 deploy (no stored AWS keys)

This is what lets GitHub Actions push to S3 without ever holding a long-lived AWS access key — the modern, recommended pattern.

- IAM → Identity providers → Add provider → OpenID Connect → Provider URL `https://token.actions.githubusercontent.com`, Audience `sts.amazonaws.com`.
- IAM → Roles → Create role → Web identity → select the provider above → Audience `sts.amazonaws.com` → GitHub organization `HarshulDua`, repository `collab-code`.
- Attach a policy scoped to just the S3 bucket (and CloudFront invalidation if used):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": ["s3:PutObject","s3:DeleteObject","s3:ListBucket"], "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"] },
      { "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation"], "Resource": "*" }
    ]
  }
  ```
- Copy the role's ARN into the `AWS_DEPLOY_ROLE_ARN` secret above.

## 6. Verify the pipeline

Push any commit to `main` → the `CI` workflow runs tests → on success, `Deploy` runs automatically: SSHes into EC2 to rebuild the server, and syncs the freshly-built client to S3. Check the Actions tab on GitHub for both runs.

## 7. Confirm the admin dashboard works in production

Register/log in on the deployed app using the exact email set as `ADMIN_EMAIL` in `.env.prod`, then visit `/admin` — you should see the real live rooms/users/logs from the production server (`ARCHITECTURE.md` §16).

## What this buys you going forward

Every `git push` to `main` (once merged from wherever you actually work) rebuilds and redeploys both halves automatically — no manual EC2 SSH session needed after this initial setup. The one thing that stays manual on purpose: `.env.prod` on the EC2 host, so secrets never pass through GitHub Actions logs or repo history at all.
