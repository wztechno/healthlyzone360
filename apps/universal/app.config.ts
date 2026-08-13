import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Build-time application configuration.
 *
 * One codebase, five build families (plan §16). `APP_MODE` selects the identity — name, slug and
 * bundle identifier — so `customer` and `staff` can sit side by side on one device, and so a
 * mis-built binary is obvious from its icon rather than from a support ticket.
 *
 * `APP_ENV` selects the deployment target. The hard throw at the bottom is **mock-cannot-ship
 * gate #1** (plan §18): a production build that is still reading mock repositories fails to
 * configure at all, long before it can be signed or uploaded.
 */

const APP_MODES = ['customer', 'staff', 'kiosk', 'driver', 'all-dev'] as const;
type AppMode = (typeof APP_MODES)[number];

const APP_ENVS = ['development', 'preview', 'production'] as const;
type AppEnv = (typeof APP_ENVS)[number];

interface ModeIdentity {
    readonly name: string;
    readonly slug: string;
    readonly bundleIdentifier: string;
    readonly scheme: string;
    /** Modes without production configuration are prototypes (plan §16). */
    readonly productionReady: boolean;
}

const MODE_IDENTITIES: Readonly<Record<AppMode, ModeIdentity>> = {
    customer: {
        name: 'Healthy360',
        slug: 'healthy360-customer',
        bundleIdentifier: 'com.healthy360.customer',
        scheme: 'healthy360',
        productionReady: true,
    },
    staff: {
        name: 'Healthy360 Staff',
        slug: 'healthy360-staff',
        bundleIdentifier: 'com.healthy360.staff',
        scheme: 'healthy360staff',
        productionReady: true,
    },
    kiosk: {
        name: 'Healthy360 Kiosk',
        slug: 'healthy360-kiosk',
        bundleIdentifier: 'com.healthy360.kiosk',
        scheme: 'healthy360kiosk',
        productionReady: false,
    },
    driver: {
        name: 'Healthy360 Driver',
        slug: 'healthy360-driver',
        bundleIdentifier: 'com.healthy360.driver',
        scheme: 'healthy360driver',
        productionReady: false,
    },
    'all-dev': {
        name: 'Healthy360 Dev',
        slug: 'healthy360-dev',
        bundleIdentifier: 'com.healthy360.dev',
        scheme: 'healthy360dev',
        productionReady: true,
    },
};

function readEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    throw new Error(`${name}="${raw}" is not valid. Expected one of: ${allowed.join(', ')}.`);
}

const appMode = readEnum<AppMode>('APP_MODE', APP_MODES, 'all-dev');
const appEnv = readEnum<AppEnv>('APP_ENV', APP_ENVS, 'development');

const identity = MODE_IDENTITIES[appMode];

// There is no data-mode switch any more (ADR-0013): every build reads from the Healthy360 API,
// and the surviving production guard — a required EXPO_PUBLIC_API_URL — lives in the repository
// factory (`MissingApiBaseUrlError`), where a patched bundle cannot route around it.
if (appEnv === 'production' && !identity.productionReady) {
    throw new Error(
        [
            `APP_MODE=${appMode} has no production configuration.`,
            'POS, KDS and driver builds remain prototypes until their hardware and offline requirements',
            'are known (plan §16). Build them with APP_ENV=preview.',
        ].join('\n'),
    );
}

export default ({ config }: ConfigContext): ExpoConfig => ({
    ...config,
    name: identity.name,
    slug: identity.slug,
    scheme: identity.scheme,
    version: '0.1.0',
    orientation: 'portrait',
    // The New Architecture is the only architecture in SDK 57, so there is no flag to set.
    userInterfaceStyle: 'automatic',
    icon: './assets/images/icon.png',
    ios: {
        bundleIdentifier: identity.bundleIdentifier,
        supportsTablet: true,
    },
    android: {
        package: identity.bundleIdentifier,
        adaptiveIcon: {
            foregroundImage: './assets/images/android-icon-foreground.png',
            backgroundImage: './assets/images/android-icon-background.png',
            monochromeImage: './assets/images/android-icon-monochrome.png',
            backgroundColor: '#ffffff',
        },
    },
    web: {
        bundler: 'metro',
        output: 'static',
        favicon: './assets/images/favicon.png',
    },
    plugins: [
        'expo-router',
        'expo-localization',
        'expo-secure-store',
        'expo-font',
        ['expo-splash-screen', { image: './assets/images/splash-icon.png', resizeMode: 'contain' }],
    ],
    experiments: {
        typedRoutes: true,
    },
    extra: {
        appMode,
        appEnv,
        productionReady: identity.productionReady,
    },
});
