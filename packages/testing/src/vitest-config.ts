import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

export interface PackageVitestOptions {
    /**
     * Worker cap. Defaults to 1 — see {@link WORKER_CAP} for why that is not a pessimisation.
     * Raise it only for a package whose suite is genuinely parallelism-bound and measured to be.
     */
    readonly maxWorkers?: number | undefined;
    /** Test glob(s), relative to the package root. Defaults to `src/**\/*.test.ts`. */
    readonly include?: readonly string[];
    /** Vitest environment. Pure-TypeScript packages stay on `node`. */
    readonly environment?: 'node' | 'jsdom';
    /** Setup files run before each test file. */
    readonly setupFiles?: readonly string[];
}

/**
 * The single place the Vitest defaults for pure-TypeScript workspace packages are written down.
 *
 * React Native rendering tests do **not** run here: RNTL under Vitest is not viable, so those live
 * in `apps/universal` under jest-expo (dependency-compatibility.md).
 */

/**
 * One worker per package, because the workspace — not the package — is what runs out of cores.
 *
 * Nine packages read this factory. Left unbounded, each spawns a worker per core, and `turbo run
 * test` starts up to ten of them at once alongside two jest suites doing the same: on an 8-core
 * machine that is roughly eighty processes competing for eight cores. The cost lands as *time*,
 * and time is what a test budget is measured against — so suites that pass comfortably alone cross
 * their timeout together and the run reports failures that do not reproduce. That is the whole
 * mechanism behind `pnpm check` reporting 35 failures where a standalone run reports one.
 *
 * These suites are pure TypeScript, and their wall time is dominated by transform and startup
 * rather than by test execution, so a second worker buys close to nothing even alone. One worker
 * per package, nine packages, is a budget the machine can actually meet.
 */
const WORKER_CAP = 1;
export function createPackageVitestConfig(options: PackageVitestOptions = {}): ViteUserConfig {
    return defineConfig({
        test: {
            environment: options.environment ?? 'node',
            include: [...(options.include ?? ['src/**/*.test.ts'])],
            setupFiles: options.setupFiles ? [...options.setupFiles] : [],
            // `maxWorkers` only: Vitest 4 dropped `minWorkers` from the top-level config, and the
            // ceiling is the half that matters — nothing here needs a floor held open.
            maxWorkers: options.maxWorkers ?? WORKER_CAP,
            passWithNoTests: false,
            clearMocks: true,
            restoreMocks: true,
        },
    });
}
