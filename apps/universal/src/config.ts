import { DEFAULT_API_BASE_URL, DEFAULT_MOCK_SCENARIO, isMockScenarioName } from '@healthy360/api-client';
import type { MockScenarioName } from '@healthy360/api-client';
import { isAppMode, isDataMode } from '@healthy360/domain-types';
import type { AppMode, DataMode } from '@healthy360/domain-types';
import Constants from 'expo-constants';

/**
 * Runtime view of the build-time configuration produced by `app.config.ts`.
 *
 * `app.config.ts` already refuses to configure a production build with mock data (gate #1); this
 * module re-reads the resolved values so the running application can show the mock-mode indicator
 * and so Phase 5b's repository factory has a single, typed place to assert against (gate #2).
 */
export const APP_ENVS = ['development', 'preview', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

interface RawExtra {
    readonly appMode?: unknown;
    readonly appEnv?: unknown;
    readonly dataMode?: unknown;
    readonly productionReady?: unknown;
}

const extra = (Constants.expoConfig?.extra ?? {}) as RawExtra;

function isAppEnv(value: unknown): value is AppEnv {
    return typeof value === 'string' && (APP_ENVS as readonly string[]).includes(value);
}

export interface AppConfig {
    readonly appMode: AppMode;
    readonly appEnv: AppEnv;
    readonly dataMode: DataMode;
    readonly productionReady: boolean;
    readonly isMockData: boolean;
    readonly isProduction: boolean;
    /**
     * The mock world the build starts in. Read from `EXPO_PUBLIC_MOCK_SCENARIO` at build time and
     * changeable at runtime from the development banner; meaningless when `dataMode` is `api`.
     */
    readonly mockScenario: MockScenarioName;
    /** Development affordances — the scenario switcher, the showcase alias — are gated on this. */
    readonly isDevelopment: boolean;
    /**
     * The Healthy360 API origin, read from `EXPO_PUBLIC_API_URL`. Empty when unset, which the
     * repository factory turns into the local default outside production and into a hard failure
     * inside it — a production build must never quietly talk to `localhost`.
     */
    readonly apiUrl: string;
    /** Sent as `X-Client-Version`, and recorded against the device on `POST /auth/token`. */
    readonly clientVersion: string;
}

const appMode: AppMode = isAppMode(extra.appMode) ? extra.appMode : 'all-dev';
const appEnv: AppEnv = isAppEnv(extra.appEnv) ? extra.appEnv : 'development';
const dataMode: DataMode = isDataMode(extra.dataMode) ? extra.dataMode : 'mock';

/**
 * `EXPO_PUBLIC_*` variables are inlined by Metro at build time, so this is read from
 * `process.env` directly rather than from `expoConfig.extra` — a value that must survive into a
 * static export cannot depend on the config object being serialised alongside it.
 */
const rawScenario = process.env.EXPO_PUBLIC_MOCK_SCENARIO;
const mockScenario: MockScenarioName = isMockScenarioName(rawScenario)
    ? rawScenario
    : DEFAULT_MOCK_SCENARIO;

/**
 * Read the same way and for the same reason: the API origin has to survive into a static export,
 * so it comes from the inlined `EXPO_PUBLIC_*` variable rather than from `expoConfig.extra`.
 * Outside production an unset value means "the local stack" (`DEFAULT_API_BASE_URL`).
 */
const rawApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
const apiUrl = rawApiUrl !== '' ? rawApiUrl : appEnv === 'production' ? '' : DEFAULT_API_BASE_URL;

const clientVersion = (Constants.expoConfig?.version ?? '0.0.0') as string;

export const appConfig: AppConfig = {
    appMode,
    appEnv,
    dataMode,
    productionReady: extra.productionReady === true,
    isMockData: dataMode === 'mock',
    isProduction: appEnv === 'production',
    mockScenario,
    isDevelopment: appEnv !== 'production',
    apiUrl,
    clientVersion,
};
