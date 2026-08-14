# Deploying the test instance

A single-droplet deployment of the whole product — Expo web export and Laravel
API on one origin, behind automatic HTTPS. It exists so the application can be
exercised online by people who are not running the development stack; it is not
the production architecture described in
[07-deployment-observability-and-recovery.md](../../docs/architecture/07-deployment-observability-and-recovery.md).

## Shape

```text
              :443
    Caddy  ──────────►  nginx  ──┬──►  /api, /up, /sanctum   →  php-fpm  (api)
  (Let's Encrypt)                └──►  everything else       →  /srv/web (Expo export)

                       php-fpm ──┬──►  postgres   (no published port)
                       horizon ──┴──►  redis      (no published port)
```

One origin for both halves. The bundle is compiled against `https://<site>` and
served from it, so the browser client makes same-origin requests and CORS never
enters into it; `config/cors.php` still governs native clients.

## Deploying

```bash
# 1. Once per droplet
ssh root@<ip> 'bash -s' < bootstrap-droplet.sh

# 2. Build a package (on a development machine)
infrastructure/deploy/package.sh <site-address>

# 3. Ship and run it
scp build/healthy360-deploy.tar.gz root@<ip>:/opt/healthy360/
ssh root@<ip> 'cd /opt/healthy360 && tar -xzf healthy360-deploy.tar.gz && ./deploy.sh <site-address>'
```

`<site-address>` is the hostname the instance answers on — a domain with an A
record pointing at the droplet, or an `<ip-with-dashes>.nip.io` name, which
resolves to the embedded address with no DNS to configure and which Let's
Encrypt issues certificates for normally.

Re-deploying is the same three steps. `deploy.sh` generates instance secrets and
the application key on its first run and preserves them afterwards, so shipping
new code does not invalidate sessions, tokens or encrypted columns.

## What differs from the development stack

| | `compose.yaml` (root) | `infrastructure/deploy` |
| --- | --- | --- |
| Application code | bind-mounted from the host | copied into the image at build |
| Postgres / Redis | published on the host | compose network only |
| TLS | none | Caddy, automatic Let's Encrypt |
| Object storage | Garage | none — `FILESYSTEM_DISK=local` |
| Horizon dashboard | reachable at `/horizon` | 404 at the edge |
| `APP_DEBUG` | true | false |

Garage is absent because only three surfaces write files — B2B exports, KYC
documents and the kitchen workbook import — and they are served from the api
storage volume. Add it back the moment anything needs pre-signed URLs.

## Demo data

`deploy.sh` seeds through a one-off container with `APP_ENV=local`, because
every demo seeder refuses to run outside `local`/`testing` — a guard worth
keeping, since it is what stops a real deployment of this code from inventing
tenants. The instance itself runs as `production`.

Set `DEMO_PASSWORD` to give every seeded persona a shared password other than
the `password` the seeders write. `SKIP_SEED=1` migrates without touching data.

## Operating

```bash
cd /opt/healthy360

docker compose ps                     # what is running
docker compose logs -f api            # application log (mail is written here too)
docker compose logs -f caddy          # certificate issuance and renewal
docker compose exec api php artisan tinker
docker compose down                   # stop; volumes survive
docker compose down -v                # stop and destroy the database
```

Horizon has no dashboard here (blocked in `nginx.conf`); `docker compose logs
queue` is the equivalent view.
