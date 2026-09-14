# Healthy360 test instance — deployment guide

Everything needed to ship a new commit or branch to the online test instance,
plus what the deployment is made of and why. For the shorter overview see
[README.md](README.md); for the tester-facing account list see
[TESTERS.md](TESTERS.md).

---

## 1. The instance

| | |
| --- | --- |
| URL | <https://157-230-121-66.nip.io> |
| Droplet | `Green-life`, 157.230.121.66, Ubuntu 24.04.4 LTS |
| Resources | 3.8 GB RAM, 2 vCPU, 77 GB disk, 5 GB swap |
| Deployment root | `/opt/healthy360` |
| SSH | `ssh -i ~/.ssh/healthy360_do root@157.230.121.66` (key-only) |
| Runtime | Docker 29.7.2, Compose 5.4.0 |
| Deployed from | `Remove-Mock` @ `410e7e5` |
| TLS | Caddy, automatic Let's Encrypt, auto-renewing |

`157-230-121-66.nip.io` is not a domain anybody registered. nip.io resolves any
`<ip-with-dashes>.nip.io` name to that address, so the instance has a real
hostname — and therefore a real certificate — without DNS to configure. Point a
proper domain at the droplet later and re-run with that name instead; nothing
else changes.

---

## Database policy

**A deploy applies pending schema migrations and does nothing else to the
database.** It cannot seed: there is no flag for it, because there is nothing a
deploy should ever invent. The only data a deploy writes is the tester password,
and only when `DEMO_PASSWORD=…` is named on that run's command line.

**`healthzone-rebuild.sh` is the bootstrap.** A database built from nothing —
the reference layer, the operator login and the v6 HealthZone360 kitchen — comes
from that script, which migrates fresh, seeds and imports in one deliberate,
destructive, clearly-announced operation. Both stacks run that world. A deploy
never builds it and never touches it.

---

## 2. Shipping a new commit

Three commands from the repository root. This is the whole loop.

```bash
infrastructure/deploy/package.sh 157-230-121-66.nip.io
```

```bash
scp -i ~/.ssh/healthy360_do build/healthy360-deploy.tar.gz root@157.230.121.66:/opt/healthy360/
```

```bash
ssh -i ~/.ssh/healthy360_do root@157.230.121.66 'cd /opt/healthy360 && rm -rf api web && tar -xzf healthy360-deploy.tar.gz && ./deploy.sh 157-230-121-66.nip.io'
```

Roughly 4–6 minutes end to end, most of it the Expo export and the image build.
The site is briefly unavailable while `web` is replaced.

Three details worth understanding rather than copying:

- **`rm -rf api web` matters.** `tar -xzf` merges into what is already there, so
  without it a file deleted in the new commit lives on in the container.
- **A deploy never touches the data.** There is no seed flag to remember or
  forget: shipping code and changing what testers are looking at are separate
  operations, and only `healthzone-rebuild.sh` does the second.
- **Secrets survive.** `deploy.sh` generates `APP_KEY`, the database passwords
  and the Postgres superuser password on first run and reuses them forever
  after, so shipping code never invalidates sessions, tokens or encrypted
  columns.

### Deploying a branch or a tag

`package.sh` takes an optional git ref (default `HEAD`):

```bash
infrastructure/deploy/package.sh 157-230-121-66.nip.io main
```

The **API** tree comes from that ref via `git archive`, so nothing uncommitted
in the working copy can reach an image. The **web bundle** is the exception:
Metro builds from the working tree, so the export always reflects the files
currently on disk. `package.sh` prints a warning when the ref and `HEAD`
disagree. When the frontend differs between them, check the branch out first:

```bash
git checkout main
infrastructure/deploy/package.sh 157-230-121-66.nip.io
```

### First run on a brand-new droplet

```bash
ssh root@<new-ip> 'bash -s' < infrastructure/deploy/bootstrap-droplet.sh
```

Installs Docker from the official repository, adds swap (`SWAP_SIZE=8G` to
override), and closes the firewall to SSH/80/443. Idempotent. Then run the
three commands above, then `healthzone-rebuild.sh` to build the world.

---

## 3. What is deployed

```text
                    :80 → :443 redirect
   Internet ──────► Caddy ──────► nginx ──┬──► /api/*, /up, /sanctum/*  →  php-fpm (api)
              (Let's Encrypt TLS)         │
                                          └──► everything else          →  /srv/web
                                                                            (Expo export)
                                api ─┬──► postgres 18   (no published port)
                             horizon ─┴──► redis 8      (no published port)
```

Seven containers: `caddy`, `web` (nginx), `api` (php-fpm), `queue` (Horizon),
`scheduler`, `postgres`, `redis`.

**One origin for both halves.** The bundle is compiled against
`https://157-230-121-66.nip.io` and served from it, so the browser makes
same-origin requests and CORS never applies to it (`config/cors.php` still
governs native clients). It also means exactly three path prefixes reach PHP —
anything else is served the web bundle.

### Files

| File | Role |
| --- | --- |
| `package.sh` | **Local.** `git archive` + Expo export + route rules → tarball |
| `deploy.sh` | **On droplet.** Secrets, build, migrate, seed, start, smoke-check |
| `bootstrap-droplet.sh` | **On droplet, once.** Docker, swap, firewall |
| `Dockerfile` | API image — code baked in, Composer at build time |
| `php.ini` | Deployed PHP settings (opcache without timestamp validation) |
| `compose.yaml` | The seven services and their volumes |
| `nginx.conf` | Same-origin routing, Horizon block, 404 handling |
| `dynamic-routes.conf` | **Generated** by `package.sh` — 30 rules, see §7 |
| `Caddyfile` | TLS termination and forwarded headers |
| `postgres-init/` | Roles and database, created once on an empty volume |

### What differs from the development stack

| | root `compose.yaml` | `infrastructure/deploy` |
| --- | --- | --- |
| Application code | bind-mounted from the host | baked into the image |
| Postgres / Redis | published on the host | compose network only |
| TLS | none | Caddy + Let's Encrypt |
| Object storage | Garage | none — `FILESYSTEM_DISK=local` |
| Horizon dashboard | at `/horizon` | 404 at the edge |
| `APP_DEBUG` | true | false |
| Mail | log | log (unchanged — see §6) |

Garage is absent because only three surfaces write files (B2B exports, KYC
documents, kitchen workbook import) and they are served from the `apistorage`
volume. Add it back the moment anything needs pre-signed URLs.

---

## 4. What `deploy.sh` does

1. **Instance secrets** → `.env` (compose substitution). Written once:
   `SITE_ADDRESS`, `POSTGRES_SUPERUSER_PASSWORD`, `DB_PASSWORD`,
   `DB_MIGRATIONS_PASSWORD`.
2. **Application environment** → `.env.deploy`. Rewritten every run, with
   `APP_KEY` carried across.
3. **`docker compose build`** — Composer install inside the image.
4. **`docker compose up -d --wait postgres redis`**.
5. **Migrate** as `healthy360_migrator` over the `pgsql_migrations` connection.
   The runtime role owns nothing and holds no DDL rights, which is what keeps
   row-level security meaningful (ADR-0007).
6. **Tester password** — only when `DEMO_PASSWORD` is named on this run.
8. **`docker compose up -d`**, restart `queue`/`scheduler` so Horizon picks up
   the new image, then smoke-check `/up`, `/`, and a seeded API read.

### Environment knobs

| Variable | Default | Effect |
| --- | --- | --- |
| `DEMO_PASSWORD` | `password` | Sets one shared password on the four known logins, this run only |
| `API_RATE_LIMIT` | 600 here, 60 shipped | Requests/minute — see §7 |
| `SWAP_SIZE` | `5G` | `bootstrap-droplet.sh` only |

---

## 5. Data

**A deploy writes no data.** Building a world is `healthzone-rebuild.sh`, run by
hand on the droplet: it backs the database up, migrates fresh, seeds the
reference layer and the operator login, imports the v6 HealthZone360 catalogue
and recipes, publishes what passes its gates, and creates the three kitchen
logins. It is destructive and announces itself before starting.

Seeding runs in a **one-off container with `APP_ENV=local`**, because the
seeders refuse to run outside `local`/`testing`. That guard is worth keeping —
it is what stops a real deployment of this code from inventing tenants — so the
rebuild works around it for one command rather than weakening it. The instance
itself runs `APP_ENV=production`, `APP_DEBUG=false`.

```bash
# Build (or rebuild) the world. Destructive; keeps a backup.
./healthzone-rebuild.sh

# Destroy everything including volumes, then redeploy from clean and rebuild
docker compose down -v && ./deploy.sh 157-230-121-66.nip.io && ./healthzone-rebuild.sh
```

Rotating the shared tester password:

```bash
DEMO_PASSWORD='a-better-password' ./deploy.sh 157-230-121-66.nip.io
```

---

## 6. Operating

```bash
cd /opt/healthy360

docker compose ps                       # what is running
docker compose logs -f api              # application log — outgoing mail lands here
docker compose logs -f caddy            # certificate issuance and renewal
docker compose logs -f queue            # Horizon (there is no dashboard here)

docker compose exec api php artisan tinker
docker compose exec api php artisan horizon:status
docker compose exec postgres psql -U postgres -d healthy360

docker compose restart api queue scheduler
docker compose down                     # stop; volumes survive
docker compose down -v                  # stop and destroy the database
```

**Mail is never delivered.** `MAIL_MAILER=log` writes every message to the
container log, so nothing on a test instance can email a real person by
accident. To read a verification or reset link:

```bash
docker compose logs api | grep -A 40 'Subject:'
```

Switching to real delivery means setting `MAIL_MAILER=brevo` and `BREVO_API_KEY`
in `deploy.sh`'s `.env.deploy` block, with a sender verified in Brevo.

---

## 7. Things that will bite you

Six problems surfaced during the first deployment. All are fixed; each is
recorded because the fix is invisible and the symptom is not.

**1. `composer install --no-dev` breaks seeding.** The demo seeders drive model
factories, factories call `fake()`, and `fakerphp/faker` is `require-dev`. It
dies at `B2bProgrammesDemoSeeder` with an undefined function. The image installs
dev dependencies deliberately; `nginx.conf` is what makes that safe, since no
dev tool's routes are reachable over HTTP. A deployment that does not seed demo
data should put `--no-dev` back.

**2. Caddy crash-loops on an empty `ACME_EMAIL`.** `email {$ACME_EMAIL}` with the
variable unset expands to a bare `email`, which is a hard parse error. There is
no `email` directive now; add one literally to receive expiry warnings.

**3. `localhost` is refused inside the nginx container.** Its entrypoint adds an
IPv6 listener by rewriting the config, and cannot, because the config is mounted
read-only — so `localhost` (which resolves to `::1` first) is refused while
`127.0.0.1` answers. `nginx.conf` declares `listen [::]:80;` itself; health
probes use `127.0.0.1`.

**4. Expo dynamic routes need explicit nginx rules.** The static export names
dynamic routes *literally* — `/kitchens/{id}` is served by the file
`kitchens/[kitchen].html`. A plain SPA fallback to `index.html` looks like it
works and is not: React receives the landing page's markup, fails to hydrate the
detail tree against it (minified error #418) and the route hangs on its loading
state. `package.sh` generates 30 anchored rules into `dynamic-routes.conf`.
**A new dynamic route means re-running `package.sh`** — which happens anyway on
every deploy, so this only matters if you hand-edit configs on the droplet.

**5. The frontend and the API can silently ship from different commits.** This
one bit the first deployment and is the most likely to bite you again. `git
archive` takes the API from a ref; **Metro always builds the bundle from the
working tree**, because it compiles files on disk rather than objects in git. A
working copy carrying an unfinished feature therefore ships screens whose
endpoints do not exist on the deployed API — they answer 404, testers find dead
pages, and the bug reports are about your uncommitted work rather than the
build. Symptom seen: `/kitchen/quotations` rendered while
`/api/v1/kitchen/quotations` returned 404.

`package.sh` warns when the ref and `HEAD` differ, but it cannot warn about
uncommitted work at `HEAD` itself. When the working tree is not clean and the
distinction matters, build from a throwaway worktree:

```bash
git worktree add --detach /tmp/h360-head <ref>
cd /tmp/h360-head && pnpm install --frozen-lockfile && pnpm run build:tokens
cd apps/universal && EXPO_PUBLIC_API_URL="https://157-230-121-66.nip.io" \
    APP_MODE=all-dev APP_ENV=preview pnpm run build:web:api
# package from there, then: git worktree remove /tmp/h360-head
```

Cheapest check after any deploy — the deployed bundle should contain no route
whose API 404s:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://157-230-121-66.nip.io/<suspect-route>
```

**6. The API throttle is per-user, not per-tester.** `config/api.php` →
`Limit::perMinute()` keyed on user id. Testers share seeded personas, so they
share one bucket, and a single kitchen workspace dashboard costs ~20 requests on
load. At the shipped 60/min everything after the first request 429s and every
tile reads "Count unavailable". The instance runs `API_RATE_LIMIT=600`; the
default is untouched at 60.

### Diagnosing

```bash
docker compose ps                       # a container "Restarting" is the answer
docker compose logs --tail=50 <service>
docker compose exec -T web wget -q -O- http://127.0.0.1/up      # nginx → PHP
docker compose exec -T web wget -q -O- 'http://127.0.0.1/api/v1/marketplace/kitchens?limit=1'
curl -sS -o /dev/null -w '%{http_code}\n' https://157-230-121-66.nip.io/up
```

A 500 from every endpoint at once is almost always a stale
`bootstrap/cache/packages.php` naming a provider the vendor tree does not have.
The real cause is one line above it in the log:

```bash
docker compose exec api sh -c 'rm -f bootstrap/cache/packages.php bootstrap/cache/services.php'
docker compose restart api
```

---

## 8. Application changes the deployment carries

Three files in `apps/api` are taken from the **working tree** rather than from
the packaged ref, because no reverse-proxied deployment is correct without them.
They are listed in `package.sh`'s `OVERLAY` array and announced on every run.

| File | Why |
| --- | --- |
| `bootstrap/app.php` | `trustProxies(at: '*')`. Without it the framework reads nginx's container address as the client address: one throttle bucket serves everyone, and `url()` emits `http://` on an HTTPS site. |
| `config/api.php` *(new)* | Makes the API throttle configurable. Default unchanged at 60. |
| `app/Providers/AppServiceProvider.php` | Reads that setting instead of a hardcoded 60. |

**Commit them and the overlay becomes a no-op** — `package.sh` copies the same
bytes `git archive` already produced. Until then the deployment works, but a
clean clone plus `package.sh` would not reproduce it.

---

## 9. What this is not

A test instance, not the production architecture in
[07-deployment-observability-and-recovery.md](../../docs/architecture/07-deployment-observability-and-recovery.md).
Specifically absent: backups of any kind, log aggregation, metrics, uptime
monitoring, a second instance, zero-downtime deploys, and object storage. The
database lives in one Docker volume on one droplet; `docker compose down -v`
destroys it and nothing else has a copy.

Before this carries anything that matters, in rough order: automated Postgres
backups off the droplet, a real domain, `APP_DEBUG` confirmed false on every
path, and demo seeding disabled.

---

## 10. The dev stack

A second copy of the application on the same droplet, at
<https://dev.157-230-121-66.nip.io>, running whatever branch you point it at
while prod keeps serving `main` to testers. It lives in `/opt/healthy360-dev`
and is `compose.dev.yaml` rather than `compose.yaml`.

It has **no Postgres, Redis or Caddy of its own**. It borrows prod's over the
external Docker network `healthy360-shared`, and is kept apart from prod by
configuration only:

| | prod | dev |
| --- | --- | --- |
| Database | `healthy360` | `healthy360_dev` (same two roles, same passwords) |
| Redis databases | 0 / 1 | 2 / 3 |
| `APP_NAME` — every Redis prefix derives from it | `Healthy360` | `Healthy360 Dev` |
| Containers | 7 | 4: `api`, `queue`, `scheduler`, `dev-web` |
| Hostname | `157-230-121-66.nip.io` | `dev.157-230-121-66.nip.io` |

Only prod's `postgres`, `redis` and `caddy` join the shared network. That is
what keeps Docker DNS unambiguous: prod's Caddy resolves `web` on its own
network and `dev-web` on the shared one, and dev's nginx resolves `api` to dev's
own api because prod's `api` is never on the shared network.

### Deploying to dev

A ready-made Claude Code prompt that runs this loop with every guard below is in
[PROMPT-deploy-dev.md](PROMPT-deploy-dev.md).

Prod must have been deployed at least once with the shared network (any deploy
from this version of the stack onward). Then, **with the branch checked out** —
the bundle builds from the working tree, and for dev that is the point:

```bash
git checkout <branch>
infrastructure/deploy/package.sh dev.157-230-121-66.nip.io
scp -i ~/.ssh/healthy360_do build/healthy360-deploy.tar.gz root@157.230.121.66:/opt/healthy360-dev/
ssh -i ~/.ssh/healthy360_do root@157.230.121.66 'cd /opt/healthy360-dev && rm -rf api web && tar -xzf healthy360-deploy.tar.gz && STACK=dev ./deploy.sh dev.157-230-121-66.nip.io'
```

The first run creates `healthy360_dev` and adopts prod's database credentials
and tester password from `/opt/healthy360/.env`; the database comes up empty and
`healthzone-rebuild.sh` fills it. Every later run migrates and keeps the data.

The branch must contain `215be25` (the deployment stack) — anything older lacks
`trustProxies` and `config/api.php` and misbehaves behind Caddy. Check with
`git merge-base --is-ancestor 215be25 <branch>`.

### What to expect

- Redeploying **prod** recreates `postgres`, `redis` and `caddy` if their
  network membership changed — a few seconds of downtime for both stacks; data
  persists in the volumes.
- The dev URL answers **502** whenever the dev stack is down. Caddy holds its
  certificate regardless.
- `docker compose down -v` on **prod destroys dev's database too**, and
  restarting Postgres or Redis bounces both stacks. That is the price of one
  database server; a second Postgres container is the upgrade path if it bites.

### Rollback

```bash
# dev only — prod untouched
cd /opt/healthy360-dev && docker compose down
docker exec healthy360-deploy-postgres-1 psql -U postgres -c 'DROP DATABASE healthy360_dev'
docker exec healthy360-deploy-redis-1 redis-cli -n 2 FLUSHDB
docker exec healthy360-deploy-redis-1 redis-cli -n 3 FLUSHDB
```

---

## 11. Automatic deploys

`.github/workflows/deploy.yml` runs the loop above on every push:

| Push to | Deploys to | Stack |
| --- | --- | --- |
| `dev` | <https://dev.157-230-121-66.nip.io> | `/opt/healthy360-dev`, `STACK=dev` |
| `main` | <https://157-230-121-66.nip.io> | `/opt/healthy360`, `STACK=prod` |

So the working rhythm is: commit to `dev`, push, look at the dev URL (about
ten minutes — most of it the Expo export); when it is right, open a PR from
`dev` to `main` and merge, and the prod URL testers use updates the same way.
Nothing is deployed from any other branch.

Every deploy migrates and **never seeds**: prod holds what testers have been
doing and dev keeps its state between pushes. When a branch changes a seeder,
rebuild that stack by hand from the droplet:

```bash
cd /opt/healthy360-dev && STACK=dev ./healthzone-rebuild.sh
```

One deploy per branch runs at a time; a second push while one is in flight
waits rather than cancelling it.

### What the workflow needs

A repository secret named **`DROPLET_SSH_KEY`** holding the private half of a
dedicated deploy key whose public half is in the droplet root account
`authorized_keys`. It is the only secret. The droplet host key is pinned in the
workflow, so a runner never trusts whatever answers first.

That key is root on the droplet. Acceptable for a test box; the upgrade path
when it stops being one is a `command=` restriction in `authorized_keys` that
allows nothing but the deploy.

### Watching a run

The Actions tab on the repository. A failed run leaves the previous deploy
serving — `deploy.sh` only replaces the web root and restarts containers after
the new image has built and migrated — so a red run means "not updated", not
"down". Re-run it from the same tab once the cause is fixed.
