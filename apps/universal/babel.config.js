/**
 * `jsxImportSource: 'nativewind'` routes JSX through NativeWind's runtime so `className` works on
 * React Native primitives; `nativewind/babel` compiles the Tailwind output for the native targets.
 */
module.exports = function babelConfig(api) {
    api.cache(true);
    return {
        presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    };
};
