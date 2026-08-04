import type {
    Branch,
    Device,
    Membership,
    Organisation,
    Profile,
    SessionUser,
} from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import type { MeResponse, PendingConsent } from '../contracts/session.ts';
import * as wire from '../generated/zod.ts';
import type {
    ActiveContext as WireActiveContext,
    Branch as WireBranch,
    Device as WireDevice,
    Membership as WireMembership,
    Organisation as WireOrganisation,
    PendingConsent as WirePendingConsent,
    Profile as WireProfile,
    User as WireUser,
} from '../generated/types.ts';
import { createMockRepositories } from '../mock/repositories.ts';
import { MOCK_PASSWORD } from '../mock/fixtures.ts';
import { MOCK_SCENARIOS, MOCK_SCENARIO_NAMES } from '../mock/scenarios.ts';
import type { MockScenarioName } from '../mock/scenarios.ts';
import { MOCK_TOTP_CODE } from '../mock/store.ts';
import { createBranchDirectory, mapDevice, mapMeResponse } from './mappers.ts';
import type { WireMePayload } from './mappers.ts';

/**
 * Fixture ↔ schema conformance (plan §15, §18: "fixtures conform to generated schemas").
 *
 * Two halves, because there are two kinds of fixture and they fail differently.
 *
 * **Half one — recorded payloads.** Bodies captured verbatim from the seeded Docker stack
 * (`docker compose` + `DatabaseSeeder`, demo tenants Cedar Clinic and Verdant Kitchen). If the
 * backend's serialisation drifts from the OpenAPI document, the document is regenerated, the
 * generated Zod schemas change, and these stop parsing. That is the check the phase actually needs:
 * *what the API really sends* validates against *what the contract says it sends*.
 *
 * **Half two — the mock world.** The mock repositories speak the **domain** contract, not the wire,
 * so validating their output against wire schemas directly would be a category error. Instead every
 * scenario's `me()`, login result and device list is projected back onto the wire shape the
 * `ApiRepository` consumes, validated there, and then mapped forward again — proving that the
 * fixture world is expressible on the wire *and* that the two repository implementations agree on
 * every field the wire carries.
 *
 * The projection supplies the four wire fields the domain model has no source for
 * (`Organisation.default_currency_code` and `capabilities`, `Profile.numbering_system`,
 * `PendingConsent.purpose`); each is marked where it happens. Everything else comes from the mock.
 */

// ── half one: payloads recorded from the running stack ──────────────────────────────────────────

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

// ── half two: the mock world, projected onto the wire ───────────────────────────────────────────

/** ISO 4217 for the two seeded countries. The domain `Organisation` carries no currency. */
const CURRENCY_BY_COUNTRY: Readonly<Record<string, string>> = { LB: 'LBP', AE: 'AED' };

function toWireOrganisation(organisation: Organisation): WireOrganisation {
    return {
        id: organisation.id,
        slug: organisation.slug,
        name: organisation.name,
        type: organisation.type,
        status: organisation.isActive ? 'active' : 'suspended',
        country_code: organisation.countryCode,
        // Not on the domain model — supplied by the projection.
        default_currency_code: CURRENCY_BY_COUNTRY[organisation.countryCode] ?? 'USD',
        default_language_code: organisation.defaultLocale,
        capabilities: [],
    };
}

function toWireBranch(branch: Branch): WireBranch {
    return {
        id: branch.id,
        name: branch.name,
        city: null,
        timezone: branch.timeZone,
        status: branch.isActive ? 'active' : 'closed',
    };
}

function toWireMembership(membership: Membership): WireMembership {
    return {
        id: membership.id,
        // The wire has no `pending`; an unaccepted membership is `invited`.
        status: membership.status === 'active' ? 'active' : 'invited',
        // A membership is branch-scoped to at most one branch on the wire.
        branch_id: membership.branches.length === 1 ? membership.branches[0]!.id : null,
        joined_at: membership.startsAt,
        organisation: toWireOrganisation(membership.organisation),
        roles: membership.roles.map((role) => role.key),
    };
}

function toWireProfile(profile: Profile): WireProfile {
    return {
        given_name: profile.givenName ?? '',
        family_name: profile.familyName ?? '',
        preferred_language_code: profile.preferredLocale,
        country_code: null,
        timezone: profile.timeZone ?? 'UTC',
        // Not on the domain model — supplied by the projection.
        numbering_system: 'latn',
        date_of_birth: null,
    };
}

function toWireUser(user: SessionUser): WireUser {
    return {
        id: user.id,
        email: user.email,
        email_verified: user.emailVerifiedAt !== null,
        two_factor_enabled: user.twoFactorEnabled,
    };
}

function toWireDevice(device: Device): WireDevice {
    return {
        id: device.id,
        device_name: device.name,
        platform: device.platform,
        app_version: null,
        last_seen_at: device.lastUsedAt,
        created_at: null,
        is_current: device.isCurrent,
    };
}

function toWirePendingConsent(consent: PendingConsent): WirePendingConsent {
    const version = Number.parseInt(consent.version.replace(/\D/g, ''), 10);
    return {
        code: consent.code,
        version: Number.isFinite(version) && version >= 1 ? version : 1,
        // Not on the domain model — supplied by the projection.
        purpose: consent.code,
    };
}

/**
 * The mock's **global context** — `organisationId: null`, `membershipId: null`, the permissions a
 * person holds on their global identity (decision D1) — has no wire representation: the OpenAPI
 * `ActiveContext` requires both an organisation and a membership identifier, so the API answers
 * `active_context: null` for an identity with no active membership. That divergence is asserted
 * below rather than smoothed over; it is a reported gap, not a mapping bug.
 */
function isGlobalContext(me: MeResponse): boolean {
    return me.activeContext !== null && me.activeContext.membershipId === null;
}

function toWireActiveContext(me: MeResponse): WireActiveContext {
    const context = me.activeContext;
    if (context === null || context.membershipId === null) return null;

    const membership = me.memberships.find((candidate) => candidate.id === context.membershipId);
    if (membership === undefined)
        throw new Error('The mock returned a context with no membership.');

    const branch = membership.branches.find((candidate) => candidate.id === context.branchId);

    return {
        organisation: toWireOrganisation(membership.organisation),
        branch: branch === undefined ? null : toWireBranch(branch),
        membership_id: context.membershipId!,
        permissions: [...context.permissions],
        entitlements: [...context.entitlements],
    };
}

function toWireMe(me: MeResponse): WireMePayload {
    return {
        user: toWireUser(me.user),
        profile: toWireProfile(me.profile),
        memberships: me.memberships.map(toWireMembership),
        active_context: toWireActiveContext(me),
        pending_consents: me.pendingConsents.map(toWirePendingConsent),
    };
}

const PERMISSIONS_VERSION = '1.0';

/** Signs in, and selects the first selectable workspace so `active_context` is exercised. */
async function loadScenario(name: MockScenarioName) {
    const repositories = createMockRepositories({ scenario: name, latencyMs: 0 });
    const scenario = MOCK_SCENARIOS[name];

    const login = await repositories.auth.login({
        email: scenario.primaryEmail,
        password: MOCK_PASSWORD,
    });

    const session =
        login.status === 'authenticated'
            ? login.session
            : await repositories.auth.challengeTwoFactor({
                  challengeId: login.challengeId,
                  code: MOCK_TOTP_CODE,
              });

    const before = await repositories.session.me();

    // Context selection and device management are `verified`-protected on the real API, and the
    // mock enforces the same rule — an unverified scenario legitimately reaches neither.
    const verified = before.user.emailVerifiedAt !== null;
    const first = before.memberships.find((membership) => membership.status === 'active');
    if (verified && first !== undefined) {
        await repositories.context.setContext({ organisationId: first.organisation.id });
    }

    return {
        session,
        me: await repositories.session.me(),
        // An unverified account may not *list* its devices, but the fixture world still has them,
        // and it is the fixtures that are under test here.
        devices: verified
            ? await repositories.devices.list()
            : (scenario.accounts[0]?.devices ?? []),
    };
}

describe.each(MOCK_SCENARIO_NAMES)('mock scenario "%s" conforms on the wire', (name) => {
    it('projects /me onto a payload the generated schema accepts', async () => {
        const { me } = await loadScenario(name);

        const payload = {
            data: toWireMe(me),
            meta: { correlation_id: crypto.randomUUID(), permissions_version: PERMISSIONS_VERSION },
        };

        expect(() => wire.zShowCurrentUserResponse.parse(payload)).not.toThrow();
    });

    it('projects the login result onto a token payload the generated schema accepts', async () => {
        const { session, me, devices } = await loadScenario(name);
        const current = devices.find((device) => device.isCurrent) ?? devices[0]!;

        const payload = {
            data: {
                token: session.token,
                token_type: 'Bearer',
                user: toWireUser(me.user),
                device: toWireDevice(current),
            },
            meta: { correlation_id: crypto.randomUUID() },
        };

        expect(() => wire.zIssueDeviceTokenResponse.parse(payload)).not.toThrow();
    });

    it('projects the device list onto a payload the generated schema accepts', async () => {
        const { devices } = await loadScenario(name);

        const payload = {
            data: devices.map(toWireDevice),
            meta: { correlation_id: crypto.randomUUID(), count: devices.length },
        };

        expect(() => wire.zListDevicesResponse.parse(payload)).not.toThrow();
    });

    /**
     * The point of the whole exercise: a screen handed the API repository must see what the mock
     * repository would have given it. Compared field by field rather than with one `toEqual`, so a
     * failure names the field — and so the fields the wire genuinely cannot carry
     * (`createdAt`, `avatarUrl`, role labels, `expiresAt`, consent metadata) are visibly excluded
     * rather than silently passing.
     */
    it('round-trips through the mapper into the same domain values', async () => {
        const { me, devices } = await loadScenario(name);
        const mapped = mapMeResponse(toWireMe(me), PERMISSIONS_VERSION, createBranchDirectory());

        expect(mapped.user.id).toBe(me.user.id);
        expect(mapped.user.email).toBe(me.user.email);
        expect(mapped.user.twoFactorEnabled).toBe(me.user.twoFactorEnabled);
        expect(mapped.user.emailVerifiedAt === null).toBe(me.user.emailVerifiedAt === null);

        expect(mapped.profile.displayName).toBe(me.profile.displayName);
        expect(mapped.profile.givenName).toBe(me.profile.givenName);
        expect(mapped.profile.familyName).toBe(me.profile.familyName);
        expect(mapped.profile.preferredLocale).toBe(me.profile.preferredLocale);
        expect(mapped.profile.timeZone).toBe(me.profile.timeZone);

        expect(mapped.memberships.map((membership) => membership.id)).toEqual(
            me.memberships.map((membership) => membership.id),
        );
        expect(mapped.memberships.map((membership) => membership.status)).toEqual(
            me.memberships.map((membership) => membership.status),
        );
        expect(mapped.memberships.map((membership) => membership.organisation)).toEqual(
            me.memberships.map((membership) => membership.organisation),
        );
        expect(
            mapped.memberships.map((membership) => membership.roles.map((role) => role.key)),
        ).toEqual(me.memberships.map((membership) => membership.roles.map((role) => role.key)));

        if (isGlobalContext(me)) {
            // Documented divergence: a global context cannot travel on the wire, so the API
            // repository reports "no context" where the mock reports "global context".
            expect(mapped.activeContext).toBeNull();
        } else {
            expect(mapped.activeContext?.organisationId ?? null).toBe(
                me.activeContext?.organisationId ?? null,
            );
            expect(mapped.activeContext?.branchId ?? null).toBe(me.activeContext?.branchId ?? null);
            expect(mapped.activeContext?.membershipId ?? null).toBe(
                me.activeContext?.membershipId ?? null,
            );
            expect(mapped.activeContext?.permissions ?? []).toEqual(
                me.activeContext?.permissions ?? [],
            );
            expect(mapped.activeContext?.entitlements ?? []).toEqual(
                me.activeContext?.entitlements ?? [],
            );
        }

        expect(mapped.pendingConsents.map((consent) => consent.code)).toEqual(
            me.pendingConsents.map((consent) => consent.code),
        );

        const mappedDevices = devices
            .map(toWireDevice)
            .map((device) => mapDevice(device, me.user.id));
        expect(
            mappedDevices.map((device) => [
                device.id,
                device.name,
                device.platform,
                device.isCurrent,
            ]),
        ).toEqual(
            devices.map((device) => [device.id, device.name, device.platform, device.isCurrent]),
        );
    });
});
