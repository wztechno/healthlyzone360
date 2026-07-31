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

/**
 * Generated-code containment (plan §15: "Generated code may only be imported through the API
 * repository layer").
 *
 * `packages/api-client/src/generated/**` is produced by `scripts/gen-api.mjs` from the OpenAPI
 * document. It is the wire vocabulary — `snake_case`, nullable everywhere, regenerated wholesale on
 * every contract change. If a screen imported it, a backend field rename would ripple straight into
 * the UI, and the mock repositories could no longer stand in for the real ones. The exemption for
 * `src/api/**` is granted in an override below.
 */
const GENERATED_CLIENT_IMPORT = {
    group: [
        '**/generated/**',
        '@healthy360/api-client/generated',
        '@healthy360/api-client/generated/**',
    ],
    message:
        'The generated OpenAPI client may only be imported from packages/api-client/src/api/** (plan §15). Depend on the repository contracts and domain types instead.',
};

const restrictedImports = {
    patterns: [
        {
            group: ['@react-navigation', '@react-navigation/*', '@react-navigation/*/**'],
            message:
                'Expo Router forks React Navigation internals. Import navigation primitives from `expo-router` instead (dependency-compatibility.md).',
        },
        GENERATED_CLIENT_IMPORT,
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
            // The api-mode export the Playwright `acceptance` project serves.
            '**/dist-api/**',
            '**/build/**',
            '**/.expo/**',
            '**/.turbo/**',
            '**/coverage/**',
            '**/expo-env.d.ts',
            // Generated wholesale by scripts/build-image-manifest.mjs; still typechecked by tsc.
            'apps/universal/src/media/image-manifest.generated.ts',
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

    // The API repository layer is the single place allowed to import the generated client.
    {
        files: ['packages/api-client/src/api/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    ...restrictedImports,
                    patterns: restrictedImports.patterns.filter(
                        (pattern) => pattern !== GENERATED_CLIENT_IMPORT,
                    ),
                },
            ],
        },
    },

    // Generated output. It is regenerated wholesale, so lint findings there are the generator's to
    // fix, not a reviewer's; the file is still typechecked by `tsc` like everything else.
    {
        files: ['packages/api-client/src/generated/**/*.ts'],
        rules: {
            'no-restricted-imports': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
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

    // Prompt 2 guard invariants (plan §5), orchestrator-owned.
    //
    // 1. Screens never import fixtures: the mock world (including the prototype fixture world)
    //    is reachable only through repositories. Tests and the app's own test harness are exempt.
    // 2. No dead controls: an empty onPress body is a dead button by construction. Real handlers
    //    call a hook, a mutation or usePrototypeAction() — never nothing.
    {
        files: ['apps/universal/app/**/*.{ts,tsx}', 'apps/universal/src/**/*.{ts,tsx}'],
        ignores: [
            'apps/universal/src/testing/**',
            '**/*.test.{ts,tsx}',
            '**/__tests__/**/*.{ts,tsx}',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    ...restrictedImports,
                    patterns: [
                        ...restrictedImports.patterns,
                        {
                            group: [
                                '**/mock/**',
                                '@healthy360/api-client/mock',
                                '@healthy360/api-client/mock/**',
                            ],
                            message:
                                'Screens must not import fixtures or the mock world directly (plan §5). Go through the repository hooks; tests use src/testing helpers.',
                        },
                    ],
                },
            ],
            'no-restricted-syntax': [
                'error',
                ...classNameAttributeSelectors,
                {
                    selector:
                        "JSXAttribute[name.name='onPress'] ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
                    message:
                        'Empty onPress handlers are dead controls. Wire a real action or usePrototypeAction() (plan §5).',
                },
            ],
        },
    },

    prettier,
);
