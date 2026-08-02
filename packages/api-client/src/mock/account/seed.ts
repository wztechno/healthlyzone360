import type { ConsentDefinition, CustomerAccount } from '../../contracts/account.ts';
import type { ContactPoint } from '../../contracts/verification.ts';
import { MOCK_CREATED_AT, MOCK_VERIFIED_AT } from '../fixtures.ts';
import { contactPointIdAt, customerAccountIdAt, serviceAreaIdAt } from './ids.ts';

/**
 * The `consumer-account-setup` world: one person partway through D2C setup.
 *
 * Deliberately *incomplete*. A fixture world where everything is already done cannot exercise the
 * screen that exists to finish it: here the sign-in email is confirmed, a mobile number has been
 * added but not verified, there is no address, no dietary profile, and the four required consents
 * are outstanding. Every checklist row therefore has something to say.
 */

/** The person. Same identity as the other consumer scenarios — a different stage of their life. */
export const SEED_ACCOUNT: CustomerAccount = {
    id: customerAccountIdAt(0),
    lifecycle: 'provisional',
    displayName: 'Nour Saleh',
    loginEmail: 'nour.saleh@example.com',
    locale: 'en',
    createdAt: MOCK_CREATED_AT,
    activatedAt: null,
};

/**
 * Masks are written out rather than computed.
 *
 * The client is never allowed to mask a value for itself (journey-forced shape 4), so the fixture
 * world must not either — a helper here would be the very code the contract forbids, and a test
 * that asserted its output would be asserting the client's opinion rather than the server's.
 */
export const SEED_CONTACTS: readonly ContactPoint[] = [
    {
        id: contactPointIdAt(0),
        kind: 'email',
        value: 'nour.saleh@example.com',
        maskedValue: 'n•••••••••@example.com',
        verified: true,
        verifiedAt: MOCK_VERIFIED_AT,
        isPrimary: true,
        isLoginEmail: true,
        createdAt: MOCK_CREATED_AT,
    },
    {
        id: contactPointIdAt(1),
        kind: 'phone',
        value: '+971501234567',
        maskedValue: '+971 50 ••• 4567',
        verified: false,
        verifiedAt: null,
        isPrimary: true,
        isLoginEmail: false,
        createdAt: MOCK_CREATED_AT,
    },
];

/**
 * Service areas — the only thing an address may point at.
 *
 * Free-text areas are how an order gets accepted for somewhere nobody drives to, so the fixture
 * world offers a closed list and nothing else. Twenty-four of them, across the two demo markets.
 */
const AREA_NAMES: readonly string[] = [
    'Al Quoz',
    'Al Barsha',
    'Business Bay',
    'Deira',
    'Downtown Dubai',
    'Dubai Marina',
    'Jumeirah',
    'Jumeirah Lakes Towers',
    'Mirdif',
    'Al Nahda',
    'Discovery Gardens',
    'Silicon Oasis',
    'Achrafieh',
    'Hamra',
    'Verdun',
    'Badaro',
    'Gemmayze',
    'Mar Mikhael',
    'Jounieh',
    'Zalka',
    'Antelias',
    'Dbayeh',
    'Baabda',
    'Hazmieh',
];

export interface SeedServiceArea {
    readonly id: ReturnType<typeof serviceAreaIdAt>;
    readonly name: string;
}

export const SEED_SERVICE_AREAS: readonly SeedServiceArea[] = AREA_NAMES.map((name, index) => ({
    id: serviceAreaIdAt(index),
    name,
}));

/**
 * The seven D2C consent definitions (plan Phase J1).
 *
 * Four are required and three are not, which is the whole point of carrying `required`: a screen
 * that treated marketing consent as a blocker would be coercing agreement, and one that treated the
 * age confirmation as optional would be shipping a compliance defect.
 */
export const SEED_CONSENTS: readonly ConsentDefinition[] = [
    {
        key: 'terms_of_service',
        version: '2026-01',
        title: 'Terms of service',
        text: 'The rules for using Healthy360, including ordering, delivery and cancellation.',
        required: true,
    },
    {
        key: 'privacy_notice',
        version: '2026-01',
        title: 'Privacy notice',
        text: 'What Healthy360 records about you, why, and how long it is kept.',
        required: true,
    },
    {
        key: 'age_confirmation',
        version: '2026-01',
        title: 'Age confirmation',
        text: 'You confirm that you are 18 or older, or that a guardian is setting this up with you.',
        required: true,
    },
    {
        key: 'health_data_processing',
        version: '2026-01',
        title: 'Dietary and allergy information',
        text: 'Permission to record your allergies and dietary needs so meals can be filtered for you.',
        required: true,
    },
    {
        key: 'marketing_email',
        version: '2026-01',
        title: 'Email offers',
        text: 'Occasional emails about new menus and offers. You can stop these at any time.',
        required: false,
    },
    {
        key: 'marketing_sms',
        version: '2026-01',
        title: 'SMS offers',
        text: 'Occasional text messages about new menus and offers. You can stop these at any time.',
        required: false,
    },
    {
        key: 'personalisation',
        version: '2026-01',
        title: 'Personalised suggestions',
        text: 'Permission to use what you order to suggest meals you may like.',
        required: false,
    },
];
