const healthy360Preset = require('@healthy360/design-tokens/tailwind-preset');

/**
 * NativeWind 4 + Tailwind 3.4 (dependency-compatibility.md — NativeWind 5 is preview and Tailwind 4
 * is not supported by NativeWind 4).
 *
 * `darkMode: 'class'` pairs with the `.dark` block in `@healthy360/design-tokens/tokens.css`; the
 * `colorScheme` API toggles that class on web and drives the native appearance directly.
 *
 * RTL policy: physical direction utilities (ml/mr/pl/pr/left/right/text-left/…) are banned by the
 * root ESLint config. Use logical utilities only — ms/me, ps/pe, start/end, text-start/text-end.
 * NativeWind 4's `rtl:`/`ltr:` variants are broken on native and are banned for the same reason.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
    darkMode: 'class',
    content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', '../../packages/*/src/**/*.{ts,tsx}'],
    presets: [require('nativewind/preset'), healthy360Preset],
    theme: {
        extend: {},
    },
    plugins: [],
};
