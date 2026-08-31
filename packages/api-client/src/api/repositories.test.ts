import { MealId, ProductId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { ApiError, isRateLimitFailure, isValidationFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import type { SessionTokenStore } from '../contracts/session.ts';
import { resolveApiBaseUrl } from './config.ts';
import { createApiRepositories } from './repositories.ts';

/**
 * The API repositories, driven by a scripted `fetch`.
 *
 * Nothing here talks to a server: the point is the *contract* — which URL, which headers, which
 * body, and which `ApiFailure` a given envelope produces. The live stack is exercised by the
 * Playwright `acceptance` project, which is the only place a real round trip proves anything.
 */

interface Recorded {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: unknown;
}

interface Scripted {
    readonly status: number;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
}

function harness(
    script: readonly Scripted[],
    tokenStore: SessionTokenStore = createMemoryTokenStore(),
) {
    const calls: Recorded[] = [];
    let index = 0;

    const fetchStub: typeof fetch = (input, init) => {
        const request = init ?? {};
        calls.push({
            url: String(input),
            method: request.method ?? 'GET',
            headers: { ...(request.headers as Record<string, string> | undefined) },
            body: typeof request.body === 'string' ? JSON.parse(request.body) : null,
        });

        const next = script[index] ?? script[script.length - 1];
        index += 1;
        if (next === undefined) throw new Error('The fetch script is empty.');

        const headers = new Headers(next.headers ?? {});
        return Promise.resolve(
            new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), {
                status: next.status,
                headers,
            }),
        );
    };

    const repositories = createApiRepositories({
        baseUrl: 'https://api.example',
        tokenStore,
        appMode: 'all-dev',
        clientVersion: '0.1.0',
        platform: 'web',
        deviceName: 'Chrome on Windows',
        locale: () => 'ar',
        fetch: fetchStub,
        requestId: () => 'request-1',
    });

    return { repositories, calls, tokenStore };
}

const TOKEN_OK: Scripted = {
    status: 201,
    body: {
        data: {
            token: 'issued-token',
            token_type: 'Bearer',
            user: { id: 'user-1', email: 'a@b.test', email_verified: true },
            device: { id: 'device-1' },
        },
        meta: { correlation_id: 'c1' },
    },
};

const ME_OK: Scripted = {
    status: 200,
    body: {
        data: {
            user: {
                id: 'user-1',
                email: 'a@b.test',
                email_verified: true,
                two_factor_enabled: false,
            },
            profile: {
                given_name: 'Rami',
                family_name: 'Khoury',
                preferred_language_code: 'ar',
                country_code: 'LB',
                timezone: 'Asia/Beirut',
                numbering_system: 'latn',
                date_of_birth: null,
            },
            memberships: [],
            active_context: null,
            pending_consents: [],
        },
        meta: { correlation_id: 'c2', permissions_version: '7.1' },
    },
};

describe('resolveApiBaseUrl', () => {
    it('appends the version prefix to an origin', () => {
        expect(resolveApiBaseUrl('http://localhost:8080')).toBe('http://localhost:8080/api/v1');
    });

    it('tolerates a trailing slash', () => {
        expect(resolveApiBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080/api/v1');
    });

    it('leaves a base URL that already carries the prefix alone', () => {
        expect(resolveApiBaseUrl('https://api.example/api/v1')).toBe('https://api.example/api/v1');
    });

    it('refuses an empty base URL', () => {
        expect(() => resolveApiBaseUrl('  ')).toThrow(/base URL is required/);
    });
});

describe('request headers (docs/api/conventions.md)', () => {
    it('sends the diagnostic header set and no credential before sign-in', async () => {
        const { repositories, calls } = harness([TOKEN_OK]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });

        const [call] = calls;
        expect(call!.url).toBe('https://api.example/api/v1/auth/token');
        expect(call!.headers['X-Client-Request-Id']).toBe('request-1');
        expect(call!.headers['X-App-Mode']).toBe('all-dev');
        expect(call!.headers['X-Client-Version']).toBe('0.1.0');
        expect(call!.headers['X-Client-Platform']).toBe('web');
        expect(call!.headers['Accept-Language']).toBe('ar');
        expect(call!.headers['Authorization']).toBeUndefined();
    });

    it('attaches the bearer token once one exists', async () => {
        const { repositories, calls } = harness([TOKEN_OK, ME_OK]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });
        await repositories.session.me();

        expect(calls[1]!.headers['Authorization']).toBe('Bearer issued-token');
    });

    it('sends the active context once the server has confirmed one', async () => {
        const context: Scripted = {
            status: 200,
            body: {
                data: {
                    active_context: {
                        organisation: {
                            id: 'org-1',
                            slug: 'cedar-clinic',
                            name: 'Cedar Clinic',
                            type: 'clinic',
                            status: 'active',
                            country_code: 'LB',
                            default_currency_code: 'LBP',
                            default_language_code: 'en',
                            capabilities: [],
                        },
                        branch: {
                            id: 'branch-1',
                            name: 'Hamra',
                            city: 'Beirut',
                            timezone: 'Asia/Beirut',
                            status: 'active',
                        },
                        membership_id: 'membership-1',
                        permissions: ['organisation.view_current'],
                        entitlements: [],
                    },
                },
                meta: { correlation_id: 'c3' },
            },
        };

        const { repositories, calls } = harness([
            TOKEN_OK,
            context,
            { status: 200, body: { data: [], meta: {} } },
        ]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });

        const applied = await repositories.context.setContext({ organisationId: 'org-1' as never });
        expect(applied.branchId).toBe('branch-1');

        await repositories.devices.list();
        expect(calls[2]!.headers['X-Organisation-Id']).toBe('org-1');
        expect(calls[2]!.headers['X-Branch-Id']).toBe('branch-1');
    });
});

describe('login', () => {
    it('exchanges credentials for a device-bound token and stores it', async () => {
        const { repositories, calls, tokenStore } = harness([TOKEN_OK]);
        const result = await repositories.auth.login({ email: 'a@b.test', password: 'password' });

        expect(result.status).toBe('authenticated');
        expect(tokenStore.get()).toBe('issued-token');
        expect(calls[0]!.body).toMatchObject({
            email: 'a@b.test',
            password: 'password',
            device_name: 'Chrome on Windows',
            platform: 'web',
        });
    });

    /** Two-factor is a step in the sign-in, not a failure (contracts/auth.ts). */
    it('turns auth.two_factor_required into a challenge and completes it with the code', async () => {
        const challenge: Scripted = {
            status: 403,
            body: {
                error: {
                    code: 'auth.two_factor_required',
                    message: 'A two-factor authentication code is required.',
                    details: {},
                    correlation_id: 'c9',
                },
            },
        };

        const { repositories, calls, tokenStore } = harness([challenge, TOKEN_OK]);
        const result = await repositories.auth.login({ email: 'a@b.test', password: 'password' });

        expect(result.status).toBe('two_factor_required');
        if (result.status !== 'two_factor_required') return;
        expect(tokenStore.get()).toBeNull();

        const session = await repositories.auth.challengeTwoFactor({
            challengeId: result.challengeId,
            code: '123456',
        });

        expect(session.token).toBe('issued-token');
        expect(calls[1]!.body).toMatchObject({ two_factor_code: '123456' });
    });

    it('rejects a challenge identifier it never issued', async () => {
        const { repositories } = harness([TOKEN_OK]);
        await expect(
            repositories.auth.challengeTwoFactor({ challengeId: 'made-up', code: '123456' }),
        ).rejects.toMatchObject({ code: 'auth.invalid_credentials' });
    });
});

describe('register', () => {
    it('splits the display name and follows with the token exchange', async () => {
        const created: Scripted = {
            status: 201,
            body: { data: { user: { id: 'user-1' } }, meta: { correlation_id: 'c4' } },
        };

        const { repositories, calls, tokenStore } = harness([created, TOKEN_OK]);
        const result = await repositories.auth.register({
            name: 'Nour El Saleh',
            email: 'nour@example.test',
            password: 'Password123!',
            passwordConfirmation: 'Password123!',
            acceptTerms: true,
            acceptPrivacy: true,
        });

        expect(calls[0]!.url).toBe('https://api.example/api/v1/auth/register');
        expect(calls[0]!.body).toMatchObject({
            given_name: 'Nour El',
            family_name: 'Saleh',
            accepts_terms: true,
            accepts_privacy: true,
        });
        expect(calls[1]!.url).toBe('https://api.example/api/v1/auth/token');
        expect(result.emailVerified).toBe(false);
        expect(tokenStore.get()).toBe('issued-token');
    });

    it('uses a single word for both name parts rather than dropping one', async () => {
        const created: Scripted = {
            status: 201,
            body: { data: { user: { id: 'user-1' } }, meta: {} },
        };
        const { repositories, calls } = harness([created, TOKEN_OK]);

        await repositories.auth.register({
            name: 'Prince',
            email: 'p@example.test',
            password: 'Password123!',
            passwordConfirmation: 'Password123!',
            acceptTerms: true,
            acceptPrivacy: true,
        });

        expect(calls[0]!.body).toMatchObject({ given_name: 'Prince', family_name: 'Prince' });
    });
});

/**
 * Bearer logout: `POST /auth/logout` is session-only, and the one server-side revocation a token
 * holder has is step-up protected. The token is therefore always cleared locally, whatever the
 * server says.
 */
describe('logout', () => {
    it('attempts to revoke its own device and clears the token', async () => {
        const { repositories, calls, tokenStore } = harness([TOKEN_OK, { status: 204 }]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });
        await repositories.auth.logout();

        expect(calls[1]!.method).toBe('DELETE');
        expect(calls[1]!.url).toBe('https://api.example/api/v1/me/devices/device-1');
        expect(tokenStore.get()).toBeNull();
    });

    it('still clears the token when the revocation is refused for want of step-up', async () => {
        const refused: Scripted = {
            status: 403,
            body: {
                error: {
                    code: 'auth.step_up_required',
                    message: 'Confirm your password.',
                    details: {},
                    correlation_id: 'c5',
                },
            },
        };

        const { repositories, tokenStore } = harness([TOKEN_OK, refused]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });
        await expect(repositories.auth.logout()).resolves.toBeUndefined();
        expect(tokenStore.get()).toBeNull();
    });
});

describe('devices', () => {
    it('revoking the current device ends the local session too', async () => {
        const { repositories, tokenStore } = harness([TOKEN_OK, { status: 204 }]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });
        await repositories.devices.revoke('device-1' as never);
        expect(tokenStore.get()).toBeNull();
    });

    it('keeps the session when another device is revoked', async () => {
        const { repositories, tokenStore } = harness([TOKEN_OK, { status: 204 }]);
        await repositories.auth.login({ email: 'a@b.test', password: 'password' });
        await repositories.devices.revoke('device-2' as never);
        expect(tokenStore.get()).toBe('issued-token');
    });
});

describe('error normalisation', () => {
    async function failureOf(script: readonly Scripted[]): Promise<unknown> {
        const { repositories } = harness(script);
        try {
            await repositories.session.me();
            throw new Error('Expected a rejection.');
        } catch (caught: unknown) {
            expect(caught).toBeInstanceOf(ApiError);
            return (caught as ApiError).failure;
        }
    }

    it('maps validation.failed with its field messages', async () => {
        const failure = await failureOf([
            {
                status: 422,
                body: {
                    error: {
                        code: 'validation.failed',
                        message: 'The submitted data is invalid.',
                        details: {
                            fields: { email: ['The email field must be a valid email address.'] },
                        },
                        correlation_id: 'c6',
                    },
                },
            },
        ]);

        expect(isValidationFailure(failure as never)).toBe(true);
        expect((failure as { fields: Record<string, string[]> }).fields['email']).toEqual([
            'The email field must be a valid email address.',
        ]);
        expect((failure as { correlationId: string }).correlationId).toBe('c6');
    });

    it('reads Retry-After for rate_limit.exceeded', async () => {
        const failure = await failureOf([
            {
                status: 429,
                headers: { 'Retry-After': '47' },
                body: {
                    error: {
                        code: 'rate_limit.exceeded',
                        message: 'Too many requests.',
                        details: {},
                        correlation_id: 'c7',
                    },
                },
            },
        ]);

        expect(isRateLimitFailure(failure as never)).toBe(true);
        expect((failure as { retryAfterSeconds: number }).retryAfterSeconds).toBe(47);
    });

    it('falls back to the limiter window when Retry-After is absent', async () => {
        const failure = await failureOf([
            {
                status: 429,
                body: {
                    error: {
                        code: 'rate_limit.exceeded',
                        message: 'Too many requests.',
                        details: {},
                        correlation_id: 'c7',
                    },
                },
            },
        ]);

        expect((failure as { retryAfterSeconds: number }).retryAfterSeconds).toBe(60);
    });

    it.each([
        ['auth.unauthenticated', 401],
        ['auth.email_unverified', 403],
        ['auth.step_up_required', 403],
        ['context.organisation_forbidden', 403],
        ['context.branch_out_of_scope', 403],
        ['context.organisation_required', 400],
        ['auth.invalid_credentials', 422],
        // Promoted out of the `server` projection with the kitchen-admin contract (K1).
        ['resource.not_found', 404],
    ])('passes %s through unchanged', async (code, status) => {
        const failure = await failureOf([
            {
                status,
                body: { error: { code, message: 'Nope.', details: {}, correlation_id: 'c8' } },
            },
        ]);
        expect((failure as { code: string }).code).toBe(code);
        expect((failure as { message: string }).message).toBe('Nope.');
    });

    /** A rejected TOTP is a wrong field, exactly as the mock reports it. */
    it('turns auth.two_factor_invalid into a field-level validation failure', async () => {
        const failure = await failureOf([
            {
                status: 422,
                body: {
                    error: {
                        code: 'auth.two_factor_invalid',
                        message: 'That code is not correct.',
                        details: {},
                        correlation_id: 'c8',
                    },
                },
            },
        ]);

        expect((failure as { code: string }).code).toBe('validation.failed');
        expect((failure as { fields: Record<string, string[]> }).fields['code']).toEqual([
            'That code is not correct.',
        ]);
    });

    /**
     * `authz.permission_denied` carries the denying RBAC step on the wire already (generated
     * `types.ts`), and K1's management endpoints add the permission code beside it. Both are read
     * defensively: a server that sends neither still produces a usable failure, with empty strings
     * rather than an invented permission name.
     */
    it('reads the permission and the denying step off an authorisation failure', async () => {
        const failure = await failureOf([
            {
                status: 403,
                body: {
                    error: {
                        code: 'authz.permission_denied',
                        message: 'Your role does not allow that.',
                        details: {
                            permission: 'catalogue.publish_organisation',
                            reason: 'no role in this membership carries the code',
                        },
                        correlation_id: 'c10a',
                    },
                },
            },
        ]);

        expect((failure as { code: string }).code).toBe('authz.permission_denied');
        expect((failure as { permission: string }).permission).toBe(
            'catalogue.publish_organisation',
        );
        expect((failure as { reason: string }).reason).toBe(
            'no role in this membership carries the code',
        );
        expect((failure as { retryable: boolean }).retryable).toBe(false);
    });

    it('degrades to empty strings when the envelope names no permission', async () => {
        const failure = await failureOf([
            {
                status: 403,
                body: {
                    error: {
                        code: 'authz.permission_denied',
                        message: 'Denied.',
                        details: {},
                        correlation_id: 'c10b',
                    },
                },
            },
        ]);

        expect((failure as { code: string }).code).toBe('authz.permission_denied');
        expect((failure as { permission: string }).permission).toBe('');
        expect((failure as { reason: string }).reason).toBe('');
    });

    /** The optimistic-locking rejection (plan §4.13): the editor needs the server's version. */
    it('reads the current lock version off a conflict, and omits it when absent', async () => {
        const withVersion = await failureOf([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'Somebody else saved first.',
                        details: { current_lock_version: 4 },
                        correlation_id: 'c10c',
                    },
                },
            },
        ]);

        expect((withVersion as { code: string }).code).toBe('resource.conflict');
        expect((withVersion as { currentLockVersion?: number }).currentLockVersion).toBe(4);

        const withoutVersion = await failureOf([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'That slug is already taken.',
                        details: {},
                        correlation_id: 'c10d',
                    },
                },
            },
        ]);

        expect((withoutVersion as { code: string }).code).toBe('resource.conflict');
        expect(Object.hasOwn(withoutVersion as object, 'currentLockVersion')).toBe(false);
    });

    /**
     * Codes outside the client vocabulary keep the server's message and become `server`; a `4xx` is
     * not retryable, a `5xx` is.
     */
    it('projects an unmapped 4xx onto a non-retryable server failure', async () => {
        const failure = await failureOf([
            {
                status: 400,
                body: {
                    error: {
                        code: 'request.invalid',
                        message: 'The request could not be understood.',
                        details: {},
                        correlation_id: 'c10',
                    },
                },
            },
        ]);

        expect((failure as { code: string }).code).toBe('server');
        expect((failure as { retryable: boolean }).retryable).toBe(false);
        expect((failure as { message: string }).message).toBe(
            'The request could not be understood.',
        );
    });

    it('projects a 500 onto a retryable server failure', async () => {
        const failure = await failureOf([
            {
                status: 500,
                body: {
                    error: {
                        code: 'server.internal_error',
                        message: 'Something went wrong.',
                        details: {},
                        correlation_id: 'c11',
                    },
                },
            },
        ]);

        expect((failure as { code: string }).code).toBe('server');
        expect((failure as { retryable: boolean }).retryable).toBe(true);
    });

    it('uses the correlation header when the body is not an envelope', async () => {
        const failure = await failureOf([
            {
                status: 502,
                body: '<html>bad gateway</html>',
                headers: { 'X-Correlation-Id': 'c12' },
            },
        ]);

        expect((failure as { code: string }).code).toBe('server');
        expect((failure as { correlationId: string }).correlationId).toBe('c12');
    });

    /** A request that never reached the server is `network`, never `server`. */
    it('reports a transport failure as network', async () => {
        const repositories = createApiRepositories({
            baseUrl: 'https://api.example',
            tokenStore: createMemoryTokenStore('token'),
            fetch: () => Promise.reject(new TypeError('Failed to fetch')),
        });

        await expect(repositories.session.me()).rejects.toMatchObject({ code: 'network' });
    });
});

describe('me', () => {
    it('maps the envelope and remembers the permissions stamp', async () => {
        const { repositories } = harness([ME_OK], createMemoryTokenStore('token'));
        const me = await repositories.session.me();

        expect(me.user.email).toBe('a@b.test');
        expect(me.profile.displayName).toBe('Rami Khoury');
        expect(me.profile.preferredLocale).toBe('ar');
        expect(me.activeContext).toBeNull();
    });
});

describe('confirmPassword', () => {
    it('turns the timeout into an absolute expiry', async () => {
        const { repositories } = harness(
            [
                {
                    status: 200,
                    body: { data: { confirmed: true, timeout_seconds: 10800 }, meta: {} },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const before = Date.now();
        const result = await repositories.auth.confirmPassword({ password: 'password' });
        const confirmedUntil = Date.parse(result.confirmedUntil);

        expect(confirmedUntil).toBeGreaterThanOrEqual(before + 10_800_000);
    });
});

/* ── J2: closure ─────────────────────────────────────────────────────────────────────────────── */

const CLOSURE_BLOCKERS_MIXED = [
    { code: 'open_orders', status: 'blocking', count: 2, reason: 'orders_in_flight' },
    { code: 'active_subscriptions', status: 'clear', count: 0, reason: null },
    {
        code: 'unsettled_credit_memos',
        status: 'advisory',
        count: 1,
        reason: 'credit_memos_unsettled',
    },
    { code: 'wallet_balance', status: 'not_applicable', count: 0, reason: 'no_wallet_module' },
];

const LIVE_NONE_OK: Scripted = {
    status: 200,
    body: {
        data: { closure_request: null, blockers: CLOSURE_BLOCKERS_MIXED },
        meta: { correlation_id: 'c-live' },
    },
};

describe('closure (J2, docs/api/conventions.md)', () => {
    it('derives preconditions from the live read: only blocking stops a closure', async () => {
        const { repositories, calls } = harness([LIVE_NONE_OK], createMemoryTokenStore('token'));
        const preconditions = await repositories.account.getClosurePreconditions();

        expect(calls[0]!.url).toBe('https://api.example/api/v1/me/closure-requests/live');
        expect(preconditions.canClose).toBe(false);
        expect(preconditions.blockers).toHaveLength(4);
        // The four statuses reach the caller whole: `not_applicable` is not smoothed into `clear`,
        // and the advisory memo neither blocks nor disappears.
        expect(preconditions.blockers[2]).toMatchObject({ status: 'advisory', count: 1 });
        expect(preconditions.blockers[3]).toMatchObject({
            status: 'not_applicable',
            reason: 'no_wallet_module',
        });
        expect(preconditions.retainedRecordCodes).toContain('orders_anonymised');
    });

    it('treats advisory and not_applicable as no bar to closing', async () => {
        const clear = {
            ...LIVE_NONE_OK,
            body: {
                data: {
                    closure_request: null,
                    blockers: CLOSURE_BLOCKERS_MIXED.filter((entry) => entry.status !== 'blocking'),
                },
                meta: { correlation_id: 'c-live' },
            },
        };
        const { repositories } = harness([clear], createMemoryTokenStore('token'));

        await expect(repositories.account.getClosurePreconditions()).resolves.toMatchObject({
            canClose: true,
        });
    });

    it('answers null when nothing is in flight', async () => {
        const { repositories } = harness([LIVE_NONE_OK], createMemoryTokenStore('token'));
        await expect(repositories.account.getLiveClosureRequest()).resolves.toBeNull();
    });

    it('resolves a blocked full closure as a success with no challenge (D-073)', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 202,
                    body: {
                        data: {
                            closure_request: {
                                request_id: 'closure-1',
                                scope: 'full',
                                status: 'requested',
                                blocked: true,
                                blockers: CLOSURE_BLOCKERS_MIXED,
                                verification_required: true,
                                destination_masked: null,
                                expires_in_seconds: null,
                                scheduled_for: null,
                            },
                        },
                        meta: { correlation_id: 'c-blocked' },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const ticket = await repositories.account.requestClosure({
            reasonCode: 'moving_away',
            scope: 'full',
        });

        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.body).toEqual({ reason_code: 'moving_away', scope: 'full' });
        expect(ticket.blocked).toBe(true);
        expect(ticket.challenge).toBeNull();
        expect(ticket.reasonCode).toBe('moving_away');
        expect(ticket.blockers.map((blocker) => blocker.status)).toContain('blocking');
    });

    it('carries the challenge, its mask and its countdown when the code went out', async () => {
        const before = Date.now();
        const { repositories, calls } = harness(
            [
                {
                    status: 202,
                    body: {
                        data: {
                            closure_request: {
                                request_id: 'closure-2',
                                scope: 'full',
                                status: 'requested',
                                blocked: false,
                                blockers: [],
                                verification_required: true,
                                destination_masked: 'n••••@example.test',
                                expires_in_seconds: 300,
                                scheduled_for: null,
                            },
                        },
                        meta: { correlation_id: 'c-clear' },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const ticket = await repositories.account.requestClosure({
            reasonCode: 'privacy_concerns',
            reasonNote: 'Please remove everything.',
            scope: 'full',
        });

        expect(calls[0]!.body).toEqual({
            reason_code: 'privacy_concerns',
            reason_note: 'Please remove everything.',
            scope: 'full',
        });
        expect(ticket.challenge).not.toBeNull();
        expect(ticket.challenge!.purpose).toBe('closure_step_up');
        expect(ticket.challenge!.maskedDestination).toBe('n••••@example.test');
        expect(Date.parse(ticket.challenge!.expiresAt)).toBeGreaterThanOrEqual(before + 300_000);
        // The wire never names the challenge (it is bound to the request row), so there is no
        // identifier to resend against — stated, not invented.
        expect(ticket.challenge!.id).toBe('');
        expect(ticket.challenge!.resendsRemaining).toBe(0);
    });

    it('verifies against the request and maps the scheduled window', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            closure_request: {
                                request_id: 'closure-2',
                                scope: 'full',
                                status: 'scheduled',
                                blocked: false,
                                blockers: [],
                                verification_required: false,
                                scheduled_for: '2026-08-10T00:00:00Z',
                            },
                        },
                        meta: { correlation_id: 'c-verify' },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const ticket = await repositories.account.verifyClosure({
            ticketId: 'closure-2',
            code: '123456',
        });

        expect(calls[0]!.url).toBe(
            'https://api.example/api/v1/me/closure-requests/closure-2/verify',
        );
        expect(calls[0]!.body).toEqual({ code: '123456' });
        expect(ticket.status).toBe('scheduled');
        expect(ticket.scheduledFor).toBe('2026-08-10T00:00:00Z');
        expect(ticket.challenge).toBeNull();
    });

    it('cancels with a DELETE that answers the row, not a 204', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            closure_request: {
                                request_id: 'closure-2',
                                scope: 'full',
                                status: 'cancelled',
                                cancelled_at: '2026-08-03T12:00:00Z',
                                cancelled_because: 'customer_cancelled',
                            },
                        },
                        meta: { correlation_id: 'c-cancel' },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const ticket = await repositories.account.cancelClosure({ ticketId: 'closure-2' });

        expect(calls[0]!.method).toBe('DELETE');
        expect(calls[0]!.url).toBe('https://api.example/api/v1/me/closure-requests/closure-2');
        expect(ticket.status).toBe('cancelled');
        expect(ticket.challenge).toBeNull();
    });
});

/* ── B2: the wind-down ───────────────────────────────────────────────────────────────────────── */

const OFFBOARDING_WIRE = {
    id: 'offboarding-1',
    organisation_id: 'organisation-9',
    b2b_agreement_id: 'agreement-1',
    status: 'settlement_pending',
    trigger: 'non_renewal',
    reason: null,
    reason_note: 'Not renewing for 2027.',
    requested_by: 'operator-1',
    requested_at: '2026-08-01T09:00:00Z',
    notice_period_days: 30,
    notice_served_at: '2026-08-01T09:00:00Z',
    effective_on: '2026-08-31',
    settlement: {
        status: 'pending',
        note: null,
        checks: [
            { check: 'open_orders', outcome: 'clear', reason: null, detail: null },
            {
                check: 'outstanding_invoices',
                outcome: 'not_applicable',
                reason: 'invoicing_module_absent',
                detail: null,
            },
        ],
        started_at: '2026-08-02T09:00:00Z',
        resolved_at: null,
        waived_by: null,
        waiver_reason: null,
    },
    signoff: {
        awaiting_since: null,
        signed_off_at: null,
        signed_off_by: null,
        signatory_name: null,
        signatory_title: null,
        consent_statement: null,
        document_sha256: null,
    },
    revocation: {
        started_at: null,
        completed_at: null,
        memberships_revoked: null,
        tokens_deleted: null,
    },
    archive: { started_at: null, summary: null, legal_entity_retained: null },
    completed_at: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
    lock_version: 3,
    allowed_transitions: ['settlement_pending', 'awaiting_signoff', 'cancelled'],
};

const OFFBOARDING_OK: Scripted = {
    status: 200,
    body: { data: { offboarding: OFFBOARDING_WIRE }, meta: { correlation_id: 'c-off' } },
};

describe('offboarding (B2, docs/api/conventions.md)', () => {
    it('reads the wind-up by its own key under the platform prefix', async () => {
        const { repositories, calls } = harness([OFFBOARDING_OK], createMemoryTokenStore('token'));
        const offboarding = await repositories.b2bApplication.getOffboarding({
            organisationId: 'offboarding-1',
        });

        expect(calls[0]!.url).toBe(
            'https://api.example/api/v1/platform/b2b/offboardings/offboarding-1',
        );
        expect(offboarding).not.toBeNull();
        expect(offboarding!.organisationId).toBe('organisation-9');
        expect(offboarding!.noticePeriodDays).toBe(30);
        expect(offboarding!.allowedTransitions).toEqual([
            'settlement_pending',
            'awaiting_signoff',
            'cancelled',
        ]);
        // `not_applicable` reaches the caller with its reason — never smoothed into a pass.
        expect(offboarding!.settlement.checks[1]).toMatchObject({
            outcome: 'not_applicable',
            reason: 'invoicing_module_absent',
        });
        // Nothing is signed, so nothing claims a code was consumed.
        expect(offboarding!.signoff.otpVerified).toBe(false);
    });

    it('answers null for a wind-up that does not exist', async () => {
        const { repositories } = harness(
            [
                {
                    status: 404,
                    body: {
                        error: {
                            code: 'resource.not_found',
                            message: 'No such wind-up.',
                            details: {},
                            correlation_id: 'c-404',
                        },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        await expect(
            repositories.b2bApplication.getOffboarding({ organisationId: 'organisation-9' }),
        ).resolves.toBeNull();
    });

    it('re-runs the settlement checks without an If-Match: the state machine is the guard', async () => {
        const { repositories, calls } = harness([OFFBOARDING_OK], createMemoryTokenStore('token'));
        await repositories.b2bApplication.runSettlementChecks({
            offboardingId: 'offboarding-1',
            lockVersion: 3,
        });

        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.url).toBe(
            'https://api.example/api/v1/platform/b2b/offboardings/offboarding-1/settlement-checks',
        );
        expect(calls[0]!.headers['If-Match']).toBeUndefined();
    });

    it('issues the signoff challenge and maps the 202 envelope', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 202,
                    body: {
                        data: {
                            challenge: {
                                challenge_id: 'challenge-7',
                                purpose: 'b2b_signatory',
                                channel: 'email',
                                destination_masked: 's••••@company.test',
                                expires_at: '2026-08-03T12:05:00Z',
                                resend_available_at: '2026-08-03T12:00:45Z',
                                resend_cooldown_seconds: 45,
                                attempts_remaining: 3,
                                resends_remaining: 3,
                                available_channels: [{ channel: 'email', simulated: false }],
                                simulated: false,
                            },
                        },
                        meta: { correlation_id: 'c-challenge' },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const challenge = await repositories.b2bApplication.issueSignoffChallenge({
            offboardingId: 'offboarding-1',
        });

        expect(calls[0]!.url).toBe(
            'https://api.example/api/v1/platform/b2b/offboardings/offboarding-1/signoff-challenges',
        );
        expect(challenge.id).toBe('challenge-7');
        expect(challenge.purpose).toBe('b2b_signatory');
        expect(challenge.maskedDestination).toBe('s••••@company.test');
    });

    it('spends the packed token first, then signs off with the consumed challenge', async () => {
        const signed = {
            ...OFFBOARDING_WIRE,
            status: 'signed_off',
            signoff: {
                awaiting_since: '2026-08-02T10:00:00Z',
                signed_off_at: '2026-08-03T12:01:00Z',
                signed_off_by: 'signatory-1',
                signatory_name: 'Samira Haddad',
                signatory_title: 'Managing Director',
                consent_statement: 'I confirm I am authorised to bind this company…',
                document_sha256: 'a'.repeat(64),
            },
        };
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: { data: { verified: true }, meta: { correlation_id: 'c-verify' } },
                },
                {
                    status: 200,
                    body: { data: { offboarding: signed }, meta: { correlation_id: 'c-signed' } },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const offboarding = await repositories.b2bApplication.signOffOffboarding({
            offboardingId: 'offboarding-1',
            typedName: 'Samira Haddad',
            signatoryTitle: 'Managing Director',
            authorityConfirmed: true,
            documentSha256: '',
            verificationToken: 'challenge-7:123456',
            lockVersion: 3,
        });

        expect(calls[0]!.url).toBe(
            'https://api.example/api/v1/verification/challenges/challenge-7/verify',
        );
        expect(calls[0]!.body).toEqual({ code: '123456' });
        expect(calls[1]!.url).toBe(
            'https://api.example/api/v1/platform/b2b/offboardings/offboarding-1/signoff',
        );
        expect(calls[1]!.body).toMatchObject({
            signatory_name: 'Samira Haddad',
            otp_challenge_id: 'challenge-7',
            // The empty echo means "the wind-up published no digest", which the wire spells null.
            document_sha256: null,
        });
        // A recorded sign-off is a proved one: the service refuses anything else.
        expect(offboarding.signoff.otpVerified).toBe(true);
    });

    it('refuses a token that does not carry both halves before anything is sent', async () => {
        const { repositories, calls } = harness([OFFBOARDING_OK], createMemoryTokenStore('token'));

        await expect(
            repositories.b2bApplication.signOffOffboarding({
                offboardingId: 'offboarding-1',
                typedName: 'Samira Haddad',
                signatoryTitle: 'Managing Director',
                authorityConfirmed: true,
                documentSha256: '',
                verificationToken: 'challenge-7',
                lockVersion: 3,
            }),
        ).rejects.toMatchObject({ code: 'b2b.signatory_required' });
        expect(calls).toHaveLength(0);
    });

    it('refuses to sign off without the authority claim', async () => {
        const { repositories, calls } = harness([OFFBOARDING_OK], createMemoryTokenStore('token'));

        await expect(
            repositories.b2bApplication.signOffOffboarding({
                offboardingId: 'offboarding-1',
                typedName: 'Samira Haddad',
                signatoryTitle: 'Managing Director',
                authorityConfirmed: false,
                documentSha256: '',
                verificationToken: 'challenge-7:123456',
                lockVersion: 3,
            }),
        ).rejects.toMatchObject({ code: 'validation.failed' });
        expect(calls).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * S1 — the two subscription reads that are served
 *
 * The other four methods of that wave stay rejections and are pinned as such below, because "this
 * one is deliberately not wired" is exactly the kind of fact that quietly stops being true.
 * ---------------------------------------------------------------------------------------------- */

const WIRE_BALANCE = {
    status: 'active',
    balance_days_total: 20,
    balance_days_consumed: 6,
    remaining_days: 14,
    per_day_minor: 1800,
    currency_code: 'USD',
    weekdays: [1, 2, 3, 4, 5],
    next_delivery_date: '2026-08-11',
    skipped_days: 2,
};

/** A customer subscription as the enriched projection serves it. */
const WIRE_SUBSCRIPTION = {
    id: 'subscription-1',
    status: 'active',
    catalogue_item_id: 'plan-1',
    catalogue_item_variant_id: 'variant-1',
    plan_duration_id: 'duration-1',
    sales_channel_id: 'channel-1',
    currency_code: 'USD',
    captured_unit_price_minor: 2000,
    captured_discount_percent: '10.00',
    effective_day_price_minor: 1800,
    captured_at: '2026-08-01T09:00:00+00:00',
    weekdays: [1, 3, 5],
    delivery_window_code: 'morning',
    customer_address_id: 'address-1',
    no_substitutions: false,
    balance_days_total: 20,
    balance_days_consumed: 6,
    remaining_days: 14,
    next_delivery_date: '2026-08-11',
    pause_count: 0,
    lock_version: 3,
    created_at: '2026-08-01T09:00:00+00:00',
    updated_at: '2026-08-03T09:00:00+00:00',
    plan: { id: 'plan-1', name: 'Balanced 2 meals a day', slug: 'balanced-2' },
    kitchen: { id: 'kitchen-1', name: 'Verdant Kitchen' },
    configuration: { id: 'variant-1', code: 'lunch-dinner', name: 'Lunch & dinner' },
    duration: { id: 'duration-1', code: '4w', kind: 'fixed_days', days: 28, name: 'Four weeks' },
    delivery_address: {
        id: 'address-1',
        label: 'Home',
        line_one: '12 Marina Walk',
        line_two: null,
        delivery_area_id: 'area-1',
        directions: 'Ring the bell twice',
    },
    starts_on: '2026-08-05',
    // 1800 × three delivery weekdays.
    weekly_price_minor: 9000,
    allows_free_selection: true,
    change_cutoff_hours: 12,
    skipped_dates: ['2026-08-08'],
    chosen_catalogue_item_ids: ['meal-7'],
};

describe('subscriptions (S1)', () => {
    it('reads the balance from the single subscription read and prices it per day', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            subscription: {
                                id: 'subscription-1',
                                status: 'active',
                                lock_version: 4,
                                balance: WIRE_BALANCE,
                            },
                        },
                        meta: { correlation_id: 'correlation-1' },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const balance = await repositories.commerce.getSubscriptionBalance(
            'subscription-1' as never,
        );

        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('https://api.example/api/v1/me/subscriptions/subscription-1');
        expect(balance).toEqual({
            subscriptionId: 'subscription-1',
            state: 'active',
            days: { total: 20, consumed: 6, remaining: 14 },
            // The *effective* per-day price — the number a credit memo multiplies.
            perDayPrice: { amount: 1800, currency: 'USD' },
            skippedDays: 2,
            nextDeliveryDate: '2026-08-11',
            deliveryWeekdays: [1, 2, 3, 4, 5],
            changeCutoffHours: 24,
        });
    });

    it('projects a completed subscription onto `expired`', async () => {
        const { repositories } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            subscription: {
                                id: 'subscription-1',
                                status: 'completed',
                                lock_version: 9,
                                balance: { ...WIRE_BALANCE, status: 'completed' },
                            },
                        },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        expect((await repositories.commerce.getSubscriptionBalance('s-1' as never)).state).toBe(
            'expired',
        );
    });

    /** A balance-less single read is a broken envelope: answering zero days would say "spent". */
    it('refuses a single read that arrived without its balance', async () => {
        const { repositories } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: { subscription: { id: 'subscription-1', status: 'active' } },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        await expect(
            repositories.commerce.getSubscriptionBalance('subscription-1' as never),
        ).rejects.toMatchObject({ code: 'server' });
    });

    it('answers the ledger as one complete page, dropping a status it cannot name', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: [
                            {
                                id: 'delivery-1',
                                delivery_date: '2026-08-10',
                                delivery_window_code: 'morning',
                                status: 'delivered',
                                consumed: true,
                                skip_reason: null,
                                meals: [],
                            },
                            {
                                id: 'delivery-2',
                                delivery_date: '2026-08-11',
                                delivery_window_code: null,
                                status: 'skipped_customer',
                                consumed: false,
                                skip_reason: 'customer_request',
                                meals: [],
                            },
                            // A status this build does not know. Dropped rather than defaulted —
                            // showing it as `scheduled` would promise food.
                            {
                                id: 'delivery-3',
                                delivery_date: '2026-08-12',
                                status: 'teleported',
                                consumed: false,
                                meals: [],
                            },
                        ],
                        meta: { correlation_id: 'c', count: 3, balance: WIRE_BALANCE },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const page = await repositories.commerce.listSubscriptionDeliveries(
            'subscription-1' as never,
        );

        expect(calls[0]?.url).toBe(
            'https://api.example/api/v1/me/subscriptions/subscription-1/deliveries',
        );
        expect(page.items).toEqual([
            {
                id: 'delivery-1',
                date: '2026-08-10',
                status: 'delivered',
                consumed: true,
                skipReason: null,
                slotCode: 'morning',
            },
            {
                id: 'delivery-2',
                date: '2026-08-11',
                status: 'skipped_customer',
                consumed: false,
                skipReason: 'customer_request',
                slotCode: '',
            },
        ]);
        // Unpaginated on the wire, so there is no second page and both fields say so. `totalCount`
        // is the server's count of the *whole* ledger, not of what survived the filter.
        expect(page.nextCursor).toBeNull();
        expect(page.hasMore).toBe(false);
        expect(page.totalCount).toBe(3);
    });

    it('applies the status filter the endpoint has no parameter for', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: [
                            {
                                id: 'delivery-1',
                                delivery_date: '2026-08-10',
                                status: 'delivered',
                                consumed: true,
                                meals: [],
                            },
                            {
                                id: 'delivery-2',
                                delivery_date: '2026-08-11',
                                status: 'scheduled',
                                consumed: false,
                                meals: [],
                            },
                        ],
                        meta: { count: 2 },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const page = await repositories.commerce.listSubscriptionDeliveries(
            'subscription-1' as never,
            { statuses: ['scheduled'], cursor: 'ignored', limit: 5 },
        );

        // The cursor and the limit are accepted and ignored rather than sent to an endpoint that
        // takes neither.
        expect(calls[0]?.url).not.toContain('?');
        expect(page.items.map((delivery) => delivery.id)).toEqual(['delivery-2']);
    });

    /* ── the four the backend had to open before they could be wired ─────────────────────────── */

    it('quotes by day count, never by a channel or a duration identifier', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            quote: {
                                currency_code: 'USD',
                                days: 20,
                                list_price_minor: 2000,
                                discount_percent: '10.00',
                                per_day_minor: 1800,
                                total_minor: 36000,
                                duration_code: '4w',
                                duration_kind: 'fixed_days',
                                available_weekdays: [1, 2, 3, 4, 5],
                                allows_free_selection: true,
                                change_cutoff_hours: 12,
                            },
                        },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const quote = await repositories.commerce.getSubscriptionQuote({
            planId: 'plan-1' as never,
            variantId: 'variant-1' as never,
            duration: '4w',
        });

        // Three coordinates. A shopper can obtain none of a channel identifier, a duration
        // identifier or a tariff — so the request carries the day count the public plan read
        // already publishes, and the server resolves the rest.
        const url = new URL(calls[0]!.url);
        expect(url.pathname).toBe('/api/v1/subscriptions/quote');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            catalogue_item_id: 'plan-1',
            catalogue_item_variant_id: 'variant-1',
            plan_duration_days: '28',
        });

        // The seven-probe hack's replacement, and the two rules a configurator draws with.
        expect(quote.availableWeekdays).toEqual([1, 2, 3, 4, 5]);
        expect(quote.allowsFreeSelection).toBe(true);
        // The plan's own cut-off, not the platform default — the 24-hour rule is configuration.
        expect(quote.changeCutoffHours).toBe(12);
        expect(quote.available).toBe(true);
        expect(quote.refusals).toEqual([]);
        expect(quote.total).toEqual({ amount: 36000, currency: 'USD' });
        expect(quote.discountPercent).toBe(10);
    });

    it('draws a refused quote instead of throwing it', async () => {
        const { repositories } = harness(
            [
                {
                    status: 409,
                    body: {
                        error: {
                            code: 'subscription.refused',
                            message: 'That run is not offered for this configuration.',
                            details: {
                                reasons: [
                                    { reason: 'duration_not_offered', duration_days: 28 },
                                    // Not in this build's vocabulary: dropped rather than shown
                                    // to somebody as a raw code.
                                    { reason: 'invented_by_a_later_backend' },
                                ],
                            },
                            correlation_id: 'c',
                        },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const quote = await repositories.commerce.getSubscriptionQuote({
            planId: 'plan-1' as never,
            variantId: 'variant-1' as never,
            duration: '4w',
        });

        // A configurator draws "this duration is not offered"; it does not crash on it.
        expect(quote.available).toBe(false);
        expect(quote.refusals).toEqual(['duration_not_offered']);
        expect(quote.days).toBe(0);
        expect(quote.total.amount).toBe(0);
        expect(quote.availableWeekdays).toEqual([]);
    });

    it('cancels and answers with the credit memo in the same breath', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            subscription: { ...WIRE_SUBSCRIPTION, status: 'cancelled' },
                            credit_memo: {
                                id: 'memo-1',
                                reason: 'subscription_cancelled',
                                unused_days: 14,
                                per_day_minor: 1800,
                                amount_minor: 25200,
                                currency_code: 'USD',
                                status: 'recorded',
                                settlement: 'manual',
                                recorded_at: '2026-08-03T10:00:00+00:00',
                            },
                        },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const result = await repositories.commerce.cancelSubscription('subscription-1' as never, {
            reason: 'too_expensive',
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe(
            'https://api.example/api/v1/me/subscriptions/subscription-1/cancel',
        );
        expect(calls[0]?.body).toEqual({ reason: 'too_expensive' });
        // No `If-Match`: the header is honoured on every subscription write and demanded by none,
        // and the contract carries no lock version to send.
        expect(calls[0]?.headers['If-Match']).toBeUndefined();

        expect(result.subscription.state).toBe('cancelled');
        expect(result.creditMemo).toEqual({
            id: 'memo-1',
            subscriptionId: 'subscription-1',
            reason: 'subscription_cancelled',
            unusedDays: 14,
            perDayPrice: { amount: 1800, currency: 'USD' },
            amount: { amount: 25200, currency: 'USD' },
            status: 'recorded',
            settlement: 'manual',
            recordedAt: '2026-08-03T10:00:00+00:00',
        });
    });

    it('maps the named facts the projection now carries', async () => {
        const { repositories } = harness(
            [{ status: 200, body: { data: { subscription: WIRE_SUBSCRIPTION }, meta: {} } }],
            createMemoryTokenStore('token'),
        );

        const subscription = await repositories.commerce.setSubscriptionWeekdays(
            'subscription-1' as never,
            { deliveryWeekdays: [1, 3, 5] },
        );

        expect(subscription.planName).toBe('Balanced 2 meals a day');
        expect(subscription.kitchenId).toBe('kitchen-1');
        // The effective per-day price times the delivery weekdays, computed server-side so a
        // client is not a second implementation of what somebody pays.
        expect(subscription.weeklyPrice).toEqual({ amount: 9000, currency: 'USD' });
        // The duration's *own* day count, never `balance_days_total` — twenty delivery days is
        // what a four-week plan on five weekdays buys.
        expect(subscription.configuration.duration).toBe('4w');
        expect(subscription.configuration.startDate).toBe('2026-08-05');
        expect(subscription.configuration.address.label).toBe('Home');
        expect(subscription.configuration.selectedMealIds).toEqual(['meal-7']);
        expect(subscription.skippedDates).toEqual(['2026-08-08']);
        // A pause lasts until somebody resumes it, so there is no instant to report.
        expect(subscription.pausedUntil).toBeNull();
    });

    it('refuses to name a run outside the closed duration vocabulary', async () => {
        const { repositories } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            subscription: {
                                ...WIRE_SUBSCRIPTION,
                                // A real kitchen run of forty days. Rounding it to "4 weeks" would
                                // show somebody the wrong commitment.
                                duration: { ...WIRE_SUBSCRIPTION.duration, days: 40 },
                            },
                        },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        await expect(
            repositories.commerce.setSubscriptionWeekdays('subscription-1' as never, {
                deliveryWeekdays: [1],
            }),
        ).rejects.toMatchObject({ code: 'server' });
    });

    it('sends only identifiers for meal choices and reads the names back', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: {
                            delivery_date: '2026-08-11',
                            meals: [
                                {
                                    slot: 'lunch',
                                    sequence: 1,
                                    catalogue_item_id: 'meal-7',
                                    name: 'Grilled Chicken & Quinoa',
                                    source: 'customer',
                                },
                                {
                                    slot: 'dinner',
                                    sequence: 1,
                                    catalogue_item_id: 'meal-9',
                                    name: 'Lentil Soup',
                                    source: 'kitchen_default',
                                },
                            ],
                        },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const choices = await repositories.commerce.setSubscriptionMealChoices(
            'subscription-1' as never,
            { date: '2026-08-11', choices: [{ slot: 'lunch', mealId: 'meal-7' as never }] },
        );

        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.url).toBe(
            'https://api.example/api/v1/me/subscriptions/subscription-1/choices',
        );
        // No name on the way out. A caller-supplied label on a surface this close to safety could
        // disagree with the dish actually recorded.
        expect(calls[0]?.body).toEqual({
            date: '2026-08-11',
            meals: [{ slot: 'lunch', catalogue_item_id: 'meal-7' }],
        });

        // The whole day comes back, including the default nobody overrode, each dish named by the
        // server — so the editor redraws from one answer.
        expect(choices).toEqual([
            {
                date: '2026-08-11',
                slot: 'lunch',
                mealId: 'meal-7',
                mealName: 'Grilled Chicken & Quinoa',
                source: 'customer',
            },
            {
                date: '2026-08-11',
                slot: 'dinner',
                mealId: 'meal-9',
                mealName: 'Lentil Soup',
                source: 'kitchen_default',
            },
        ]);
    });

    it('opens a cart, hydrates lines from marketplace meals, and previews without inventing delivery', async () => {
        const mealId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01';
        const cartId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b01';
        const lineId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b02';

        const wireCart = {
            id: cartId,
            organisation_id: 'org-1',
            sales_channel_id: 'channel-1',
            branch_id: null,
            status: 'open',
            currency_code: 'USD',
            expires_at: '2026-08-05T12:00:00Z',
            lock_version: 1,
            line_count: 1,
            created_at: '2026-08-04T10:00:00Z',
            updated_at: '2026-08-04T10:00:00Z',
            lines: [
                {
                    id: lineId,
                    catalogue_item_id: mealId,
                    catalogue_item_variant_id: null,
                    quantity: '2.0000',
                    delivery_date: '2026-08-06',
                    created_at: '2026-08-04T10:00:00Z',
                    updated_at: '2026-08-04T10:00:00Z',
                },
            ],
        };

        const wireMeal = {
            id: mealId,
            kitchen_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
            kitchen_name: 'Verdant Kitchen',
            name: 'Grilled chicken and freekeh',
            slug: 'grilled-chicken-freekeh',
            description: 'Grilled chicken breast, cracked freekeh and a lemon dressing.',
            meal_types: [],
            diet_classifications: ['high_protein'],
            cuisines: [],
            allergens: ['gluten'],
            serving: null,
            nutrition: null,
            price: { amount: 4200, currency: 'USD' },
            preparation_minutes: null,
            image_placeholder_id: 'meal-grilled-chicken-freekeh',
            availability: [],
            channels: {
                b2c: true,
                b2b: true,
                marketplace: false,
                pos: false,
                subscription: false,
                delivery: false,
                pickup: false,
                corporate: false,
            },
            rating: null,
            rating_count: 0,
        };

        const wirePreview = {
            cart_id: cartId,
            currency_code: 'USD',
            subtotal_minor: 8400,
            delivery_fee_minor: null,
            total_minor: 8400,
            line_count: 1,
            warnings: ['address_missing'],
        };

        const { repositories, calls } = harness(
            [
                { status: 200, body: { data: { cart: wireCart }, meta: {} } },
                { status: 200, body: { data: wireMeal, meta: {} } },
                { status: 200, body: { data: { preview: wirePreview }, meta: {} } },
            ],
            createMemoryTokenStore('token'),
        );

        const cart = await repositories.commerce.getCart();
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('https://api.example/api/v1/carts');
        expect(calls[0]?.body).toEqual({ channel_code: 'web-shop' });
        expect(calls[1]?.url).toContain(`/marketplace/meals/${mealId}`);
        expect(cart.items).toHaveLength(1);
        expect(cart.items[0]?.name).toBe('Grilled chicken and freekeh');
        expect(cart.items[0]?.unitPrice).toEqual({ amount: 4200, currency: 'USD' });
        expect(cart.subtotal).toEqual({ amount: 8400, currency: 'USD' });

        // A real server-side preview: one POST, the same numbers `LineProbe` and `ZoneResolver`
        // would resolve at placement, and no delivery fee invented for the address it was not given.
        const preview = await repositories.commerce.previewCheckout({ cartId: cart.id });
        expect(calls[2]?.method).toBe('POST');
        expect(calls[2]?.url).toBe('https://api.example/api/v1/checkouts/preview');
        expect(calls[2]?.body).toEqual({ cart_id: cartId });
        expect(preview.deliveryFee).toBeNull();
        expect(preview.paymentDeferred).toBe(true);
        expect(preview.total).toEqual({ amount: 8400, currency: 'USD' });
        expect(preview.warnings).toContain('checkout.address_missing');
    });

    /**
     * A three-line basket hydrates into three items, in the order the server listed them.
     *
     * `CartPresenter::line` carries no name and no price, so every line has to be fetched before a
     * basket can be drawn. Those fetches now go out together (`mapCart` uses `Promise.all`, where it
     * used to `await` inside a `for`) — which is what stopped a four-line basket costing four
     * sequential round trips on every add, remove and open.
     *
     * What this pins is the half that could silently break: the hydrated items must still line up
     * with `wire.lines` positionally. `Promise.all` resolves by position rather than by whichever
     * request answers first, and anything that replaces it — a keyed map, a settled-and-filtered
     * list — has to keep that property or a basket starts showing the wrong price against the wrong
     * dish.
     */
    it('hydrates every line of a basket, in the order the server listed them', async () => {
        const cartId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b10';
        const meals = [
            { id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c11', name: 'First', price: 1000 },
            { id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c12', name: 'Second', price: 2000 },
            { id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c13', name: 'Third', price: 3000 },
        ];

        const wireMeal = (meal: (typeof meals)[number]) => ({
            id: meal.id,
            kitchen_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
            kitchen_name: 'Verdant Kitchen',
            name: meal.name,
            slug: meal.name.toLowerCase(),
            description: '',
            meal_types: [],
            diet_classifications: [],
            cuisines: [],
            allergens: [],
            serving: null,
            nutrition: null,
            price: { amount: meal.price, currency: 'USD' },
            preparation_minutes: null,
            image_placeholder_id: null,
            availability: [],
            channels: {
                b2c: true,
                b2b: false,
                marketplace: false,
                pos: false,
                subscription: false,
                delivery: false,
                pickup: false,
                corporate: false,
            },
            rating: null,
            rating_count: 0,
        });

        const wireCart = {
            id: cartId,
            organisation_id: 'org-1',
            sales_channel_id: 'channel-1',
            branch_id: null,
            status: 'open',
            currency_code: 'USD',
            expires_at: '2026-08-05T12:00:00Z',
            lock_version: 3,
            line_count: meals.length,
            created_at: '2026-08-04T10:00:00Z',
            updated_at: '2026-08-04T10:05:00Z',
            lines: meals.map((meal, index) => ({
                id: `0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b2${String(index)}`,
                catalogue_item_id: meal.id,
                catalogue_item_variant_id: null,
                quantity: '1.0000',
                delivery_date: null,
                created_at: '2026-08-04T10:05:00Z',
                updated_at: '2026-08-04T10:05:00Z',
            })),
        };

        const { repositories, calls } = harness(
            [
                { status: 200, body: { data: { cart: wireCart }, meta: {} } },
                ...meals.map((meal) => ({
                    status: 200,
                    body: { data: wireMeal(meal), meta: {} },
                })),
            ],
            createMemoryTokenStore('token'),
        );

        const cart = await repositories.commerce.getCart();

        expect(cart.items.map((item) => item.name)).toEqual(['First', 'Second', 'Third']);
        expect(cart.items.map((item) => item.unitPrice.amount)).toEqual([1000, 2000, 3000]);
        expect(cart.subtotal).toEqual({ amount: 6000, currency: 'USD' });

        // One cart request, then one per line — no line fetched twice, none skipped.
        expect(calls).toHaveLength(4);
        expect(calls.slice(1).map((call) => call.url)).toEqual(
            meals.map((meal) => `https://api.example/api/v1/marketplace/meals/${meal.id}`),
        );
    });

    it('adds a cart line then hydrates the returned basket', async () => {
        const mealId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01';
        const cartId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b01';
        const lineId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b02';

        const wireCart = {
            id: cartId,
            organisation_id: 'org-1',
            sales_channel_id: 'channel-1',
            branch_id: null,
            status: 'open',
            currency_code: 'USD',
            expires_at: '2026-08-05T12:00:00Z',
            lock_version: 2,
            line_count: 1,
            created_at: '2026-08-04T10:00:00Z',
            updated_at: '2026-08-04T10:05:00Z',
            lines: [
                {
                    id: lineId,
                    catalogue_item_id: mealId,
                    catalogue_item_variant_id: null,
                    quantity: '1.0000',
                    delivery_date: null,
                    created_at: '2026-08-04T10:05:00Z',
                    updated_at: '2026-08-04T10:05:00Z',
                },
            ],
        };

        const wireMeal = {
            id: mealId,
            kitchen_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
            kitchen_name: 'Verdant Kitchen',
            name: 'Grilled chicken and freekeh',
            slug: 'grilled-chicken-freekeh',
            description: 'Grilled chicken.',
            meal_types: [],
            diet_classifications: [],
            cuisines: [],
            allergens: [],
            serving: null,
            nutrition: null,
            price: { amount: 4200, currency: 'USD' },
            preparation_minutes: null,
            image_placeholder_id: null,
            availability: [],
            channels: {
                b2c: true,
                b2b: false,
                marketplace: false,
                pos: false,
                subscription: false,
                delivery: false,
                pickup: false,
                corporate: false,
            },
            rating: null,
            rating_count: 0,
        };

        const { repositories, calls } = harness(
            [
                {
                    status: 201,
                    body: { data: { line: wireCart.lines[0], cart: wireCart }, meta: {} },
                },
                { status: 200, body: { data: wireMeal, meta: {} } },
            ],
            createMemoryTokenStore('token'),
        );

        const cart = await repositories.commerce.addCartItem(cartId as never, {
            mealId: mealId as never,
            quantity: 1,
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe(`https://api.example/api/v1/carts/${cartId}/items`);
        expect(calls[0]?.body).toEqual({ catalogue_item_id: mealId, quantity: 1 });
        expect(cart.itemCount).toBe(1);
        expect(cart.subtotal.currency).toBe('USD');
    });

    it('opens a wholesale cart and hydrates lines from the corporate catalogue', async () => {
        const mealId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01';
        const cartId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b01';
        const lineId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2b02';

        const wireCart = {
            id: cartId,
            organisation_id: 'org-1',
            sales_channel_id: 'channel-wholesale',
            branch_id: null,
            status: 'open',
            currency_code: 'USD',
            expires_at: '2026-08-05T12:00:00Z',
            lock_version: 1,
            line_count: 1,
            created_at: '2026-08-04T10:00:00Z',
            updated_at: '2026-08-04T10:00:00Z',
            lines: [
                {
                    id: lineId,
                    catalogue_item_id: mealId,
                    catalogue_item_variant_id: null,
                    quantity: '2.0000',
                    delivery_date: null,
                    created_at: '2026-08-04T10:00:00Z',
                    updated_at: '2026-08-04T10:00:00Z',
                },
            ],
        };

        const { repositories, calls } = harness(
            [
                { status: 200, body: { data: { cart: wireCart }, meta: {} } },
                {
                    status: 200,
                    body: {
                        data: {
                            item: {
                                id: mealId,
                                name: 'Wholesale lunch tray',
                                item_type: 'meal',
                                seller_organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
                                sales_channel_id: 'channel-wholesale',
                                price: { amount_minor: 1800, currency_code: 'USD' },
                            },
                        },
                        meta: {},
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const cart = await repositories.commerce.getCart({ channelCode: 'wholesale' });

        expect(calls[0]?.body).toEqual({ channel_code: 'wholesale' });
        expect(calls[1]?.url).toContain(`/b2b/catalogue/items/${mealId}`);
        expect(cart.items).toHaveLength(1);
        expect(cart.items[0]?.name).toBe('Wholesale lunch tray');
        expect(cart.items[0]?.unitPrice).toEqual({ amount: 1800, currency: 'USD' });
        expect(cart.subtotal).toEqual({ amount: 3600, currency: 'USD' });
    });

    it('lists subscriptions from the customer collection', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 200,
                    body: {
                        data: [WIRE_SUBSCRIPTION],
                        meta: { count: 1 },
                    },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const page = await repositories.commerce.listSubscriptions({ states: ['active'] });

        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.url).toBe('https://api.example/api/v1/me/subscriptions');
        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.planName).toBe('Balanced 2 meals a day');
    });

    it('creates a subscription with storefront duration days (no channel UUID)', async () => {
        const { repositories, calls } = harness(
            [
                {
                    status: 201,
                    body: { data: { subscription: WIRE_SUBSCRIPTION }, meta: {} },
                },
            ],
            createMemoryTokenStore('token'),
        );

        const created = await repositories.commerce.createSubscription({
            acknowledgedTerms: true,
            addressId: 'address-1',
            configuration: {
                planId: 'plan-1' as never,
                variantId: 'variant-1' as never,
                duration: '4w',
                startDate: '2026-08-05',
                deliveryWeekdays: [1, 3, 5],
                slotCode: 'morning',
                address: {
                    label: 'Home',
                    line1: '12 Marina Walk',
                    line2: null,
                    area: 'Marina',
                    city: 'Dubai',
                    countryCode: 'AE',
                    instructions: null,
                },
                dietClassifications: [],
                excludeAllergens: [],
                selectedMealIds: [],
            },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('https://api.example/api/v1/subscriptions');
        expect(calls[0]?.headers['Idempotency-Key']).toBeTruthy();
        expect(calls[0]?.body).toMatchObject({
            catalogue_item_id: 'plan-1',
            catalogue_item_variant_id: 'variant-1',
            plan_duration_days: 28,
            customer_address_id: 'address-1',
            weekdays: [1, 3, 5],
            delivery_window_code: 'morning',
            start_from: '2026-08-05',
        });
        expect(calls[0]?.body).not.toHaveProperty('sales_channel_id');
        expect(calls[0]?.body).not.toHaveProperty('plan_duration_id');
        expect(created.id).toBe('subscription-1');
    });

    it('refuses create without a saved address id', async () => {
        const { repositories, calls } = harness([], createMemoryTokenStore('token'));

        await expect(
            repositories.commerce.createSubscription({
                acknowledgedTerms: true,
                configuration: {
                    planId: 'plan-1' as never,
                    variantId: 'variant-1' as never,
                    duration: '4w',
                    startDate: '2026-08-05',
                    deliveryWeekdays: [1],
                    slotCode: 'morning',
                    address: {
                        label: 'Home',
                        line1: '12 Marina Walk',
                        line2: null,
                        area: 'Marina',
                        city: 'Dubai',
                        countryCode: 'AE',
                        instructions: null,
                    },
                    dietClassifications: [],
                    excludeAllergens: [],
                    selectedMealIds: [],
                },
            }),
        ).rejects.toMatchObject({ code: 'validation.failed' });
        expect(calls).toHaveLength(0);
    });

    it('pauses without sending a body the API does not accept', async () => {
        const { repositories, calls } = harness(
            [{ status: 200, body: { data: { subscription: WIRE_SUBSCRIPTION }, meta: {} } }],
            createMemoryTokenStore('token'),
        );

        await repositories.commerce.pause('subscription-1' as never, { until: '2026-09-01' });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe(
            'https://api.example/api/v1/me/subscriptions/subscription-1/pause',
        );
        expect(calls[0]?.body).toBeNull();
    });

    it('skips a day and then re-reads the subscription', async () => {
        const { repositories, calls } = harness(
            [
                { status: 201, body: { data: { delivery: {}, balance: WIRE_BALANCE }, meta: {} } },
                { status: 200, body: { data: { subscription: WIRE_SUBSCRIPTION }, meta: {} } },
            ],
            createMemoryTokenStore('token'),
        );

        await repositories.commerce.skipDay('subscription-1' as never, { date: '2026-08-12' });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe(
            'https://api.example/api/v1/me/subscriptions/subscription-1/skips',
        );
        expect(calls[0]?.body).toEqual({ date: '2026-08-12' });
        expect(calls[1]?.method).toBe('GET');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The six refusal codes (S1, J2, B2)
 * ---------------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------
 * The six refusal codes (S1, J2, B2)
 * ---------------------------------------------------------------------------------------------- */

describe('the refusal envelopes', () => {
    /** Drives one scripted error envelope through a repository call and returns the failure. */
    async function refusalOf(body: unknown, status = 409) {
        const { repositories } = harness([{ status, body }], createMemoryTokenStore('token'));
        try {
            await repositories.commerce.getSubscriptionBalance('subscription-1' as never);
        } catch (error) {
            if (error instanceof ApiError) return error.failure;
            throw error;
        }
        throw new Error('Expected the call to reject.');
    }

    it('lifts `reason` out of each subscription refusal and keeps the rest as context', async () => {
        const failure = await refusalOf({
            error: {
                code: 'subscription.change_refused',
                message: 'That is inside the cut-off.',
                details: {
                    reasons: [
                        {
                            reason: 'inside_cut_off',
                            delivery_date: '2026-08-11',
                            cut_off_hours: 24,
                            effective_from: '2026-08-13',
                        },
                        { reason: 'not_a_delivery_day' },
                        // No `reason`: nothing a screen could say about it.
                        { delivery_date: '2026-08-14' },
                    ],
                },
                correlation_id: 'correlation-9',
            },
        });

        expect(failure).toMatchObject({
            code: 'subscription.change_refused',
            message: 'That is inside the cut-off.',
            correlationId: 'correlation-9',
            retryable: false,
            reasons: [
                {
                    reason: 'inside_cut_off',
                    context: {
                        delivery_date: '2026-08-11',
                        cut_off_hours: 24,
                        effective_from: '2026-08-13',
                    },
                },
                { reason: 'not_a_delivery_day', context: {} },
            ],
        });
    });

    it('carries an empty reason list rather than inventing one', async () => {
        const failure = await refusalOf({
            error: {
                code: 'subscription.refused',
                message: 'No.',
                details: {},
                correlation_id: 'c',
            },
        });
        expect(failure).toMatchObject({ code: 'subscription.refused', reasons: [] });
    });

    it('carries the closure reason the wizard refetches on', async () => {
        const failure = await refusalOf({
            error: {
                code: 'closure.refused',
                message: 'A closure request is already in progress.',
                details: { reason: 'closure_already_in_flight' },
                correlation_id: 'c',
            },
        });
        expect(failure).toMatchObject({
            code: 'closure.refused',
            reason: 'closure_already_in_flight',
        });
    });

    it('carries the transitions still open, so the surface draws buttons from the server', async () => {
        const failure = await refusalOf({
            error: {
                code: 'offboarding.refused',
                message: 'An offboarding that is revoking cannot become cancelled.',
                details: {
                    reason: 'offboarding.transition_not_allowed',
                    status: 'revoking',
                    allowed_transitions: ['archiving'],
                },
                correlation_id: 'c',
            },
        });
        expect(failure).toMatchObject({
            code: 'offboarding.refused',
            reason: 'offboarding.transition_not_allowed',
            allowedTransitions: ['archiving'],
        });
    });

    it('names every outstanding settlement check, not the first', async () => {
        const failure = await refusalOf({
            error: {
                code: 'offboarding.settlement_outstanding',
                message: 'Settlement is not resolved.',
                details: {
                    reason: 'offboarding.settlement_outstanding',
                    blockers: ['open_buyer_orders', 'unsettled_credit_memos'],
                },
                correlation_id: 'c',
            },
        });
        expect(failure).toMatchObject({
            code: 'offboarding.settlement_outstanding',
            blockers: ['open_buyer_orders', 'unsettled_credit_memos'],
        });
    });

    /** The one of the six that carries nothing structured — no repository method reaches it yet. */
    it('keeps the record-export refusal as its own code rather than a generic server error', async () => {
        const failure = await refusalOf({
            error: {
                code: 'record_export.unavailable',
                message: 'This bundle is not available to download.',
                details: { reason: 'record_export.not_downloadable', status: 'building' },
                correlation_id: 'c',
            },
        });
        expect(failure).toMatchObject({ code: 'record_export.unavailable', retryable: false });
    });
});

describe('numbered pages on the kitchen catalogue (docs/api/conventions.md)', () => {
    const CATEGORIES_OK: Scripted = {
        status: 200,
        body: { data: [], meta: { correlation_id: 'c-categories' } },
    };

    /** One ingredient row, trimmed to what `mapIngredientAdmin` actually reads. */
    function ingredientRow(id: string) {
        return {
            id,
            name_en: `Ingredient ${id}`,
            name_ar: `مكون ${id}`,
            slug: id,
            status: 'active',
            is_platform: false,
            aliases: [],
            allergens: [],
            diet_classifications: [],
            ingredient_category_id: null,
            default_unit_code: 'kg',
            organisation_id: 'org-1',
            notes: null,
            lock_version: 0,
        };
    }

    it('sends page and per_page, and reports the total the server counted', async () => {
        const { repositories, calls } = harness([
            CATEGORIES_OK,
            {
                status: 200,
                body: {
                    data: [ingredientRow('a'), ingredientRow('b')],
                    meta: {
                        correlation_id: 'c-page',
                        count: 2,
                        page: 2,
                        per_page: 2,
                        total_count: 5,
                        total_pages: 3,
                    },
                },
            },
        ]);

        const page = await repositories.kitchenAdmin.listIngredients({ page: 2, perPage: 2 });

        const url = new URL(calls[1]!.url);
        expect(url.searchParams.get('page')).toBe('2');
        expect(url.searchParams.get('per_page')).toBe('2');
        expect(url.searchParams.get('cursor')).toBeNull();

        expect(page.items).toHaveLength(2);
        expect(page.totalCount).toBe(5);
        // Page 2 of 3, so there is more — and no cursor, because a caller that sent `page` is not
        // walking and must not be handed something to walk with.
        expect(page.hasMore).toBe(true);
        expect(page.nextCursor).toBeNull();
    });

    it('closes the list on the last page', async () => {
        const { repositories } = harness([
            CATEGORIES_OK,
            {
                status: 200,
                body: {
                    data: [ingredientRow('e')],
                    meta: {
                        correlation_id: 'c-last',
                        count: 1,
                        page: 3,
                        per_page: 2,
                        total_count: 5,
                        total_pages: 3,
                    },
                },
            },
        ]);

        const page = await repositories.kitchenAdmin.listIngredients({ page: 3, perPage: 2 });

        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeNull();
        expect(page.totalCount).toBe(5);
    });

    it('leaves the keyset walk alone when no page is asked for', async () => {
        const { repositories, calls } = harness([
            CATEGORIES_OK,
            {
                status: 200,
                body: {
                    data: [ingredientRow('a')],
                    meta: {
                        correlation_id: 'c-cursor',
                        count: 1,
                        next_cursor: 'abc',
                        has_more: true,
                    },
                },
            },
        ]);

        const page = await repositories.kitchenAdmin.listIngredients({ limit: 1 });

        const url = new URL(calls[1]!.url);
        expect(url.searchParams.get('page')).toBeNull();
        expect(url.searchParams.get('per_page')).toBeNull();
        expect(url.searchParams.get('limit')).toBe('1');

        expect(page.nextCursor).toBe('abc');
        expect(page.hasMore).toBe(true);
        // Null rather than 0: the keyset path reads one row beyond the page instead of counting,
        // so there is no total to report and a 0 here would read as "the list is empty".
        expect(page.totalCount).toBeNull();
    });
});

/**
 * The meal read, whose three round trips are the ones every meal write returns through.
 *
 * `createMeal`, `updateMeal`, `publishMeal` and `retireMeal` all answer with `getMeal`, so an
 * envelope this read cannot interpret is a write that never finishes — the write itself having
 * already landed on the server. That is worth a test of its own.
 */
describe('reading a meal back after a write', () => {
    const CHANNELS_OK: Scripted = {
        status: 200,
        body: {
            data: [
                {
                    id: 'channel-1',
                    organisation_id: 'org-1',
                    code: 'web-shop',
                    channel_kind: 'b2c_web',
                    name_en: 'Web shop',
                    name_ar: 'المتجر',
                    order_source: 'web',
                    status: 'active',
                    lock_version: 0,
                },
            ],
            meta: { correlation_id: 'c-channels' },
        },
    };

    function mealRow(id: string) {
        return {
            id,
            organisation_id: 'org-1',
            catalogue_id: 'catalogue-1',
            item_type: 'meal',
            slug: 'charred-aubergine-bowl',
            name_en: 'Charred aubergine bowl',
            name_ar: 'وعاء الباذنجان المشوي',
            description_en: 'Smoked, with tahini.',
            description_ar: 'مدخّن، مع طحينة.',
            recipe_id: null,
            status: 'draft',
            data_quality_flags: [],
            lock_version: 0,
        };
    }

    const MEAL_ID = '019ffcaa-6e68-70cb-8ed0-977e577d0ad6';

    const SHOW_OK: Scripted = {
        status: 200,
        body: {
            data: {
                item: mealRow(MEAL_ID),
                variants: [],
                ingredients: [],
                diet_classifications: ['vegan'],
                channels: [
                    {
                        sales_channel_id: 'channel-1',
                        is_available: true,
                        available_from: null,
                        available_to: null,
                    },
                ],
                availability_days: [],
            },
            meta: { correlation_id: 'c-show' },
        },
    };

    /**
     * The allergen endpoint answers `data.allergens`, not a bare list: it states the *basis* of the
     * derivation in `meta`, so the rows need a key of their own. Reading `data` as the array threw
     * `allergens.map is not a function` inside every meal read, and because a thrown `TypeError` is
     * not an `ApiFailure`, the editor rendered no error at all — a create the server had answered
     * `201` to looked, on screen, like a button nobody had pressed.
     */
    const ALLERGENS_OK: Scripted = {
        status: 200,
        body: {
            data: {
                allergens: [{ allergen_code: 'sesame', containment: 'contains', basis: 'derived' }],
            },
            meta: { correlation_id: 'c-allergens', basis: 'ingredients', recipe_version_id: null },
        },
    };

    it('creates a meal and maps the record the three reads describe', async () => {
        const { repositories, calls } = harness([
            {
                status: 201,
                body: { data: { item: mealRow(MEAL_ID) }, meta: { correlation_id: 'c-create' } },
            },
            CHANNELS_OK,
            SHOW_OK,
            ALLERGENS_OK,
        ]);

        const created = await repositories.kitchenAdmin.createMeal({
            name: { en: 'Charred aubergine bowl', ar: 'وعاء الباذنجان المشوي' },
            description: { en: 'Smoked, with tahini.', ar: 'مدخّن، مع طحينة.' },
            portionFactor: 1,
            mealTypes: ['lunch'],
            dietClassifications: [],
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('https://api.example/api/v1/catalogue/items');
        expect(calls[0]?.body).toEqual({
            item_type: 'meal',
            name_en: 'Charred aubergine bowl',
            name_ar: 'وعاء الباذنجان المشوي',
            description_en: 'Smoked, with tahini.',
            description_ar: 'مدخّن، مع طحينة.',
        });
        // No diet classifications were asked for, so no second write is invented for them.
        expect(calls[3]?.url).toBe(
            `https://api.example/api/v1/catalogue/items/${MEAL_ID}/allergens`,
        );
        expect(calls).toHaveLength(4);

        expect(String(created.id)).toBe(MEAL_ID);
        expect(created.meta.status).toBe('draft');
        expect(created.allergens.map(String)).toEqual(['sesame']);
        expect(created.dietClassifications).toEqual(['vegan']);
    });

    it('reads the same envelope on a plain fetch of the meal', async () => {
        const { repositories } = harness([CHANNELS_OK, SHOW_OK, ALLERGENS_OK]);

        const meal = await repositories.kitchenAdmin.getMeal(MealId.unsafe(MEAL_ID));

        expect(meal.allergens.map(String)).toEqual(['sesame']);
        expect(meal.channelAvailability).toEqual([
            { channel: 'b2c', isAvailable: true, availableFrom: null, availableUntil: null },
        ]);
    });
});

/**
 * The product editor's two saves, as bodies on the wire.
 *
 * Both were refused by the real API against shapes the deleted mock accepted, and neither refusal
 * was reachable from a screen test: what went wrong is the *translation* between the contract's
 * flattened vocabularies and the identifiers PostgreSQL keys on.
 */
describe('the product editor writes', () => {
    const PRODUCT_ID = '019ffc6a-3e8f-70dc-a2b4-64ff691e9844';
    const KILOGRAM = '019ffc6a-2007-713f-887e-1abe7f663309';
    const GRAM = '019ffc6a-1ff0-727f-92ac-79b511f0e99a';
    const WEB_SHOP = '019ffc6a-33cf-72ba-9b74-f6ce4a703c26';
    const WHOLESALE = '019ffc6a-33d6-7248-9c83-a2ec8140cf55';
    const COUNTER = '019ffc6a-5f4e-7299-9ab0-14ec505fb5b7';

    function productRow(lockVersion: number) {
        return {
            id: PRODUCT_ID,
            organisation_id: 'org-1',
            catalogue_id: 'catalogue-1',
            item_type: 'product',
            slug: 'marinated-chicken-breast',
            name_en: 'Marinated Chicken Breast',
            name_ar: 'Marinated Chicken Breast',
            description_en: null,
            description_ar: null,
            status: 'published',
            data_quality_flags: [],
            lock_version: lockVersion,
        };
    }

    function channelRow(id: string, code: string, kind: string, name: string) {
        return {
            id,
            organisation_id: 'org-1',
            code,
            channel_kind: kind,
            name_en: name,
            name_ar: name,
            order_source: null,
            status: 'active',
            lock_version: 0,
        };
    }

    function itemShow(lockVersion: number, variants: readonly unknown[]): Scripted {
        return {
            status: 200,
            body: {
                data: {
                    item: productRow(lockVersion),
                    variants,
                    ingredients: [],
                    diet_classifications: [],
                    channels: [],
                    availability_days: [],
                },
                meta: { correlation_id: 'c-show' },
            },
        };
    }

    function itemWrite(lockVersion: number): Scripted {
        return {
            status: 200,
            body: {
                data: { item: productRow(lockVersion), variants: [], channels: [] },
                meta: { correlation_id: 'c-write' },
            },
        };
    }

    function channelIndex(...rows: readonly unknown[]): Scripted {
        return { status: 200, body: { data: rows, meta: { correlation_id: 'c-channels' } } };
    }

    /** The seeded kilogram pack, exactly as `GET /catalogue/items/{item}` answers for it. */
    const STORED_PACK = {
        id: '019ffc6a-3e93-70e4-b049-7f0ba33a22f6',
        variant_type: 'pack',
        code: '1-kg',
        name_en: '1 Kg',
        name_ar: '1 Kg',
        is_default: true,
        status: 'active',
        pack: {
            pack_quantity: '1.0000',
            pack_unit_id: KILOGRAM,
            pack_piece_count: null,
            pack_format: null,
            net_weight_grams: null,
        },
        lock_version: 0,
    };

    const UNITS_OK: Scripted = {
        status: 200,
        body: {
            data: {
                currencies: [{ code: 'AED', name_en: 'UAE dirham' }],
                default_currency_code: 'AED',
                measurement_units: [
                    { id: GRAM, code: 'g', dimension: 'mass', name_en: 'Gram' },
                    { id: KILOGRAM, code: 'kg', dimension: 'mass', name_en: 'Kilogram' },
                ],
            },
            meta: { correlation_id: 'c-units' },
        },
    };

    /**
     * A pack quantity with no unit is not a size, and the API says so — the whole save came back
     * `422 variants.0.pack.pack_unit_id`. The unit cannot come from `netUnit` for a pack that
     * already exists either: `MeasureUnit` cannot name `gallon`, `bag`, `can` or `bunch`, all of
     * which the seeded catalogue quotes packs in, so a stored pack's own unit is echoed back and
     * only the pack this submission *adds* has its chosen unit resolved.
     */
    it('sends every pack with a unit, echoing the one a stored pack already carries', async () => {
        const { repositories, calls } = harness([
            itemWrite(1),
            itemShow(1, [STORED_PACK]),
            UNITS_OK,
            itemWrite(2),
            channelIndex(),
            itemShow(2, [STORED_PACK]),
        ]);

        await repositories.kitchenAdmin.updateProduct(ProductId.unsafe(PRODUCT_ID), {
            lockVersion: 0,
            name: { en: 'Marinated Chicken Breast', ar: 'Marinated Chicken Breast' },
            packVariants: [
                // `netUnit` reads back as the fallback `g` — the read cannot name kilograms
                // through `pack_unit_id` alone — so honouring it here would restate a kilogram
                // pack in grams on a save that touched nothing but the name.
                {
                    code: '1-kg',
                    label: { en: '1 Kg', ar: '1 Kg' },
                    netQuantity: 1,
                    netUnit: 'g',
                    unitsPerPack: 1,
                },
                {
                    code: 'CASE24',
                    label: { en: '', ar: '' },
                    netQuantity: 6000,
                    netUnit: 'g',
                    unitsPerPack: 24,
                },
            ],
        });

        expect(calls[2]?.url).toBe('https://api.example/api/v1/catalogue/procurement/reference');

        const write = calls[3];
        expect(write?.method).toBe('PUT');
        expect(write?.url).toBe(
            `https://api.example/api/v1/catalogue/items/${PRODUCT_ID}/variants`,
        );
        expect(write?.body).toEqual({
            variants: [
                {
                    code: '1-kg',
                    name_en: '1 Kg',
                    name_ar: '1 Kg',
                    pack: { pack_quantity: 1, pack_unit_id: KILOGRAM, pack_piece_count: 1 },
                },
                {
                    code: 'CASE24',
                    name_en: '',
                    name_ar: '',
                    pack: { pack_quantity: 6000, pack_unit_id: GRAM, pack_piece_count: 24 },
                },
            ],
        });
    });

    /**
     * One editor save, two lock-versioned writes. The `PATCH` consumes the version the editor
     * opened on and answers with the next one; sending the opened-on version again made the pack
     * write a lost race against the rename that preceded it by milliseconds.
     */
    it('carries the version each write answered with into the next one', async () => {
        const { repositories, calls } = harness([
            itemWrite(1),
            itemShow(1, [STORED_PACK]),
            itemWrite(2),
            channelIndex(),
            itemShow(2, [STORED_PACK]),
        ]);

        await repositories.kitchenAdmin.updateProduct(ProductId.unsafe(PRODUCT_ID), {
            lockVersion: 0,
            name: { en: 'Marinated Chicken Breast', ar: 'Marinated Chicken Breast' },
            packVariants: [
                {
                    code: '1-kg',
                    label: { en: '1 Kg', ar: '1 Kg' },
                    netQuantity: 1,
                    netUnit: 'g',
                    unitsPerPack: 1,
                },
            ],
        });

        expect(calls[0]?.method).toBe('PATCH');
        expect(calls[0]?.headers['If-Match']).toBe('"0"');
        // No unit read at all: every submitted code is one the item already has.
        expect(calls[2]?.method).toBe('PUT');
        expect(calls[2]?.headers['If-Match']).toBe('"1"');
    });

    /**
     * `SalesChannel` is the contract's flattening of a closed platform *kind* and a channel *row*
     * an organisation owns. A kitchen that has never opened a counter has no `pos` row, and the
     * old fallback pointed that decision at whichever row came back first — which, when that row
     * was already in the submitted set, made the API refuse the whole replacement as a pair
     * "stated twice".
     */
    it('leaves out a channel the organisation does not run rather than guessing one', async () => {
        const configured = channelIndex(
            channelRow(WHOLESALE, 'wholesale', 'b2b', 'Wholesale'),
            channelRow(WEB_SHOP, 'web-shop', 'b2c_web', 'Web shop'),
        );

        const { repositories, calls } = harness([
            configured,
            itemWrite(1),
            configured,
            itemShow(1, []),
        ]);

        await repositories.kitchenAdmin.setProductChannelAvailability(
            ProductId.unsafe(PRODUCT_ID),
            {
                lockVersion: 0,
                availability: [
                    {
                        channel: 'b2c',
                        isAvailable: true,
                        availableFrom: null,
                        availableUntil: null,
                    },
                    {
                        channel: 'b2b',
                        isAvailable: true,
                        availableFrom: null,
                        availableUntil: null,
                    },
                    {
                        channel: 'pos',
                        isAvailable: true,
                        availableFrom: null,
                        availableUntil: null,
                    },
                ],
            },
        );

        expect(calls[1]?.body).toEqual({
            channels: [
                {
                    sales_channel_id: WEB_SHOP,
                    is_available: true,
                    available_from: null,
                    available_to: null,
                },
                {
                    sales_channel_id: WHOLESALE,
                    is_available: true,
                    available_from: null,
                    available_to: null,
                },
            ],
        });
    });

    it('sends the counter row once the organisation actually runs one', async () => {
        const configured = channelIndex(
            channelRow(WHOLESALE, 'wholesale', 'b2b', 'Wholesale'),
            channelRow(WEB_SHOP, 'web-shop', 'b2c_web', 'Web shop'),
            channelRow(COUNTER, 'counter', 'pos', 'Counter'),
        );

        const { repositories, calls } = harness([
            configured,
            itemWrite(1),
            configured,
            itemShow(1, []),
        ]);

        await repositories.kitchenAdmin.setProductChannelAvailability(
            ProductId.unsafe(PRODUCT_ID),
            {
                lockVersion: 0,
                availability: [
                    {
                        channel: 'b2c',
                        isAvailable: true,
                        availableFrom: null,
                        availableUntil: null,
                    },
                    {
                        channel: 'pos',
                        isAvailable: true,
                        availableFrom: null,
                        availableUntil: null,
                    },
                ],
            },
        );

        const body = calls[1]?.body as {
            readonly channels: readonly { sales_channel_id: string }[];
        };
        expect(body.channels.map((row) => row.sales_channel_id)).toEqual([WEB_SHOP, COUNTER]);
    });
});
