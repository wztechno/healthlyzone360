#!/usr/bin/env node
/**
 * Export size budgets.
 *
 * A web export has no natural size ceiling: nothing fails when a bundle doubles, the pages still
 * render, the tests still pass, and the only person who finds out is somebody on a slow connection
 * six months later. A budget is the mechanism that turns that into a build failure on the change
 * that caused it, while the cause is still one commit wide.
 *
 * Two numbers are checked, because they fail differently:
 *
 * * **Total bytes** catches accumulation — a fourth font weight, a second copy of a library, an
 *   asset directory that was never meant to ship.
 * * **The largest single JavaScript chunk** catches the thing a total cannot see: the entry bundle
 *   growing while something else shrinks. That chunk is what a first-time visitor waits for before
 *   anything at all appears, so its size is the one most directly felt.
 *
 * ## Where the numbers come from
 *
 * Re-measured from the `all-dev` **api** export on 2026-09-10, after the admin Catalogue landed:
 * its control ladder, layout and overlay components, the column spec every Catalogue list is drawn
 * from, and the record editors for ingredients, packaging and pricing behind them. Against the
 * 2026-08-13 baseline (19 128 695 B / 3 789 839 B, the first `dist-api`-only measurement after the
 * mock implementation was deleted under ADR-0013) the total grew ~2.8 MiB and the entry chunk
 * ~490 KiB, which is that surface arriving rather than accumulation — the ~7.5 MiB of licensed
 * WebP photography (D-035) is unchanged across both. The 15 % headroom is unchanged too: it is the
 * room a wave of new screens needs without a budget rise becoming a weekly ritual.
 *
 * | measure                | actual        | ×1.15 → budget |
 * | ---------------------- | ------------- | -------------- |
 * | total `dist-api` bytes | 22 114 458    | 25 431 626     |
 * | largest JS chunk       |  4 290 814    |  4 934 436     |
 *
 * The `all-dev` export is deliberately the subject: it carries every area of the application at
 * once, so it is the largest thing the repository produces and a bound on it bounds every narrower
 * build. Raising either number is allowed — it is a decision, and this file is where it gets
 * recorded, with the reason in the commit message.
 *
 * Usage: `node scripts/check-export-budget.mjs [--dir dist-api]`
 *   exit 0 — within budget
 *   exit 1 — over budget, or the directory does not exist
 */
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/** Total bytes of the exported directory. */
export const TOTAL_BUDGET_BYTES = 25_431_626;

/** Bytes of the single largest `.js` file. */
export const LARGEST_CHUNK_BUDGET_BYTES = 4_934_436;

/** The measurement the budgets were derived from, kept so a report can show the drift. */
export const BASELINE = {
    totalBytes: 22_114_458,
    largestChunkBytes: 4_290_814,
    measuredOn: '2026-09-10',
    export: 'APP_MODE=all-dev EXPO_PUBLIC_API_URL=http://localhost:8080 expo export -p web --output-dir dist-api',
};

const args = process.argv.slice(2);

function argValue(name, fallback) {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

/** Every file under `directory`, with its size. */
async function collect(directory) {
    const files = [];

    async function walk(current) {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(path);
                continue;
            }
            const { size } = await stat(path);
            files.push({ path, size });
        }
    }

    await walk(directory);
    return files;
}

function mib(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/** `9 975 828` — grouped, because a fifteen-digit budget is unreadable as a run of digits. */
function grouped(bytes) {
    return bytes.toLocaleString('en-GB').replaceAll(',', ' ');
}

function line(label, actual, budget) {
    const percent = ((actual / budget) * 100).toFixed(1);
    const verdict = actual <= budget ? 'ok' : 'OVER';
    return (
        `${label.padEnd(22)} ${grouped(actual).padStart(12)} B (${mib(actual).padStart(9)})  ` +
        `budget ${grouped(budget).padStart(12)} B  ${percent.padStart(5)} %  ${verdict}`
    );
}

async function main() {
    const directory = resolve(process.cwd(), argValue('dir', 'dist-api'));

    try {
        const stats = await stat(directory);
        if (!stats.isDirectory()) throw new Error('not a directory');
    } catch {
        console.error(
            `check-export-budget: ${directory} does not exist. Run the web export first ` +
                '(`pnpm run build:web`).',
        );
        process.exitCode = 1;
        return;
    }

    const files = await collect(directory);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

    const scripts = files
        .filter((file) => file.path.endsWith('.js'))
        .sort((left, right) => right.size - left.size);

    if (scripts.length === 0) {
        console.error(`check-export-budget: no JavaScript found under ${directory}.`);
        process.exitCode = 1;
        return;
    }

    const largest = scripts[0];

    console.log(`Export budget — ${relative(process.cwd(), directory) || directory}`);
    console.log(`  ${String(files.length)} files, ${String(scripts.length)} JavaScript chunks`);
    console.log('');
    console.log(line('total', totalBytes, TOTAL_BUDGET_BYTES));
    console.log(line('largest JS chunk', largest.size, LARGEST_CHUNK_BUDGET_BYTES));
    console.log(`  largest chunk: ${relative(directory, largest.path).split(sep).join('/')}`);
    console.log('');
    console.log(
        `  baseline ${BASELINE.measuredOn}: total ${grouped(BASELINE.totalBytes)} B, ` +
            `largest chunk ${grouped(BASELINE.largestChunkBytes)} B (budgets are +15 %)`,
    );

    const failures = [];
    if (totalBytes > TOTAL_BUDGET_BYTES) {
        failures.push(
            `total export is ${grouped(totalBytes)} B, over the ${grouped(TOTAL_BUDGET_BYTES)} B ` +
                `budget by ${grouped(totalBytes - TOTAL_BUDGET_BYTES)} B`,
        );
    }
    if (largest.size > LARGEST_CHUNK_BUDGET_BYTES) {
        failures.push(
            `largest JavaScript chunk is ${grouped(largest.size)} B, over the ` +
                `${grouped(LARGEST_CHUNK_BUDGET_BYTES)} B budget by ` +
                `${grouped(largest.size - LARGEST_CHUNK_BUDGET_BYTES)} B`,
        );
    }

    if (failures.length > 0) {
        console.error('');
        for (const failure of failures) console.error(`::error::${failure}`);
        console.error(
            'Either reduce the export or raise the budget in ' +
                'apps/universal/scripts/check-export-budget.mjs, saying why in the commit message.',
        );
        process.exitCode = 1;
        return;
    }

    console.log('');
    console.log('Within budget.');
}

await main();
