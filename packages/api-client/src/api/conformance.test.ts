import { describe, expect, it } from 'vitest';

import * as wire from '../generated/zod.ts';
import { createBranchDirectory, mapMeResponse } from './mappers.ts';
import type { WireMePayload } from './mappers.ts';

/**
 * Payload ↔ schema conformance.
 *
 * Bodies captured verbatim from the seeded Docker stack (`docker compose` + `DatabaseSeeder`, demo
 * tenants Cedar Clinic and Verdant Kitchen). If the backend's serialisation drifts from the OpenAPI
 * document, the document is regenerated, the generated Zod schemas change, and these stop parsing:
 * *what the API really sends* validates against *what the contract says it sends*, and the domain
 * mapping is proven on the same bodies.
 *
 * **Re-capture note.** These bodies age with the seeders. When `DatabaseSeeder` (or a presenter)
 * changes the shape of what `/me`, login or the device list return, re-capture from a freshly
 * seeded stack rather than hand-editing — a hand-edited body is a fixture pretending to be a
 * recording. (This file's second half — the mock world projected onto the wire — was removed with
 * the mock implementation; see ADR-0013.)
 */

// ── payloads recorded from the running stack ────────────────────────────────────────────────────

/** `GET /api/v1/me` — dietitian@cedar.test, before choosing a workspace. */
const RECORDED_ME = {
    data: {
        user: {
            id: '019fb11f-ecb9-7183-8111-b02eb86dde8e',
            email: 'dietitian@cedar.test',
            email_verified: true,
            two_factor_enabled: false,
        },
        profile: {
            given_name: 'Rami',
            family_name: 'Khoury',
            preferred_language_code: 'en',
            country_code: 'LB',
            timezone: 'Asia/Beirut',
            numbering_system: 'latn',
            date_of_birth: null,
        },
        memberships: [
            {
                id: '019fb11f-f077-703a-9216-396d85571ebc',
                status: 'active',
                branch_id: '019fb11f-f00d-73a5-a82c-cfa3cd01fe15',
                joined_at: '2026-07-30T03:44:48+00:00',
                organisation: {
                    id: '019fb11f-effd-7139-9491-094a34f91c0c',
                    slug: 'cedar-clinic',
                    name: 'Cedar Clinic',
                    type: 'clinic',
                    status: 'active',
                    country_code: 'LB',
                    default_currency_code: 'LBP',
                    default_language_code: 'ar',
                    capabilities: ['clinic_services'],
                },
                roles: ['member'],
            },
            {
                id: '019fb11f-f0e0-729d-a643-ff36aa12396f',
                status: 'active',
                branch_id: null,
                joined_at: '2026-07-30T03:44:48+00:00',
                organisation: {
                    id: '019fb11f-f037-73b7-8e37-c8fc56c34af6',
                    slug: 'verdant-kitchen',
                    name: 'Verdant Kitchen',
                    type: 'kitchen',
                    status: 'active',
                    country_code: 'AE',
                    default_currency_code: 'USD',
                    default_language_code: 'ar',
                    capabilities: ['kitchen_production'],
                },
                roles: ['member'],
            },
        ],
        active_context: null,
        pending_consents: [
            {
                code: 'consent.health_data_processing',
                version: 1,
                purpose: 'health_data_processing',
            },
            { code: 'consent.privacy', version: 1, purpose: 'privacy_notice' },
            { code: 'consent.terms', version: 1, purpose: 'platform_terms' },
        ],
    },
    meta: {
        correlation_id: '019fb20e-1895-7054-aa2d-b0662ea270dd',
        permissions_version: '53.0',
    },
};

/** `PUT /api/v1/me/context` — Cedar Clinic; the branch-scoped membership applies Hamra itself. */
const RECORDED_CONTEXT = {
    data: {
        active_context: {
            organisation: {
                id: '019fb11f-effd-7139-9491-094a34f91c0c',
                slug: 'cedar-clinic',
                name: 'Cedar Clinic',
                type: 'clinic',
                status: 'active',
                country_code: 'LB',
                default_currency_code: 'LBP',
                default_language_code: 'ar',
                capabilities: ['clinic_services'],
            },
            branch: {
                id: '019fb11f-f00d-73a5-a82c-cfa3cd01fe15',
                name: 'Hamra',
                city: 'Beirut',
                timezone: 'Asia/Beirut',
                status: 'active',
            },
            membership_id: '019fb11f-f077-703a-9216-396d85571ebc',
            permissions: [
                'organisation.view_current',
                'session.revoke_own',
                'device.manage_own',
                'profile.view_own',
                'profile.update_own',
                'consent.view_own',
                'consent.manage_own',
            ],
            entitlements: [],
        },
    },
    meta: { correlation_id: '019fb20e-b6ca-7241-af9d-b52e011bb0e0' },
};

/** `POST /api/v1/auth/token`. The token is a discarded probe credential. */
const RECORDED_TOKEN = {
    data: {
        token: '019fb20d-dd04-7057-af05-bf961535b968|bEffGthp2W3ugMlS2MO6ToWGTS9KRaLJ7QcSGA4mac69997c',
        token_type: 'Bearer',
        user: {
            id: '019fb11f-ecb9-7183-8111-b02eb86dde8e',
            email: 'dietitian@cedar.test',
            email_verified: true,
            two_factor_enabled: false,
        },
        device: {
            id: '019fb20d-dd18-7134-9166-2ce4083669ab',
            device_name: 'probe-cli',
            platform: 'web',
            app_version: null,
            last_seen_at: '2026-07-30T08:04:40+00:00',
            created_at: '2026-07-30T08:04:40+00:00',
            is_current: true,
        },
    },
    meta: { correlation_id: '019fb20d-da23-733f-b621-24d0b7c21b98' },
};

/** `GET /api/v1/me/devices`. */
const RECORDED_DEVICES = {
    data: [
        {
            id: '019fb20d-dd18-7134-9166-2ce4083669ab',
            device_name: 'probe-cli',
            platform: 'web',
            app_version: null,
            last_seen_at: '2026-07-30T08:04:56+00:00',
            created_at: '2026-07-30T08:04:40+00:00',
            is_current: true,
        },
    ],
    meta: { correlation_id: '019fb20e-bda7-72e3-b569-277e7c93ae5d', count: 1 },
};

/** Error envelopes: cross-organisation refusal, step-up demand, credential rejection. */
const RECORDED_ERRORS = {
    'context.organisation_forbidden': {
        error: {
            code: 'context.organisation_forbidden',
            message: 'You do not have an active membership in the requested organisation.',
            details: {},
            correlation_id: '019fb20f-1708-7103-8d42-a4d73c01ab34',
        },
    },
    'auth.step_up_required': {
        error: {
            code: 'auth.step_up_required',
            message: 'This action requires you to confirm your password again.',
            details: { confirmation_endpoint: '/api/v1/auth/confirm-password' },
            correlation_id: '019fb217-e2ff-7318-b270-35626b0ba263',
        },
    },
};

describe('recorded API payloads conform to the generated schemas', () => {
    it('GET /me', () => {
        expect(() => wire.zShowCurrentUserResponse.parse(RECORDED_ME)).not.toThrow();
    });

    it('PUT /me/context', () => {
        expect(() => wire.zUpdateActiveContextResponse.parse(RECORDED_CONTEXT)).not.toThrow();
    });

    it('POST /auth/token', () => {
        expect(() => wire.zIssueDeviceTokenResponse.parse(RECORDED_TOKEN)).not.toThrow();
    });

    it('GET /me/devices', () => {
        expect(() => wire.zListDevicesResponse.parse(RECORDED_DEVICES)).not.toThrow();
    });

    it.each(Object.entries(RECORDED_ERRORS))('error envelope: %s', (_code, envelope) => {
        expect(() => wire.zErrorEnvelope.parse(envelope)).not.toThrow();
    });

    /**
     * The offset form (`+00:00`) is what Laravel actually serialises. The Zod plugin's default
     * rejects it, which is why `scripts/gen-api.mjs` sets `dates.offset` — this asserts the setting
     * survives a regeneration.
     */
    it('accepts RFC 3339 timestamps with an explicit offset', () => {
        expect(() => wire.zDevice.parse(RECORDED_DEVICES.data[0])).not.toThrow();
    });
});

describe('recorded payloads map onto the domain contract', () => {
    it('maps /me faithfully', () => {
        const me = mapMeResponse(
            RECORDED_ME.data as unknown as WireMePayload,
            RECORDED_ME.meta.permissions_version,
            createBranchDirectory(),
        );

        expect(me.user.email).toBe('dietitian@cedar.test');
        expect(me.user.emailVerifiedAt).not.toBeNull();
        expect(me.profile.displayName).toBe('Rami Khoury');
        expect(me.profile.preferredLocale).toBe('en');
        expect(me.memberships.map((membership) => membership.organisation.slug)).toEqual([
            'cedar-clinic',
            'verdant-kitchen',
        ]);
        expect(me.memberships[0]!.roles.map((role) => role.key)).toEqual(['member']);
        expect(me.activeContext).toBeNull();
        expect(me.pendingConsents.map((consent) => consent.code)).toEqual([
            'consent.health_data_processing',
            'consent.privacy',
            'consent.terms',
        ]);
    });

    /**
     * The branch directory is the only route from `membership.branch_id` to a named branch: `/me`
     * carries the identifier, and the hydrated record only ever arrives inside an active context.
     */
    it('names a membership branch once a context has hydrated it', () => {
        const branches = createBranchDirectory();

        const before = mapMeResponse(
            RECORDED_ME.data as unknown as WireMePayload,
            RECORDED_ME.meta.permissions_version,
            branches,
        );
        expect(before.memberships[0]!.branches).toEqual([]);

        const withContext = {
            ...RECORDED_ME.data,
            active_context: RECORDED_CONTEXT.data.active_context,
        };
        const after = mapMeResponse(
            withContext as unknown as WireMePayload,
            RECORDED_ME.meta.permissions_version,
            branches,
        );

        expect(after.memberships[0]!.branches.map((branch) => branch.name)).toEqual(['Hamra']);
        expect(after.activeContext?.branchId).toBe('019fb11f-f00d-73a5-a82c-cfa3cd01fe15');
        expect(after.activeContext?.permissionVersion).toBe(53);
    });
});
