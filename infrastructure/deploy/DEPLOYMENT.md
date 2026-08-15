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

## 2. Shipping a new commit

Three commands from the repository root. This is the whole loop.

```bash
infrastructure/deploy/package.sh 157-230-121-66.nip.io
```

```bash
scp -i ~/.ssh/healthy360_do build/healthy360-deploy.tar.gz root@157.230.121.66:/opt/healthy360/
```

```bash
ssh -i ~/.ssh/healthy360_do root@157.230.121.66 'cd /opt/healthy360 && rm -rf api web && tar -xzf healthy360-deploy.tar.gz && SKIP_SEED=1 ./deploy.sh 157-230-121-66.nip.io'
```

Roughly 4–6 minutes end to end, most of it the Expo export and the image build.
The site is briefly unavailable while `web` is replaced.

Three details worth understanding rather than copying:

- **`rm -rf api web` matters.** `tar -xzf` merges into what is already there, so
  without it a file deleted in the new commit lives on in the container.
- **`SKIP_SEED=1` is the right default for a code change.** The seeders are
  idempotent and converge rather than duplicate, so re-seeding is safe — it is
  just slow, and it resets demo records testers may have edited. Drop the flag
  when the change *is* a seeder or a migration that needs data behind it.
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
three commands above, without `SKIP_SEED`.

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
6. **Seed** — unless `SKIP_SEED=1`. See §5.
7. **Tester password** — only when `DEMO_PASSWORD` is set to something other
   than `password`.
8. **`docker compose up -d`**, restart `queue`/`scheduler` so Horizon picks up
   the new image, then smoke-check `/up`, `/`, and a seeded API read.

### Environment knobs

| Variable | Default | Effect |
| --- | --- | --- |
| `SKIP_SEED` | unset | `1` migrates without touching data |
| `DEMO_PASSWORD` | `password` | Sets one shared password on all nine personas |
| `API_RATE_LIMIT` | 600 here, 60 shipped | Requests/minute — see §7 |
| `SWAP_SIZE` | `5G` | `bootstrap-droplet.sh` only |

---

## 5. Data

Seeding runs in a **one-off container with `APP_ENV=local`**, because every demo
seeder refuses to run outside `local`/`testing`. That guard is worth keeping —
it is what stops a real deployment of this code from inventing tenants — so the
deployment works around it for one command rather than weakening it. The
instance itself runs `APP_ENV=production`, `APP_DEBUG=false`.

```bash
# Re-seed (idempotent — converges, does not duplicate)
docker compose run --rm --no-deps -e APP_ENV=local api \
    php artisan db:seed --database=pgsql_migrations --force

# Wipe and rebuild the database from scratch
docker compose run --rm --no-deps -e APP_ENV=local api \
    php artisan migrate:fresh --database=pgsql_migrations --seed --force

# Destroy everything including volumes, then redeploy from clean
docker compose down -v && ./deploy.sh 157-230-121-66.nip.io
```

Rotating the shared tester password:

```bash
DEMO_PASSWORD='a-better-password' SKIP_SEED=1 ./deploy.sh 157-230-121-66.nip.io
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
