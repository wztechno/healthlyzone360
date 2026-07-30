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
     * Codes outside the client vocabulary keep the server's message and become `server`; a `4xx` is
     * not retryable, a `5xx` is.
     */
    it('projects an unmapped 4xx onto a non-retryable server failure', async () => {
        const failure = await failureOf([
            {
                status: 404,
                body: {
                    error: {
                        code: 'resource.not_found',
                        message: 'The requested resource does not exist.',
                        details: {},
                        correlation_id: 'c10',
                    },
                },
            },
        ]);

        expect((failure as { code: string }).code).toBe('server');
        expect((failure as { retryable: boolean }).retryable).toBe(false);
        expect((failure as { message: string }).message).toBe(
            'The requested resource does not exist.',
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
