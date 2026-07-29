# Healthy360

Multi-tenant health, nutrition and wellness platform: dietitian clinics, healthy-food
kitchens, patients, fitness and wellness providers, suppliers, delivery, corporate
wellness and insurance partners in one ecosystem.

## Repository layout

```text
apps/api/          Laravel 13 modular monolith (PHP 8.4, PostgreSQL 18, Redis 8)
apps/universal/    Expo SDK 57 universal app - web, iOS, Android (Phase 5)
packages/          Shared TypeScript packages (@healthy360/*) (Phase 5)
infrastructure/    Docker, deployment and monitoring assets
docs/              Architecture documents, ADRs, registers, API conventions
scripts/           Setup, reset and storage-init scripts (PowerShell + Bash)
```

Start with [docs/architecture/00-executive-summary.md](docs/architecture/00-executive-summary.md).
Decisions live in [docs/architecture/adr/](docs/architecture/adr/), open items in
[docs/registers/](docs/registers/).

## Prerequisites

- Docker Desktop (WSL2 backend recommended)
- PHP 8.4 with `pdo_pgsql` and `redis` extensions, plus Composer
- Node.js 24 LTS with `corepack enable` (frontend, Phase 5)
- Windows: enable Developer Mode and `git config --global core.longpaths true`

## Quick start

```bash
# Windows PowerShell
./scripts/setup.ps1

# Bash (Git Bash / WSL / macOS / Linux)
bash scripts/setup.sh
```

This installs Composer dependencies, starts the Docker services, initialises the
local S3 bucket, and migrates and seeds the database.

| Service | Address |
| --- | --- |
| API through nginx (containerised) | <http://localhost:8080> (health: `/up`) |
| API on the host | `cd apps/api && php artisan serve` → <http://localhost:8000> |
| Mailpit (mail testing UI) | <http://localhost:8025> |
| PostgreSQL 18 | `localhost:55432`, database `healthy360` |
| Redis 8 | `localhost:6379` |
| Garage (S3-compatible storage) | <http://localhost:3900> |
| Horizon dashboard | `/horizon` on the API |

## Common commands

```bash
# Backend tests (PostgreSQL healthy360_test database)
cd apps/api && php artisan test --compact

# Static analysis and formatting
cd apps/api && vendor/bin/phpstan analyse && vendor/bin/pint --dirty

# Destroy and recreate the local environment
./scripts/reset.ps1        # or: bash scripts/reset.sh
```

All credentials in `compose.yaml`, `.env.example` and the init scripts are
local-development placeholders only. Real environments receive secrets through
their deployment platform - never through this repository.
