/**
 * `jsxImportSource: 'nativewind'` routes JSX through NativeWind's runtime so `className` works on
 * React Native primitives; `nativewind/babel` compiles the Tailwind output for the native targets.
 */
module.exports = function babelConfig(api) {
    api.cache(true);
    return {
        presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
        env: {
            // Jest only. Metro never sees this — which is the entire point; see the plugin's note.
            test: {
                plugins: [dynamicImportToRequire],
            },
        },
    };
};

/**
 * Rewrites `import(x)` to `Promise.resolve().then(() => require(x))`, **under Jest only**.
 *
 * The kitchen workspace and the other staff and customer areas are route-split: each route file
 * resolves its screen through `React.lazy(() => import(…))` (`src/shell/lazy-screen.tsx`), which is
 * what makes Metro emit one async chunk per screen instead of one entry bundle carrying every
 * editor in the application.
 *
 * Jest runs those same files through Babel's CommonJS transform, and `babel-preset-expo` ships
 * `@babel/plugin-syntax-dynamic-import` — the *syntax* — without the transform that lowers it. A
 * bare `import()` then survives into a CommonJS module and Node's VM refuses it with "a dynamic
 * import callback was invoked without --experimental-vm-modules". The alternatives were to run Jest
 * with ESM enabled (a change to how every one of the eighteen suites executes, for one language
 * feature) or to add `babel-plugin-dynamic-import-node` (a dependency for the same eleven lines).
 * This is the smallest thing that leaves the shipped bundle untouched: it lives under `env.test`,
 * so Metro — which is the only thing that decides what a chunk is — never applies it.
 *
 * `Promise.resolve().then(…)` rather than a bare `require`, so the import stays asynchronous and a
 * `Suspense` boundary still suspends. A test that saw the module arrive synchronously would prove
 * nothing about the fallback it is meant to render.
 *
 * @type {import('@babel/core').PluginItem}
 */
function dynamicImportToRequire({ types: t }) {
    return {
        name: 'healthy360-dynamic-import-to-require',
        visitor: {
            CallExpression(path) {
                if (!t.isImport(path.node.callee)) return;

                const source = path.node.arguments[0];
                if (source === undefined) return;

                path.replaceWith(
                    t.callExpression(
                        t.memberExpression(
                            t.callExpression(
                                t.memberExpression(
                                    t.identifier('Promise'),
                                    t.identifier('resolve'),
                                ),
                                [],
                            ),
                            t.identifier('then'),
                        ),
                        [
                            t.arrowFunctionExpression(
                                [],
                                t.callExpression(t.identifier('require'), [source]),
                            ),
                        ],
                    ),
                );
            },
        },
    };
}
