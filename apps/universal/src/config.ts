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
}

const appMode: AppMode = isAppMode(extra.appMode) ? extra.appMode : 'all-dev';
const appEnv: AppEnv = isAppEnv(extra.appEnv) ? extra.appEnv : 'development';
const dataMode: DataMode = isDataMode(extra.dataMode) ? extra.dataMode : 'mock';

export const appConfig: AppConfig = {
    appMode,
    appEnv,
    dataMode,
    productionReady: extra.productionReady === true,
    isMockData: dataMode === 'mock',
    isProduction: appEnv === 'production',
};
