// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier/flat';

/**
 * Healthy360 RTL policy (plan §20, dependency-compatibility.md).
 *
 * NativeWind 4's `rtl:` / `ltr:` variants are broken on native, so the codebase uses
 * *logical* Tailwind utilities only: ms / me, ps / pe, start / end, border-s / border-e,
 * rounded-s / rounded-e, text-start / text-end.
 *
 * The regex below matches a whole class token (optionally preceded by variant prefixes such
 * as `md:` / `hover:` and an optional negative `-`) and requires a token boundary afterwards,
 * so legitimate classes that merely *start* with the same letters — `text-primary`,
 * `placeholder:text-sm`, `rounded-lg`, `pointer-events-none` — are not false positives.
 *
 * NOTE: the pattern deliberately contains no `/` character; esquery's attribute-regex grammar
 * terminates the pattern at the first unescaped slash.
 */
const PHYSICAL_DIRECTION_CLASS =
    '(^|\\s)(?:[a-z0-9-]+:)*-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-[^\\s]*)?($|\\s)';

const DIRECTION_VARIANT_CLASS = '(^|\\s|:)(?:rtl|ltr):';

const RTL_MESSAGE =
    'Physical direction utilities are banned (RTL policy). Use logical utilities instead: ms / me, ps / pe, start / end, border-s / border-e, rounded-s / rounded-e, text-start / text-end.';

const VARIANT_MESSAGE =
    'NativeWind 4 `rtl:` / `ltr:` variants do not work on native. Use logical utilities instead of direction variants.';

/** Selectors that catch class strings written directly in JSX attributes. */
const classNameAttributeSelectors = ['className', 'class'].flatMap((attribute) => [
    {
        selector: `JSXAttribute[name.name='${attribute}'] Literal[value=/${PHYSICAL_DIRECTION_CLASS}/]`,
        message: RTL_MESSAGE,
    },
    {
        selector: `JSXAttribute[name.name='${attribute}'] TemplateElement[value.raw=/${PHYSICAL_DIRECTION_CLASS}/]`,
        message: RTL_MESSAGE,
    },
    {
        selector: `JSXAttribute[name.name='${attribute}'] Literal[value=/${DIRECTION_VARIANT_CLASS}/]`,
        message: VARIANT_MESSAGE,
    },
    {
        selector: `JSXAttribute[name.name='${attribute}'] TemplateElement[value.raw=/${DIRECTION_VARIANT_CLASS}/]`,
        message: VARIANT_MESSAGE,
    },
]);

const restrictedImports = {
    patterns: [
        {
            group: ['@react-navigation', '@react-navigation/*', '@react-navigation/*/**'],
            message:
                'Expo Router forks React Navigation internals. Import navigation primitives from `expo-router` instead (dependency-compatibility.md).',
        },
    ],
    paths: [
        {
            name: 'react-native',
            importNames: ['I18nManager'],
            message:
                'I18nManager may only be touched inside @healthy360/i18n (packages/i18n/src/direction.native.ts). Use the direction adapter exported from @healthy360/i18n.',
        },
    ],
};

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.expo/**',
            '**/.turbo/**',
            '**/coverage/**',
            '**/expo-env.d.ts',
            'apps/api/**',
            'infrastructure/**',
            'scripts/**',
        ],
    },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    {
        files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.es2023 },
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
        rules: {
            'no-restricted-syntax': ['error', ...classNameAttributeSelectors],
            'no-restricted-imports': ['error', restrictedImports],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },

    // React / Expo application code.
    {
        files: ['apps/universal/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
        },
    },

    // Node scripts and generated CommonJS output.
    {
        files: [
            '**/scripts/**/*.{mjs,cjs,js}',
            '**/*.config.{js,cjs,mjs}',
            '**/generated/**/*.cjs',
        ],
        languageOptions: {
            globals: { ...globals.node },
            sourceType: 'commonjs',
        },
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        files: ['**/scripts/**/*.mjs'],
        languageOptions: { sourceType: 'module' },
    },

    // Jest configuration and setup files (CommonJS, jest globals). ESLint 10 removed
    // `/* eslint-env */` comments, so the globals have to be declared here.
    {
        files: ['**/jest.config.js', '**/jest.setup.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.jest },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            'no-console': 'off',
        },
    },

    // The i18n package is the single place allowed to touch I18nManager.
    {
        files: ['packages/i18n/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': ['error', { patterns: restrictedImports.patterns }],
        },
    },

    // Tests may use non-null assertions and console output.
    {
        files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
            'no-console': 'off',
        },
    },

    // The Playwright harness (static server, helpers) runs under Node, not the app runtime.
    {
        files: ['apps/universal/e2e/**/*.{ts,mjs}'],
        languageOptions: { globals: { ...globals.node } },
        rules: {
            'no-console': 'off',
        },
    },

    prettier,
);
