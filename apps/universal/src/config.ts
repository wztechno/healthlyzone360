import { DEFAULT_API_BASE_URL } from '@healthy360/api-client';
import { isAppMode } from '@healthy360/domain-types';
import type { AppMode } from '@healthy360/domain-types';
import Constants from 'expo-constants';

/**
 * Runtime view of the build-time configuration produced by `app.config.ts`.
 *
 * Every build talks to the Laravel API (ADR-0013 — there is no mock mode). The one guard that
 * matters lives in the repository factory: a production build with no `EXPO_PUBLIC_API_URL`
 * refuses to boot rather than quietly talking to `localhost`.
 */
export const APP_ENVS = ['development', 'preview', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

interface RawExtra {
    readonly appMode?: unknown;
    readonly appEnv?: unknown;
    readonly productionReady?: unknown;
}

const extra = (Constants.expoConfig?.extra ?? {}) as RawExtra;

function isAppEnv(value: unknown): value is AppEnv {
    return typeof value === 'string' && (APP_ENVS as readonly string[]).includes(value);
}

export interface AppConfig {
    readonly appMode: AppMode;
    readonly appEnv: AppEnv;
    readonly productionReady: boolean;
    readonly isProduction: boolean;
    /** Development affordances — the showcase alias, diagnostics — are gated on this. */
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

/**
 * `EXPO_PUBLIC_*` variables are inlined by Metro at build time, so this is read from
 * `process.env` directly rather than from `expoConfig.extra` — a value that must survive into a
 * static export cannot depend on the config object being serialised alongside it. Outside
 * production an unset value means "the local stack" (`DEFAULT_API_BASE_URL`).
 */
const rawApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
const apiUrl = rawApiUrl !== '' ? rawApiUrl : appEnv === 'production' ? '' : DEFAULT_API_BASE_URL;

const clientVersion = (Constants.expoConfig?.version ?? '0.0.0') as string;

export const appConfig: AppConfig = {
    appMode,
    appEnv,
    productionReady: extra.productionReady === true,
    isProduction: appEnv === 'production',
    isDevelopment: appEnv !== 'production',
    apiUrl,
    clientVersion,
};
