#!/usr/bin/env node
/**
 * Generate the TypeScript client from the bundled OpenAPI document (plan §15).
 *
 * `@hey-api/openapi-ts` is pre-1.0, so it is pinned exactly and driven from this project-owned
 * script rather than from an `openapi-ts.config.ts` the tool discovers by itself: the invocation,
 * the plugin set and the output location are reviewable here, and a version bump can only change
 * behaviour through a visible diff in `packages/api-client/src/generated/`.
 *
 * The output is committed. `contracts.yml` re-runs this script and fails on any diff, which is the
 * drift detection the plan asks for.
 *
 * Usage:
 *   node scripts/gen-api.mjs            regenerate
 *   node scripts/gen-api.mjs --check    regenerate into a temporary folder and diff (local check)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The generator is a devDependency of `packages/api-client` — the package that owns the output —
 * and is reached from here through the workspace's hoisted `node_modules`. That layout is not
 * incidental: `nodeLinker: hoisted` is fixed in `pnpm-workspace.yaml` because Metro cannot follow
 * pnpm's symlinked store. (`@hey-api/openapi-ts` is ESM-only with conditional exports, so
 * `createRequire(...).resolve` from the package directory does not work as an alternative.)
 */
import { createClient } from '@hey-api/openapi-ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SPEC_PATH = path.join(
    repositoryRoot,
    'apps',
    'api',
    'openapi',
    'dist',
    'healthy360.v1.yaml',
);
export const OUTPUT_PATH = path.join(
    repositoryRoot,
    'packages',
    'api-client',
    'src',
    'generated',
);

/**
 * Plugins.
 *
 * - `@hey-api/typescript` — request, response and schema interfaces for every operation. These are
 *   the authoritative wire types; `src/api/**` maps them to the domain shapes the screens use.
 * - `zod` (compatibility version 4, matching the installed zod) — runtime schemas, used by the
 *   fixture/schema conformance suite. Nothing in `src/api/**` imports them, so they never reach an
 *   application bundle.
 *
 * **No SDK or fetch-client plugin, deliberately** (three separate failures in 0.99.0, all verified):
 *
 *  1. `@hey-api/client-fetch` with `bundle: true` vendors a runtime into `generated/client/**` and
 *     `generated/core/**` that does not compile under the repository's
 *     `exactOptionalPropertyTypes: true` (eight `TS2379`s). Relaxing that flag for the whole
 *     package to accommodate vendored third-party code is a worse trade than owning the transport.
 *  2. `bundle: false` imports from the published `@hey-api/client-fetch` (latest 0.13.1), whose
 *     types predate 0.99.0's generated SDK: `ClientMeta` is not exported and `TResponse` no longer
 *     satisfies `ResponseStyle`.
 *  3. `@hey-api/sdk` with `client: false` emits an `sdk.ts` referencing `TDataShape`, `Client`,
 *     `RequestResult` and friends without importing them — it does not compile at all.
 *
 * `packages/api-client/src/api/transport.ts` is the thin typed fetch wrapper that replaces it. It
 * was needed regardless: the Healthy360 conventions (correlation headers, active-context headers,
 * the error envelope, bearer transport) are not something a generic SDK produces.
 */
function generatorConfig(outputPath) {
    return {
        input: SPEC_PATH,
        output: {
            path: outputPath,
            clean: true,
            // Workspace packages publish TypeScript source and are resolved with
            // `moduleResolution: bundler` + `allowImportingTsExtensions`, so relative imports
            // carry an explicit extension everywhere else in the repository.
            module: { extension: '.ts' },
            fileName: { suffix: null },
        },
        plugins: [
            { name: '@hey-api/typescript' },
            // `dates.offset` must be on: the API serialises RFC 3339 with an explicit offset
            // (`2026-07-30T03:44:48+00:00`), and the plugin's default only accepts `Z`, so the
            // generated schemas would reject every real response.
            { name: 'zod', compatibilityVersion: 4, dates: { offset: true } },
        ],
    };
}

function fingerprint(directory) {
    const entries = [];
    const walk = (current, prefix) => {
        for (const name of readdirSync(current).sort()) {
            const absolute = path.join(current, name);
            const relative = prefix === '' ? name : `${prefix}/${name}`;
            if (statSync(absolute).isDirectory()) walk(absolute, relative);
            else entries.push(`${relative}:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`);
        }
    };
    walk(directory, '');
    return entries.join('\n');
}

async function main() {
    const check = process.argv.includes('--check');
    const target = check ? mkdtempSync(path.join(tmpdir(), 'h360-gen-api-')) : OUTPUT_PATH;

    await createClient(generatorConfig(target));

    if (!check) {
        console.log(`Generated client written to ${path.relative(repositoryRoot, OUTPUT_PATH)}`);
        return;
    }

    try {
        if (fingerprint(target) === fingerprint(OUTPUT_PATH)) {
            console.log('Generated client is up to date.');
            return;
        }
        console.error('Generated client is out of date. Run `pnpm gen:api` and commit the result.');
        try {
            execFileSync('git', ['diff', '--stat', '--', OUTPUT_PATH], {
                cwd: repositoryRoot,
                stdio: 'inherit',
            });
        } catch {
            /* `git` is optional here; the exit code below is the signal. */
        }
        process.exitCode = 1;
    } finally {
        rmSync(target, { recursive: true, force: true });
    }
}

await main();
