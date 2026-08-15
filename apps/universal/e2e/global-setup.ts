import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Global setup for the API-backed projects.
 *
 * Does exactly one thing, and only when asked: with `E2E_RESET_DB=1`, it resets the Laravel
 * database to the seeded demo world (`migrate:fresh --seed`) so a run starts from a known state.
 * It is env-gated because this config also drives the static mock projects, which must never
 * touch a database — and because a `migrate:fresh` that runs by surprise is a loaded gun.
 *
 * Two safety rails:
 * - refuses unless `apps/api/.env` declares `APP_ENV=local` or `APP_ENV=testing`;
 * - prefers the host `php`, falls back to `docker compose exec -T api` when there is none.
 *
 * API reachability is *not* asserted here — the write specs probe the stack themselves and skip
 * with instructions when it is down, which is friendlier than failing every project at setup.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

const RESET_ARGS = [
    'artisan',
    'migrate:fresh',
    '--database=pgsql_migrations',
    '--seed',
    '--force',
] as const;

function apiAppEnv(): string | null {
    const envPath = resolve(API_DIR, '.env');
    if (!existsSync(envPath)) return null;
    const match = /^APP_ENV=(.*)$/m.exec(readFileSync(envPath, 'utf8'));
    return match?.[1]?.trim() ?? null;
}

function hostPhpAvailable(): boolean {
    return spawnSync('php', ['--version'], { stdio: 'ignore' }).status === 0;
}

export default function globalSetup(): void {
    if (process.env['E2E_RESET_DB'] !== '1') return;

    const appEnv = apiAppEnv();
    if (appEnv === null) {
        throw new Error(
            'E2E_RESET_DB=1 but apps/api/.env does not exist — copy .env.example and configure ' +
                'the local stack before asking the e2e run to reset its database.',
        );
    }
    if (appEnv !== 'local' && appEnv !== 'testing') {
        throw new Error(
            `E2E_RESET_DB=1 refused: apps/api/.env declares APP_ENV=${appEnv}. ` +
                'A migrate:fresh only runs against a local or testing environment.',
        );
    }

    const viaHost = hostPhpAvailable();
    const reset = viaHost
        ? spawnSync('php', [...RESET_ARGS], { cwd: API_DIR, stdio: 'inherit' })
        : spawnSync('docker', ['compose', 'exec', '-T', 'api', 'php', ...RESET_ARGS], {
              cwd: REPO_ROOT,
              stdio: 'inherit',
          });

    if (reset.status !== 0) {
        throw new Error(
            `Database reset failed (${viaHost ? 'host php' : 'docker compose exec api'} exited ` +
                `${String(reset.status)}). The API-backed specs need the seeded demo world.`,
        );
    }
}
