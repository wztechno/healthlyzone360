import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

export interface PackageVitestOptions {
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
export function createPackageVitestConfig(options: PackageVitestOptions = {}): ViteUserConfig {
    return defineConfig({
        test: {
            environment: options.environment ?? 'node',
            include: [...(options.include ?? ['src/**/*.test.ts'])],
            setupFiles: options.setupFiles ? [...options.setupFiles] : [],
            passWithNoTests: false,
            clearMocks: true,
            restoreMocks: true,
        },
    });
}
