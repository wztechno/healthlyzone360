import type { BranchId, OrganisationId } from '@healthy360/domain-types';

import { ApiError, apiFailure } from '../contracts/failure.ts';
import type { SessionTokenStore } from '../contracts/session.ts';
import type { ApiClientConfig, ClientPlatform } from './config.ts';
import { generateRequestId, resolveApiBaseUrl } from './config.ts';
import { mapErrorEnvelope } from './failures.ts';

/**
 * The active organisation and branch, as the *client* believes them to be.
 *
 * It is a belief, never an authority: the server re-validates `X-Organisation-Id` and
 * `X-Branch-Id` on every request and answers `context.organisation_forbidden` /
 * `context.branch_out_of_scope` if the claim does not hold (plan §9). Sending them anyway matters
 * because it makes each request self-describing — the same request means the same thing whether or
 * not the profile's remembered workspace has since changed underneath it.
 */
export interface ActiveContextHolder {
    readonly organisationId: OrganisationId | null;
    readonly branchId: BranchId | null;
    set(organisationId: OrganisationId | null, branchId: BranchId | null): void;
    clear(): void;
}

export function createActiveContextHolder(): ActiveContextHolder {
    let organisationId: OrganisationId | null = null;
    let branchId: BranchId | null = null;

    return {
        get organisationId() {
            return organisationId;
        },
        get branchId() {
            return branchId;
        },
        set(nextOrganisationId, nextBranchId) {
            organisationId = nextOrganisationId;
            branchId = nextBranchId;
        },
        clear() {
            organisationId = null;
            branchId = null;
        },
    };
}

export interface RequestSpec {
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    /** Path below `/api/v1`, with a leading slash — for example `/me/devices`. */
    readonly path: string;
    readonly body?: unknown;
    /** Omit the `Authorization` header even when a token exists (the credential endpoints). */
    readonly anonymous?: boolean;
}

export interface Envelope<T> {
    readonly data: T;
    /** `meta` verbatim. Only `/me` needs anything from it (`permissions_version`). */
    readonly meta: unknown;
}

export interface Transport {
    /** Resolves with `data` from the success envelope. */
    request<T>(spec: RequestSpec): Promise<T>;
    /** As `request`, but keeps `meta`. */
    requestEnvelope<T>(spec: RequestSpec): Promise<Envelope<T>>;
    /** For `204 No Content` endpoints. */
    requestVoid(spec: RequestSpec): Promise<void>;
    readonly context: ActiveContextHolder;
    readonly tokenStore: SessionTokenStore;
    readonly platform: ClientPlatform;
    readonly deviceName: string;
}

interface SuccessEnvelope {
    readonly data?: unknown;
    readonly meta?: { readonly correlation_id?: string; readonly permissions_version?: string };
}

/**
 * The thin typed `fetch` wrapper the repositories sit on.
 *
 * It exists instead of a generated SDK because every Healthy360 request carries the same six
 * conventional headers and every Healthy360 response is one of two envelopes
 * (`docs/api/conventions.md`) — encoding that once here is smaller and clearer than configuring a
 * generic client to do it, and it is the only place that has to change if the conventions do. The
 * *types* still come from the OpenAPI document via `src/generated`.
 *
 * Transport is **bearer only**. Cookie sessions need a first-party `Origin`, the CSRF handshake and
 * `credentials: 'include'`; the Expo build talks to the API cross-origin, so it uses the native
 * credential flow (`POST /auth/token`) on web as well. `credentials: 'omit'` makes that explicit —
 * no cookie is ever attached, so no request can accidentally authenticate as somebody else's
 * session.
 */
export function createTransport(config: ApiClientConfig): Transport {
    const baseUrl = resolveApiBaseUrl(config.baseUrl);
    const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    const nextRequestId = config.requestId ?? generateRequestId;
    const platform: ClientPlatform = config.platform ?? 'web';
    const deviceName = config.deviceName ?? `Healthy360 ${platform}`;
    const context = createActiveContextHolder();

    function buildHeaders(spec: RequestSpec): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'X-Client-Request-Id': nextRequestId(),
            'X-Client-Platform': platform,
        };

        if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
        if (config.appMode !== undefined) headers['X-App-Mode'] = config.appMode;
        if (config.clientVersion !== undefined) headers['X-Client-Version'] = config.clientVersion;

        const locale = config.locale?.();
        if (locale !== undefined && locale !== '') headers['Accept-Language'] = locale;

        const token = config.tokenStore.get();
        if (spec.anonymous !== true && token !== null) headers['Authorization'] = `Bearer ${token}`;

        if (context.organisationId !== null) headers['X-Organisation-Id'] = context.organisationId;
        if (context.branchId !== null) headers['X-Branch-Id'] = context.branchId;

        return headers;
    }

    async function send(spec: RequestSpec): Promise<Response> {
        try {
            return await doFetch(`${baseUrl}${spec.path}`, {
                method: spec.method,
                headers: buildHeaders(spec),
                credentials: 'omit',
                ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
            });
        } catch (caught: unknown) {
            // `fetch` rejects only when the request never produced a response: DNS, TLS, a dropped
            // connection, an aborted navigation. That is `network`, never `server` — the two send
            // the user to different remedies.
            throw new ApiError(
                apiFailure('network', {
                    message: caught instanceof Error ? caught.message : undefined,
                }),
            );
        }
    }

    async function readBody(response: Response): Promise<unknown> {
        const text = await response.text();
        if (text.trim() === '') return null;
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return null;
        }
    }

    async function complete(spec: RequestSpec): Promise<{ body: unknown; response: Response }> {
        const response = await send(spec);
        const body = response.status === 204 ? null : await readBody(response);

        if (!response.ok) {
            throw new ApiError(
                mapErrorEnvelope(body, {
                    status: response.status,
                    retryAfterHeader: response.headers.get('Retry-After'),
                    correlationIdHeader: response.headers.get('X-Correlation-Id'),
                }),
            );
        }

        return { body, response };
    }

    return {
        context,
        tokenStore: config.tokenStore,
        platform,
        deviceName,

        async request<T>(spec: RequestSpec): Promise<T> {
            return (await this.requestEnvelope<T>(spec)).data;
        },

        async requestEnvelope<T>(spec: RequestSpec): Promise<Envelope<T>> {
            const { body, response } = await complete(spec);
            const envelope = body as SuccessEnvelope | null;

            if (envelope === null || envelope.data === undefined) {
                // A documented `204` reached a caller that wanted data, or the envelope broke.
                throw new ApiError(
                    apiFailure('server', {
                        correlationId: response.headers.get('X-Correlation-Id'),
                        retryable: false,
                    }),
                );
            }

            return { data: envelope.data as T, meta: envelope.meta ?? null };
        },

        async requestVoid(spec: RequestSpec): Promise<void> {
            await complete(spec);
        },
    };
}

/** `meta.permissions_version` from a `/me` envelope, if the caller kept the whole body. */
export function readPermissionsVersion(meta: unknown): string | null {
    if (typeof meta !== 'object' || meta === null) return null;
    const value = (meta as { permissions_version?: unknown }).permissions_version;
    return typeof value === 'string' ? value : null;
}
