#!/usr/bin/env node
/**
 * Regenerates the committed token artefacts.
 *
 * Plain Node: it imports the TypeScript source directly (Node 24 strips types natively), so there is
 * no build tool between the tokens and their output. Run with:
 *
 *   pnpm --filter @healthy360/design-tokens build:tokens
 *
 * Output is committed. `src/generators/drift.test.ts` re-renders in memory and fails if the files on
 * disk disagree, so a forgotten regeneration breaks CI rather than shipping stale tokens.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const generatorsUrl = pathToFileURL(join(packageRoot, 'src', 'generators', 'index.ts')).href;

const { renderTailwindPreset, renderTokensCss, renderTokensNative } = await import(generatorsUrl);

const artefacts = [
    ['generated/tailwind-preset.cjs', renderTailwindPreset()],
    ['generated/tokens.css', renderTokensCss()],
    ['generated/tokens.native.ts', renderTokensNative()],
];

const check = process.argv.includes('--check');
let changed = 0;

await mkdir(join(packageRoot, 'generated'), { recursive: true });

for (const [relativePath, contents] of artefacts) {
    const absolutePath = join(packageRoot, relativePath);
    let existing = null;
    try {
        existing = await readFile(absolutePath, 'utf8');
    } catch {
        // First run: the artefact does not exist yet.
    }

    if (existing === contents) {
        console.log(`unchanged  ${relativePath}`);
        continue;
    }

    changed += 1;
    if (check) {
        console.error(`DRIFT      ${relativePath}`);
        continue;
    }

    await writeFile(absolutePath, contents, 'utf8');
    console.log(`written    ${relativePath}`);
}

if (check && changed > 0) {
    console.error(
        `\n${changed} generated file(s) are out of date. Run: pnpm --filter @healthy360/design-tokens build:tokens`,
    );
    process.exit(1);
}
