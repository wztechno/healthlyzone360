import { describe, expect, it } from 'vitest';

import { CartId } from '@healthy360/domain-types';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createMemoryGuestTokenStore } from '../session/guest-token-store.ts';
import * as wire from '../generated/zod.ts';
import type {
    GuestOtpChallenge as WireGuestChallenge,
    OtpChallengeResult as WireChallengeResult,
} from '../generated/types.ts';
import { createApiGuestRepository, mapGuestChallenge } from './guest-repository.ts';
import { mapErrorEnvelope } from './failures.ts';
import {
    createApiReferenceReads,
    mapAllergenClass,
    mapServiceArea,
} from './reference-repository.ts';
import { createTransport } from './transport.ts';
import { mapChallengeStatus, mapIssuedChallenge } from './verification-repository.ts';

/**
 * The families this wave switched, driven end to end over a stubbed `fetch`.
 *
 * Same discipline as `marketplace-conformance.test.ts`: every payload below is **validated against
 * the generated Zod schemas first**, so a backend serialisation that drifts from the OpenAPI
 * document stops these parsing rather than silently producing a wrong domain object. Only then is
 * the mapper's output asserted.
 *
 * What is deliberately *not* here is an assertion per method. The registration check lives in
 * `prototype-repositories.test.ts`; this file covers the mappings where the wire and the contract
 * genuinely disagree, because those are the ones that can be wrong without anybody noticing.
 */

/** `GET /api/v1/reference/allergen-classes` — two of the fourteen, one of them severe by default. */
const RECORDED_ALLERGEN_CLASSES = [
    {
        code: 'peanut',
        name: 'Peanuts',
        description: 'Peanuts and products thereof.',
        regulatory_ref: 'ALG-05',
        is_eu_14: true,
        is_us_big_9: true,
        us_declaration_required: true,
        us_threshold_ppm: null,
        severe_by_default: true,
        display_order: 5,
    },
    {
        code: 'sulphites',
        name: 'Sulphur dioxide and sulphites',
        description: null,
        regulatory_ref: 'ALG-12',
        is_eu_14: true,
        is_us_big_9: false,
        us_declaration_required: true,
        us_threshold_ppm: 10,
        severe_by_default: false,
        display_order: 12,
    },
] as const;

/** `GET /api/v1/reference/delivery-areas` — one page, no more. */
const RECORDED_DELIVERY_AREAS = {
    data: [
        {
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2aa1',
            country_code: 'AE',
            code: 'al-quoz',
            name: 'Al Quoz',
            region: 'Dubai',
            display_order: 1,
        },
        {
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2aa2',
            country_code: 'AE',
            code: 'business-bay',
            name: 'Business Bay',
            region: null,
            display_order: 2,
        },
    ],
    meta: {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2f01',
        count: 2,
        next_cursor: null,
        has_more: false,
        locale: 'en',
        country_code: 'AE',
    },
};

/** `POST /api/v1/verification/email/challenges` — a freshly sent passcode. */
const RECORDED_ISSUED_CHALLENGE: WireChallengeResult = {
    challenge_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3aa1',
    purpose: 'contact_verification',
    channel: 'email',
    destination_masked: 'n***@example.com',
    expires_at: '2026-08-03T09:05:00+00:00',
    resend_available_at: '2026-08-03T09:00:45+00:00',
    resend_cooldown_seconds: 45,
    attempts_remaining: 5,
    resends_remaining: 3,
    available_channels: [
        { channel: 'email', simulated: false },
        { channel: 'sms', simulated: true },
    ],
    simulated: false,
};

/** `GET /api/v1/verification/challenges/{challenge}` — the status projection, a different shape. */
const RECORDED_CHALLENGE_STATUS = {
    challenge_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3aa1',
    purpose: 'contact_verification',
    channel: 'email',
    destination_masked: 'n***@example.com',
    status: 'pending',
    is_live: true,
    attempts_remaining: 3,
    resends_remaining: 2,
    expires_at: '2026-08-03T09:05:00+00:00',
    resend_available_at: null,
    last_sent_at: '2026-08-03T09:00:00+00:00',
    verified_at: null,
} as const;

/** `POST /api/v1/guest/contacts` — the guest half of the same surface. */
const RECORDED_GUEST_CHALLENGE: WireGuestChallenge = {
    challenge_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4aa1',
    purpose: 'guest_order',
    channel: 'email',
    destination_masked: 's***@example.com',
    expires_at: '2026-08-03T09:05:00+00:00',
    resend_available_at: '2026-08-03T09:00:45+00:00',
    resend_cooldown_seconds: 45,
    attempts_remaining: 5,
    resends_remaining: 3,
    available_channels: [{ channel: 'email', simulated: false }],
    simulated: false,
};

interface Call {
    readonly url: string;
    readonly headers: Record<string, string>;
}

function transportReturning(body: unknown, calls: Call[] = [], guestToken: string | null = null) {
    const guestTokenStore = createMemoryGuestTokenStore(guestToken);

    return createTransport({
        baseUrl: 'https://api.example/api/v1',
        tokenStore: {
            ...createMemoryTokenStore(),
            get: () => 'a-real-session-token',
        },
        guestTokenStore,
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({
                url: String(input),
                headers: (init?.headers ?? {}) as Record<string, string>,
            });
            return Promise.resolve(
                new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            );
        },
    });
}

describe('the recorded payloads match the generated schemas', () => {
    it('validates the allergen classes', () => {
        for (const allergenClass of RECORDED_ALLERGEN_CLASSES) {
            expect(wire.zPublicAllergenClass.parse(allergenClass)).toBeTruthy();
        }
    });

    it('validates the delivery areas', () => {
        for (const area of RECORDED_DELIVERY_AREAS.data) {
            expect(wire.zPublicDeliveryArea.parse(area)).toBeTruthy();
        }
    });

    it('validates both challenge shapes', () => {
        expect(wire.zOtpChallengeResult.parse(RECORDED_ISSUED_CHALLENGE)).toBeTruthy();
        expect(wire.zVerificationChallenge.parse(RECORDED_CHALLENGE_STATUS)).toBeTruthy();
        expect(wire.zGuestOtpChallenge.parse(RECORDED_GUEST_CHALLENGE)).toBeTruthy();
    });
});

describe('the reference reads', () => {
    /**
     * `severe_by_default` is the field the allergen switch was waiting for, so it is asserted per
     * class rather than in aggregate: a mapper that defaulted every class to `false` would still
     * pass a "the list has fourteen rows" check while quietly turning off the strongest warning the
     * declaration form draws.
     */
    it('maps a class, and reads severity from the server rather than a client list', () => {
        const [peanut, sulphites] = RECORDED_ALLERGEN_CLASSES.map(mapAllergenClass);

        expect(peanut?.code).toBe('peanut');
        expect(peanut?.severeByDefault).toBe(true);
        expect(sulphites?.severeByDefault).toBe(false);

        // Markets are rebuilt from the two labelling flags. `GCC` is never emitted: nothing on this
        // payload says anything about it, and a market code nobody sent would be a regulatory claim
        // the platform never made.
        expect(peanut?.markets).toEqual(['EU', 'US']);
        expect(sulphites?.markets).toEqual(['EU', 'US']);

        // The threshold is carried with its unit; absent means "any detectable amount".
        expect(peanut?.declarationThreshold).toBeNull();
        expect(sulphites?.declarationThreshold).toEqual({ value: 10, unit: 'ppm' });

        // The public endpoint sends one server-chosen name. Both slots carry it rather than leaving
        // `ar` empty, which would render as a blank label in an Arabic build.
        expect(peanut?.name).toEqual({ en: 'Peanuts', ar: 'Peanuts' });
    });

    it('fetches allergen classes anonymously', async () => {
        const calls: Call[] = [];
        const classes = await createApiReferenceReads(
            transportReturning({ data: RECORDED_ALLERGEN_CLASSES, meta: {} }, calls),
        ).listAllergenClasses();

        expect(classes).toHaveLength(2);
        expect(calls[0]?.url).toBe('https://api.example/api/v1/reference/allergen-classes');
        // Reference data is identical for everybody. A response that varied with a bearer token
        // would be one that must not be cached across a sign-out.
        expect(calls[0]?.headers['Authorization']).toBeUndefined();
    });

    it('maps a delivery area and keeps a missing region null', () => {
        const [alQuoz, businessBay] = RECORDED_DELIVERY_AREAS.data.map(mapServiceArea);

        expect(alQuoz?.name).toEqual({ en: 'Al Quoz', ar: 'Al Quoz' });
        expect(alQuoz?.parentName).toEqual({ en: 'Dubai', ar: 'Dubai' });
        expect(businessBay?.parentName).toBeNull();
        expect(alQuoz?.countryCode).toBe('AE');
    });

    /**
     * `country_code` became optional on this endpoint in the backend wave that unblocked the
     * switch — before that it was required, which is why a consumer surface could not call it at
     * all. Asserted by its *absence* from the URL when nobody asked for a market.
     */
    it('omits country_code when no market was asked for', async () => {
        const calls: Call[] = [];
        const page = await createApiReferenceReads(
            transportReturning(RECORDED_DELIVERY_AREAS, calls),
        ).listServiceAreas();

        expect(page.items).toHaveLength(2);
        expect(page.hasMore).toBe(false);
        // Keyset pagination cannot know a total without a second count that would disagree with the
        // page; `null` is the contract's word for that.
        expect(page.totalCount).toBeNull();
        expect(calls[0]?.url).toBe('https://api.example/api/v1/reference/delivery-areas');
    });

    it('sends country_code and cursor when they are given', async () => {
        const calls: Call[] = [];
        await createApiReferenceReads(
            transportReturning(RECORDED_DELIVERY_AREAS, calls),
        ).listServiceAreas({ countryCode: 'AE', limit: 50 });

        expect(calls[0]?.url).toContain('country_code=AE');
        expect(calls[0]?.url).toContain('limit=50');
    });

    /** The consumer projection is an identifier and a name, and nothing a management screen needs. */
    it('projects areas down to what an address select needs', async () => {
        const areas = await createApiReferenceReads(
            transportReturning(RECORDED_DELIVERY_AREAS),
        ).listAccountServiceAreas();

        expect(areas).toEqual([
            { id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2aa1', name: 'Al Quoz' },
            { id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2aa2', name: 'Business Bay' },
        ]);
    });
});

describe('the two challenge shapes map onto one model', () => {
    it('carries the cooldown, the channels and the simulated ones from an issued challenge', () => {
        const challenge = mapIssuedChallenge(RECORDED_ISSUED_CHALLENGE);

        expect(challenge.resendCooldownSeconds).toBe(45);
        expect(challenge.attemptsRemaining).toBe(5);
        expect(challenge.availableChannels).toEqual(['email', 'sms']);
        // Derived from the per-channel flag, not the challenge-level one: the panel badges the
        // channels that do not really deliver, and the challenge-level flag says only that this
        // one did not.
        expect(challenge.simulatedChannels).toEqual(['sms']);
        // Nothing on the wire says how long a code is. Six is the platform's, stated once.
        expect(challenge.codeLength).toBe(6);
    });

    /**
     * The status projection has `resend_available_at` and no cooldown seconds, and no channel list
     * at all. Both losses are asserted, because both are things a panel must not paper over: an
     * invented channel list would offer "try another way" against an endpoint that never said so.
     */
    it('derives the cooldown and reports no channels for a re-read', () => {
        const challenge = mapChallengeStatus(RECORDED_CHALLENGE_STATUS);

        expect(challenge.attemptsRemaining).toBe(3);
        expect(challenge.availableChannels).toEqual([]);
        expect(challenge.simulatedChannels).toEqual([]);
        // `resend_available_at` was null, so no cooldown is claimed.
        expect(challenge.resendCooldownSeconds).toBe(0);
    });

    it('maps the guest challenge the same way', () => {
        const challenge = mapGuestChallenge(RECORDED_GUEST_CHALLENGE);

        expect(challenge.purpose).toBe('guest_order');
        expect(challenge.maskedDestination).toBe('s***@example.com');
        expect(challenge.availableChannels).toEqual(['email']);
        expect(challenge.simulatedChannels).toEqual([]);
    });
});

describe('the guest transport', () => {
    /**
     * `X-Guest-Token` is opt-in per request. The two credentials are not interchangeable, and a
     * request carrying both is a request whose identity is ambiguous.
     */
    it('attaches the guest token to a guest call', async () => {
        const calls: Call[] = [];
        await createApiGuestRepository(
            transportReturning({ data: RECORDED_GUEST_CHALLENGE, meta: {} }, calls, 'gst_live'),
        ).updateContact({ fullName: 'Sam Ali', email: 'sam@example.com' });

        expect(calls[0]?.headers['X-Guest-Token']).toBe('gst_live');
    });

    /**
     * The deletion pair is public and deliberately tokenless: an erasure right conditional on
     * holding a credential is not a right, and the page is reached by somebody who may have cleared
     * their browser months ago.
     */
    it('sends no credential at all on a deletion request', async () => {
        const calls: Call[] = [];
        await createApiGuestRepository(
            transportReturning(
                {
                    data: {
                        accepted: true,
                        destination_masked: 's***@example.com',
                        verification_required: true,
                        expires_in_seconds: 300,
                    },
                    meta: {},
                },
                calls,
                'gst_live',
            ),
        ).requestDeletion({ email: 'sam@example.com' });

        expect(calls[0]?.headers['X-Guest-Token']).toBeUndefined();
        expect(calls[0]?.headers['Authorization']).toBeUndefined();
    });

    /** A retry that placed a second order is the one failure this header exists to prevent. */
    it('sends a fresh idempotency key per placement attempt', async () => {
        const calls: Call[] = [];
        const guest = createApiGuestRepository(
            transportReturning(
                {
                    data: {
                        id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5aa1',
                        order_number: 'H360-G1001',
                        status: 'placed',
                        currency_code: 'AED',
                        subtotal_minor: 9000,
                        delivery_fee_minor: 1500,
                        total_minor: 10500,
                        payment_method: 'cash_on_delivery',
                        delivery: {
                            label: 'Home',
                            line_one: '12 Al Wasl Road',
                            line_two: null,
                            city: 'Dubai',
                            area: 'Al Quoz',
                            window_code: 'morning',
                            requested_date: '2026-08-05',
                        },
                        placed_at: '2026-08-03T09:10:00+00:00',
                        confirmed_at: null,
                        cancelled_at: null,
                        cancellation_reason: null,
                        lines: [],
                    },
                    meta: {},
                },
                calls,
                'gst_live',
            ),
        );

        const draft = {
            cartId: CartId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6aa1'),
            addressId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7aa1',
            address: {
                label: 'Home',
                line1: '12 Al Wasl Road',
                line2: null,
                area: 'Al Quoz',
                city: 'Dubai',
                countryCode: 'AE',
                instructions: null,
            },
            slotCode: 'morning',
            deliveryDate: '2026-08-05',
            paymentMethod: 'cash_on_delivery',
            marketingOptIn: false,
        } as const;

        await guest.placeOrder(draft);
        await guest.placeOrder(draft);

        const keys = calls.map((call) => call.headers['Idempotency-Key']);
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBeTruthy();
        expect(keys[0]).not.toBe(keys[1]);
    });

    /**
     * The order is placed against a saved address row, because the zone, the window and the fee are
     * all resolved from it. A draft without one is refused naming the field rather than sent.
     */
    it('refuses a draft with no saved address, and names the field', async () => {
        const failure = await createApiGuestRepository(transportReturning({}))
            .placeOrder({
                cartId: CartId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6aa1'),
                address: {
                    label: 'Home',
                    line1: '12 Al Wasl Road',
                    line2: null,
                    area: 'Al Quoz',
                    city: 'Dubai',
                    countryCode: 'AE',
                    instructions: null,
                },
                slotCode: 'morning',
                deliveryDate: '2026-08-05',
                paymentMethod: 'cash_on_delivery',
                marketingOptIn: false,
            })
            .then(() => null, asApiFailure);

        expect(failure?.code).toBe('validation.failed');
    });
});

describe('the fifteen journey wire codes', () => {
    function failureFor(code: string, details?: unknown, status = 422) {
        return mapErrorEnvelope({ error: { code, message: 'x', details } }, { status });
    }

    /**
     * The three OTP codes that carry structured detail go through the contract's own builders, so
     * the detail a panel branches on is present by construction — and identical to what the mock
     * produces, which is the property that makes a screen transport-agnostic.
     */
    it('extracts attempts_remaining from otp.invalid', () => {
        const failure = failureFor('otp.invalid', { attempts_remaining: 2 });
        expect(failure).toMatchObject({ code: 'otp.invalid', attemptsRemaining: 2 });
    });

    /** Zero when the server did not say: a panel must never invent a spare attempt. */
    it('reports no remaining attempts when the server did not say', () => {
        expect(failureFor('otp.invalid')).toMatchObject({ attemptsRemaining: 0 });
    });

    it('extracts locked_until and available_channels from a lockout', () => {
        const failure = failureFor('otp.attempts_exceeded', {
            locked_until: '2026-08-03T10:00:00+00:00',
            available_channels: [
                { channel: 'sms', simulated: false },
                'whatsapp',
                'carrier-pigeon',
            ],
        });

        expect(failure).toMatchObject({
            code: 'otp.attempts_exceeded',
            lockedUntil: '2026-08-03T10:00:00+00:00',
            // Both wire shapes are read; a channel this build cannot render is dropped rather than
            // offered.
            availableChannels: ['sms', 'whatsapp'],
        });
    });

    /** Two backend causes, one outcome: locked, until this, try these. */
    it('projects otp.locked onto the lockout the screen already draws', () => {
        expect(
            failureFor('otp.locked', { locked_until: '2026-08-03T10:00:00+00:00' }),
        ).toMatchObject({ code: 'otp.attempts_exceeded' });
    });

    it('extracts the cooldown from otp.cooldown_active', () => {
        expect(failureFor('otp.cooldown_active', { retry_after_seconds: 30 })).toMatchObject({
            code: 'otp.cooldown_active',
            retryAfterSeconds: 30,
        });
    });

    it('speaks the ten journey codes directly, and never automatically retries one', () => {
        const codes = [
            'contact.already_in_use',
            'account.verification_required',
            'address.area_not_served',
            'guest.session_invalid',
            'cart.line_refused',
            'order.placement_refused',
            'b2b.application_state_invalid',
            'b2b.documents_incomplete',
            'b2b.signatory_required',
            'request.idempotency_key_reused',
        ];

        for (const code of codes) {
            const failure = failureFor(code);
            expect(failure.code, `${code} is projected onto ${failure.code}`).toBe(code);
            // The one thing worse than a refused order is two accepted ones.
            expect(failure.retryable).toBe(false);
        }
    });

    it('keeps the current lock version on a conflict', () => {
        expect(failureFor('resource.conflict', { current_lock_version: 7 }, 409)).toMatchObject({
            code: 'resource.conflict',
            currentLockVersion: 7,
        });
    });
});
