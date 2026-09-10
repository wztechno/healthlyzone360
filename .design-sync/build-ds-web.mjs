#!/usr/bin/env node
/**
 * design-sync build step for `@healthy360/design-system`.
 *
 * The package is source-only and React Native: `main`/`types`/`exports` all point at
 * `./src/index.ts`, there is no `dist/`, and its peers are `react-native` + `nativewind`, not a DOM
 * library. The converter's stock esbuild pass (`.ds-sync/lib/bundle.mjs`) carries no knobs for
 * aliasing, `.web.*` resolution or a custom JSX import source, and forking that file is forbidden
 * by the skill — so this script produces the browser-ready entry the converter expects instead,
 * and `--entry` points at it.
 *
 * Emits two files into `packages/design-system/dist/` (gitignored, regenerated every run):
 *   index.web.js   — the whole library bundled for the browser (CommonJS), react/react-dom left
 *                    external so the converter's own shim can bind them to window.React
 *   ds.css         — Tailwind compiled from the app's config, tokens.css inlined ahead of it
 *
 * Recipe verified 2026-08-29; see .design-sync/NOTES.md for why each setting is load-bearing.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = join(ROOT, 'packages/design-system');
const OUT_DIR = join(PKG_DIR, 'dist');

// esbuild lives with the staged converter, not in the repo's own lockfile.
const SYNC_MODULES = join(ROOT, '.ds-sync/node_modules');
if (!existsSync(join(SYNC_MODULES, 'esbuild'))) {
    console.error(
        `esbuild not found under ${SYNC_MODULES}.\n` +
            `Stage the converter first:  (cd .ds-sync && npm i esbuild ts-morph @types/react)`,
    );
    process.exit(1);
}
const { build } = await createRequire(join(SYNC_MODULES, 'noop.js'))('esbuild');

mkdirSync(OUT_DIR, { recursive: true });

/**
 * Modules with no browser implementation. Stubbed rather than excluded so the components that
 * import them still load — they degrade at call time instead of failing the whole bundle.
 * Keep this list minimal and record every addition in NOTES.md.
 */
const NATIVE_ONLY = {
    'expo-document-picker':
        'export async function getDocumentAsync(){return{canceled:true,assets:null}}\n' +
        'export default{getDocumentAsync};\n',
};

const stubNativeOnly = {
    name: 'stub-native-only',
    setup(b) {
        for (const [id, contents] of Object.entries(NATIVE_ONLY)) {
            b.onResolve({ filter: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }, () => ({
                path: id,
                namespace: 'native-stub',
            }));
        }
        b.onLoad({ filter: /.*/, namespace: 'native-stub' }, (args) => ({
            contents: NATIVE_ONLY[args.path],
            loader: 'js',
        }));
    },
};

// CJS, not ESM. react-native-web and react-native-css-interop ship CommonJS that calls
// `require('react')`; with `format: 'esm'` esbuild turns those into `__require("react")` and every
// preview dies at runtime with "Dynamic require of \"react\" is not supported". CommonJS keeps them
// as real require() calls, which the converter's reactShim resolves to window.React at bundle time.
const outfile = join(OUT_DIR, 'index.web.js');

await build({
    entryPoints: [join(PKG_DIR, 'src/index.ts')],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    // NativeWind 4 styles through a JSX transform. Without this every component renders with
    // correct markup and NO styles — the failure mode that would silently poison every preview.
    jsx: 'automatic',
    jsxImportSource: 'nativewind',
    alias: {
        'react-native': join(ROOT, 'node_modules/react-native-web'),
    },
    // Not optional. `react-native-safe-area-context`'s specs/NativeSafeAreaView.js deep-requires
    // react-native/Libraries/Utilities/codegenNativeComponent, a native codegen path with no
    // react-native-web equivalent. Preferring `.web.js` is exactly what Metro does — and it is
    // also how the repo's own grid/date-field/slider-field platform splits resolve.
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
    mainFields: ['browser', 'module', 'main'],
    conditions: ['browser', 'import', 'require'],
    // The converter's reactShim rebinds these to window.React / window.ReactDOM. Leaving them
    // external here is what stops a second React copy landing in the IIFE.
    external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-is',
    ],
    // Matches .ds-sync/lib/bundle.mjs so assets resolve identically in both passes.
    loader: {
        // react-native-css-interop ships JSX inside plain .js (dist/doctor.js is the
        // jsx-pragma probe NativeWind uses to prove its transform ran).
        '.js': 'jsx',
        '.svg': 'dataurl',
        '.png': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
    },
    define: {
        'process.env.NODE_ENV': '"development"',
        __DEV__: 'true',
    },
    plugins: [stubNativeOnly],
    logLevel: 'warning',
    metafile: false,
});

console.error(`  entry: ${(statSync(outfile).size / 1024).toFixed(0)} KB  ${outfile}`);

// -- CSS. The app's Tailwind config already globs ../../packages/*/src, and global.css @imports
// packages/design-tokens/generated/tokens.css first, so the :root and .dark blocks ride along.
const cssOut = join(OUT_DIR, 'ds.css');
const tailwindBin = join(ROOT, 'node_modules/.bin/tailwindcss' + (process.platform === 'win32' ? '.CMD' : ''));
const app = join(ROOT, 'apps/universal');
const css = spawnSync(
    tailwindBin,
    ['-c', join(app, 'tailwind.config.js'), '-i', join(app, 'global.css'), '-o', cssOut, '--minify'],
    { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (css.status !== 0) {
    console.error(`tailwindcss exited ${css.status}`);
    process.exit(css.status ?? 1);
}
console.error(`  css:   ${(statSync(cssOut).size / 1024).toFixed(0)} KB  ${cssOut}`);
