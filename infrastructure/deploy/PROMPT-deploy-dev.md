# Prompt: deploy `dev` to the dev server with Claude Code

Paste everything below the line into Claude Code from a checkout of this
repository on the `dev` branch. It runs the manual loop from
[DEPLOYMENT.md](DEPLOYMENT.md) §2 and §10 with every guard that has bitten
before, and verifies the result. When the deploy workflow (§11) is live, the
everyday path is simply `git push origin dev`; this is the same deploy done by
hand, and the fallback if Actions is ever unavailable.

A developer without SSH access to the droplet gets a generated key and a stop at
step 1 — have the owner add the printed public key to the droplet, then run it
again.

---

Deploy the `dev` branch of this repository to the dev test server, end to end, and verify it.

## What you are deploying to
- Droplet: root@157.230.121.66 (key-only SSH; never use or ask for a password)
- DEV stack:  https://dev.157-230-121-66.nip.io  →  /opt/healthy360-dev  →  STACK=dev   ← this one
- PROD stack: https://157-230-121-66.nip.io      →  /opt/healthy360      →  STACK=prod  ← DO NOT TOUCH
Both stacks share one Postgres and one Redis on that droplet. Read
infrastructure/deploy/DEPLOYMENT.md sections 2 and 10 before doing anything.

## Hard rules
- Never run anything in /opt/healthy360, never deploy to the prod hostname, never push to main.
- Never run `docker compose down -v` anywhere: the shared Postgres holds prod's data too.
- In /opt/healthy360-dev always pass `-f compose.dev.yaml` to docker compose (a compose.yaml
  also exists there and would read the wrong .env).
- Never print the contents of .env or .env.deploy on the droplet.
- Do not reseed (SKIP_SEED=0) unless I explicitly ask; dev keeps its data between deploys.
- If a step fails, stop and report exactly what failed. Do not improvise fixes on the server.

## Step 1 — pre-flight (all must pass before building)
- `git rev-parse --abbrev-ref HEAD` is `dev` (or the branch I named) and `git status` is clean.
  The web bundle is built from the WORKING TREE, so uncommitted files would ship — refuse if dirty
  unless I confirm that is intended.
- `git merge-base --is-ancestor 215be25 HEAD` succeeds (the branch carries the deploy stack).
- Node 24 and pnpm via `corepack enable`; then `pnpm install --frozen-lockfile`.
- SSH: use the key at ~/.ssh/healthy360_do if it exists, otherwise the path in $H360_SSH_KEY.
  Test with `ssh -i <key> -o BatchMode=yes -o ConnectTimeout=15 root@157.230.121.66 true`.
  If no key exists: generate one (`ssh-keygen -t ed25519 -N "" -f ~/.ssh/healthy360_dev_deploy`),
  print ONLY the public key, tell me to have the owner add it to the droplet, and STOP.
  If the port times out but https://dev.157-230-121-66.nip.io/up answers 200, SSH is
  intermittently filtered on this droplet — retry every minute for up to 15 minutes before
  reporting it, and never conclude the server is down while HTTPS answers.

## Step 2 — build the package (on this machine)
    set -o pipefail
    NODE_OPTIONS=--max-old-space-size=6144 infrastructure/deploy/package.sh dev.157-230-121-66.nip.io
Do not pipe package.sh through grep/tail without pipefail — a masked failure once shipped the wrong
bundle. Confirm the output contains: "verified: https://dev.157-230-121-66.nip.io is compiled into
the bundle". The result is build/healthy360-deploy.tar.gz.

## Step 3 — ship and deploy (on the droplet, via SSH)
    scp -i <key> build/healthy360-deploy.tar.gz root@157.230.121.66:/opt/healthy360-dev/healthy360-deploy.tar.gz
Then, on the droplet, in /opt/healthy360-dev:
    rm -rf api web && tar -xzf healthy360-deploy.tar.gz && chmod +x deploy.sh postgres-init/*.sh
Gate before deploying — count bundle chunks containing each origin under web/_expo/static/js/web/:
the dev origin (https://dev.157-230-121-66.nip.io) must appear in ≥1 file and the prod origin
(https://157-230-121-66.nip.io, without "dev.") in 0 files. If not, ABORT and report; do not deploy.
Then:
    STACK=dev ./deploy.sh dev.157-230-121-66.nip.io
Expect "==> migrating", "==> setting the shared tester password" / "updated 9 accounts", and the
three smoke checks (api health, web bundle, seeded data) all OK. Takes ~1–3 minutes.

## Step 4 — verify from outside
- `curl -sS -o /dev/null -w '%{http_code}' https://dev.157-230-121-66.nip.io/up` → 200
- `https://dev.157-230-121-66.nip.io/api/v1/marketplace/kitchens?limit=1` → 200 with a "data" array
- On the droplet: `docker compose -f compose.dev.yaml ps` shows api (healthy), queue, scheduler,
  dev-web all Up.
- Sign-in check: POST https://dev.157-230-121-66.nip.io/api/v1/auth/token with
  {"email":"owner@verdant.test","password":"<from infrastructure/deploy/TESTERS.md>",
   "device_name":"deploy-check","platform":"web"} → 201.
- Confirm prod is untouched: `curl -sS -o /dev/null -w '%{http_code}' https://157-230-121-66.nip.io/up` → 200.

## Step 5 — report
The commit deployed (`git rev-parse --short HEAD`), the dev URL, `git log --oneline -5` of what
is new, every check above with its result, and anything skipped or failed. If a migration ran,
say which. Do not claim a step succeeded that you did not observe succeeding.
