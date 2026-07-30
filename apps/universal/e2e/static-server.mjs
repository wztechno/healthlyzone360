#!/usr/bin/env node
/**
 * A ~90-line static server for the exported web build.
 *
 * Expo's `output: 'static'` pre-renders each route to its own HTML file, so this is *not* a plain
 * single-page-app server: `/sign-in` must resolve to `sign-in.html` when that file exists, and only
 * fall back to `index.html` when it does not. Serving the SPA shell for every path would silently
 * hide a missing pre-rendered route — exactly the regression the export is meant to catch.
 *
 * No dependency is used on purpose. A test harness that needs its own web framework installed is a
 * second thing that can break, and `node:http` is entirely sufficient here.
 *
 * Usage: node e2e/static-server.mjs [--root dist] [--port 4173]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);

function argValue(name, fallback) {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const ROOT = resolve(process.cwd(), argValue('root', 'dist'));
const PORT = Number.parseInt(argValue('port', '4173'), 10);

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};

async function resolveFile(pathname) {
    // Reject traversal before touching the filesystem.
    const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    if (relative.split(sep).includes('..')) return null;

    const candidates =
        relative === '' || relative.endsWith('/')
            ? [join(ROOT, relative, 'index.html')]
            : [
                  join(ROOT, relative),
                  join(ROOT, `${relative}.html`),
                  join(ROOT, relative, 'index.html'),
              ];

    for (const candidate of candidates) {
        try {
            const stats = await stat(candidate);
            if (stats.isFile()) return candidate;
        } catch {
            /* try the next candidate */
        }
    }
    return null;
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

    void resolveFile(url.pathname).then(async (file) => {
        // Fall back to the shell only for extension-less paths: a missing asset must 404 loudly.
        const target = file ?? (extname(url.pathname) === '' ? join(ROOT, 'index.html') : null);

        if (target === null) {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        try {
            await stat(target);
        } catch {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        response.writeHead(200, {
            'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
        });
        createReadStream(target).pipe(response);
    });
});

server.listen(PORT, () => {
    console.log(`Serving ${ROOT} on http://localhost:${PORT}`);
});
