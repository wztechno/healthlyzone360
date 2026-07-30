const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

/**
 * Monorepo wiring.
 *
 * Workspace packages publish TypeScript *source* (no build step), so Metro has to watch them and
 * resolve modules from both node_modules trees. `nodeLinker: hoisted` in pnpm-workspace.yaml keeps
 * the tree flat enough for the React Native resolver.
 *
 * `watchFolders` deliberately lists `packages/` and the root `node_modules` rather than the
 * repository root: watching the root drags Metro's crawler through `apps/api` (a Laravel tree with
 * its own `vendor/`), `.git` and `infrastructure/`, which turns a bundle into a multi-minute
 * filesystem scan on Windows. The blockList below is the belt to that braces.
 */
config.watchFolders = [
    path.resolve(workspaceRoot, 'packages'),
    path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.blockList = [
    /[\\/]apps[\\/]api[\\/].*/,
    /[\\/]infrastructure[\\/].*/,
    /[\\/]\.git[\\/].*/,
];

module.exports = withNativeWind(config, {
    input: './global.css',
    configPath: './tailwind.config.js',
});
