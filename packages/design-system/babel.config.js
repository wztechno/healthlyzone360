/**
 * Mirrors `apps/universal/babel.config.js`: `jsxImportSource: 'nativewind'` routes JSX through
 * NativeWind's runtime so `className` is accepted on React Native primitives, and `nativewind/babel`
 * compiles the utility output. The design system has to be transformed exactly as the application
 * transforms it, or a component would behave differently in its own test than in the app.
 */
module.exports = function babelConfig(api) {
    api.cache(true);
    return {
        presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    };
};
