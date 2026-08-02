import type { Device, Membership, SessionUser } from '@healthy360/domain-types';

import type { PendingConsent } from '../contracts/session.ts';
import {
    AL_QUOZ_BRANCH,
    CEDAR_CLINIC,
    HAMRA_BRANCH,
    JOUNIEH_BRANCH,
    MOCK_PASSWORD,
    MOCK_PENDING_CONSENT,
    VERDANT_KITCHEN,
    makeMockDevices,
    makeMockMembership,
    makeMockUser,
} from './fixtures.ts';
import { MOCK_MEMBERSHIP_IDS, MOCK_USER_IDS } from './ids.ts';

/**
 * Named fixture worlds (plan §18: mock and API repositories satisfy the same contract, and mock
 * mode is visible in development). One scenario is loaded at a time; it is chosen at build time
 * with `EXPO_PUBLIC_MOCK_SCENARIO` and can be swapped at runtime from the development banner.
 *
 * Each scenario is a *complete* world — accounts, memberships, devices — rather than a patch on a
 * shared world, so a Playwright journey is reproducible from its scenario name alone.
 */
export const MOCK_SCENARIO_NAMES = [
    'multi-org-dietitian',
    'single-org-owner',
    'customer-no-org',
    'unverified-email',
    'two-factor-user',
    'platform-admin',
    'consumer-prototype',
    'consumer-onboarding',
    'consumer-account-setup',
] as const;
export type MockScenarioName = (typeof MOCK_SCENARIO_NAMES)[number];

export const DEFAULT_MOCK_SCENARIO: MockScenarioName = 'multi-org-dietitian';

export function isMockScenarioName(value: unknown): value is MockScenarioName {
    return typeof value === 'string' && (MOCK_SCENARIO_NAMES as readonly string[]).includes(value);
}

export interface MockAccount {
    readonly user: SessionUser;
    readonly password: string;
    readonly memberships: readonly Membership[];
    readonly devices: readonly Device[];
    readonly pendingConsents: readonly PendingConsent[];
}

export interface MockScenario {
    readonly name: MockScenarioName;
    /** One line of English, shown in the development scenario switcher. */
    readonly summary: string;
    /** The account a tester is expected to sign in as. */
    readonly primaryEmail: string;
    readonly accounts: readonly MockAccount[];
}

const dietitian = makeMockUser({
    id: MOCK_USER_IDS.dietitian,
    email: 'layla.haddad@cedarclinic.example',
    displayName: 'Layla Haddad',
    givenName: 'Layla',
    familyName: 'Haddad',
});

const owner = makeMockUser({
    id: MOCK_USER_IDS.owner,
    email: 'omar.khoury@cedarclinic.example',
    displayName: 'Omar Khoury',
    givenName: 'Omar',
    familyName: 'Khoury',
});

const consumer = makeMockUser({
    id: MOCK_USER_IDS.consumer,
    email: 'nour.saleh@example.com',
    displayName: 'Nour Saleh',
    givenName: 'Nour',
    familyName: 'Saleh',
    timeZone: 'Asia/Dubai',
});

const unverified = makeMockUser({
    id: MOCK_USER_IDS.unverified,
    email: 'rami.aziz@example.com',
    displayName: 'Rami Aziz',
    givenName: 'Rami',
    familyName: 'Aziz',
    verified: false,
});

const twoFactorUser = makeMockUser({
    id: MOCK_USER_IDS.twoFactor,
    email: 'sara.mansour@verdantkitchen.example',
    displayName: 'Sara Mansour',
    givenName: 'Sara',
    familyName: 'Mansour',
    locale: 'ar',
    timeZone: 'Asia/Dubai',
    twoFactorEnabled: true,
});

const platformAdmin = makeMockUser({
    id: MOCK_USER_IDS.platformAdmin,
    email: 'admin@healthy360.example',
    displayName: 'Dana Fakhoury',
    givenName: 'Dana',
    familyName: 'Fakhoury',
});

function account(
    user: SessionUser,
    memberships: readonly Membership[],
    pendingConsents: readonly PendingConsent[] = [],
): MockAccount {
    return {
        user,
        password: MOCK_PASSWORD,
        memberships,
        devices: makeMockDevices(user.id),
        pendingConsents,
    };
}

/** The default world: one person, two organisations, and a clinic that spans two branches. */
const multiOrgDietitian: MockScenario = {
    name: 'multi-org-dietitian',
    summary: 'Dietitian in Cedar Clinic (Hamra, Jounieh) and Verdant Kitchen (Al Quoz).',
    primaryEmail: dietitian.email,
    accounts: [
        account(
            dietitian,
            [
                makeMockMembership({
                    id: MOCK_MEMBERSHIP_IDS.dietitianClinic,
                    userId: dietitian.id,
                    organisation: CEDAR_CLINIC,
                    roleKeys: ['clinic_dietitian'],
                    branches: [HAMRA_BRANCH, JOUNIEH_BRANCH],
                }),
                makeMockMembership({
                    id: MOCK_MEMBERSHIP_IDS.dietitianKitchen,
                    userId: dietitian.id,
                    organisation: VERDANT_KITCHEN,
                    roleKeys: ['kitchen_manager'],
                    branches: [AL_QUOZ_BRANCH],
                }),
                // A pending invitation: listed by the picker, but not selectable (plan §10 step 2).
                makeMockMembership({
                    id: MOCK_MEMBERSHIP_IDS.dietitianPendingCorporate,
                    userId: dietitian.id,
                    organisation: VERDANT_KITCHEN,
                    roleKeys: ['clinic_receptionist'],
                    branches: [],
                    status: 'pending',
                }),
            ],
            [MOCK_PENDING_CONSENT],
        ),
    ],
};

/** Exactly one active membership with exactly one branch — both pickers must auto-skip. */
const singleOrgOwner: MockScenario = {
    name: 'single-org-owner',
    summary: 'Owner of Cedar Clinic with a single branch — organisation and branch pickers skip.',
    primaryEmail: owner.email,
    accounts: [
        account(owner, [
            makeMockMembership({
                id: MOCK_MEMBERSHIP_IDS.ownerClinic,
                userId: owner.id,
                organisation: CEDAR_CLINIC,
                roleKeys: ['organisation_owner'],
                branches: [HAMRA_BRANCH],
            }),
        ]),
    ],
};

/** A consumer: a global Healthy360 identity with no organisation at all (decision D1). */
const customerNoOrg: MockScenario = {
    name: 'customer-no-org',
    summary: 'Consumer with a global identity and no organisation membership.',
    primaryEmail: consumer.email,
    accounts: [account(consumer, [])],
};

const unverifiedEmail: MockScenario = {
    name: 'unverified-email',
    summary: 'Registered but unconfirmed email address — every guarded area redirects to verify.',
    primaryEmail: unverified.email,
    accounts: [
        account(unverified, [
            makeMockMembership({
                id: MOCK_MEMBERSHIP_IDS.unverifiedClinic,
                userId: unverified.id,
                organisation: CEDAR_CLINIC,
                roleKeys: ['clinic_receptionist'],
                branches: [HAMRA_BRANCH],
            }),
        ]),
    ],
};

const twoFactor: MockScenario = {
    name: 'two-factor-user',
    summary: 'Two-factor enabled — sign-in stops at the authenticator challenge.',
    primaryEmail: twoFactorUser.email,
    accounts: [
        account(twoFactorUser, [
            makeMockMembership({
                id: MOCK_MEMBERSHIP_IDS.twoFactorClinic,
                userId: twoFactorUser.id,
                organisation: VERDANT_KITCHEN,
                roleKeys: ['kitchen_manager'],
                branches: [AL_QUOZ_BRANCH],
            }),
        ]),
    ],
};

const platformAdministrator: MockScenario = {
    name: 'platform-admin',
    summary: 'Holds platform.access_admin — the only account that may open the admin area.',
    primaryEmail: platformAdmin.email,
    accounts: [
        account(platformAdmin, [
            makeMockMembership({
                id: MOCK_MEMBERSHIP_IDS.platformAdminClinic,
                userId: platformAdmin.id,
                organisation: CEDAR_CLINIC,
                roleKeys: ['platform_administrator'],
                branches: [HAMRA_BRANCH, JOUNIEH_BRANCH],
            }),
        ]),
    ],
};

/**
 * The Prompt 2 prototype world, fully populated.
 *
 * Same account as `customer-no-org` — Nour Saleh, a global identity with no organisation — because
 * the prototype is *about* that person: onboarding is complete, a nutrition target is stored, a week
 * is generated, a subscription is running and a review is with a dietitian. What differs from
 * `customer-no-org` is not the account but the prototype world behind it (`./prototype/store.ts`),
 * which is keyed on the scenario name.
 */
const consumerPrototype: MockScenario = {
    name: 'consumer-prototype',
    summary:
        'Nour Saleh with onboarding complete: targets set, a generated week, an active subscription and a review pending.',
    primaryEmail: consumer.email,
    accounts: [account(consumer, [])],
};

/** The same person on day one: no targets, an empty planner, nothing generated. */
const consumerOnboarding: MockScenario = {
    name: 'consumer-onboarding',
    summary:
        'Nour Saleh before onboarding finishes — no nutrition target, an empty planner and nothing to review.',
    primaryEmail: consumer.email,
    accounts: [account(consumer, [])],
};

/**
 * The J1 world: the same person, partway through setting their account up.
 *
 * The sign-in address is confirmed, a mobile number has been added but not verified, there is no
 * address on file, no dietary profile, and the four required consents are outstanding. What differs
 * from the other consumer scenarios is again not the account but the world behind it — here
 * `./account/store.ts`, whose seed is deliberately unfinished so that every checklist row has
 * something to say and the OTP panel has something real to verify.
 */
const consumerAccountSetup: MockScenario = {
    name: 'consumer-account-setup',
    summary:
        'Nour Saleh partway through D2C setup — email confirmed, phone unverified, no address and consents outstanding.',
    primaryEmail: consumer.email,
    accounts: [account(consumer, [])],
};

export const MOCK_SCENARIOS: Readonly<Record<MockScenarioName, MockScenario>> = {
    'multi-org-dietitian': multiOrgDietitian,
    'single-org-owner': singleOrgOwner,
    'customer-no-org': customerNoOrg,
    'unverified-email': unverifiedEmail,
    'two-factor-user': twoFactor,
    'platform-admin': platformAdministrator,
    'consumer-prototype': consumerPrototype,
    'consumer-onboarding': consumerOnboarding,
    'consumer-account-setup': consumerAccountSetup,
};

export function resolveScenario(name: string | null | undefined): MockScenario {
    return MOCK_SCENARIOS[isMockScenarioName(name) ? name : DEFAULT_MOCK_SCENARIO];
}
