import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_OTP_CODE, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { consentStatus } from './consents.ts';
import { initialAllergyAnswer } from './dietary.ts';
import { toE164, validatePhone } from './phone.ts';
import { AccountScreen } from './screens/account-screen.tsx';
import { AddressEditorScreen } from './screens/address-editor-screen.tsx';
import { AllergiesScreen } from './screens/allergies-screen.tsx';
import { ConsentsScreen } from './screens/consents-screen.tsx';
import { PhoneScreen } from './screens/phone-screen.tsx';

/**
 * The J1 account area, against the real mock world.
 *
 * Speed-mode coverage: the five journeys the screens exist for, plus the two pure decisions that a
 * rendered tree would only obscure. Screens are rendered over `createMockRepositories`, which now
 * carries the account and verification repositories as extra fields — so this suite exercises the
 * same resolution path the application uses, including the shim's runtime probe.
 *
 * The OTP path uses `MOCK_OTP_CODE` and nothing else about the code is faked: the expiry, the
 * attempt budget, the cooldown and the supersession rule are the store's real mechanics.
 *
 * The wider matrix — lockout, resend supersession, re-consent, validation, RTL, axe — is itemised
 * as deferred in the wave report.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/account',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    globalThis.localStorage?.clear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

/**
 * A render whose world can be seeded **before** the first frame.
 *
 * The account screens are about a sequence of states, and "what does the checklist look like once
 * everything is done?" is a question about a world that has to exist before the query fires.
 * Invalidating afterwards would test the refetch path instead of the first paint.
 */
async function renderAccount(
    node: ReactNode,
    seed?: (repositories: MockRepositories) => Promise<void>,
): Promise<Harness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'consumer-account-setup',
        latencyMs: 0,
        tokenStore,
    });
    if (seed !== undefined) await seed(repositories);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories };
}

/** Everything the seeded world needs for `canActivate` to be true. */
async function completeSetup(repositories: MockRepositories): Promise<void> {
    const areas = await repositories.account.listServiceAreas();
    await repositories.account.addAddress({
        label: 'Home',
        areaId: areas[0]!.id as never,
        line1: '12 Sunset Street',
    });
    for (const consent of await repositories.account.listConsents()) {
        if (consent.definition.required) {
            await repositories.account.setConsent({ key: consent.definition.key, granted: true });
        }
    }
}

/* ══ pure decisions ════════════════════════════════════════════════════════════════════════════ */

describe('phone composition', () => {
    it('drops the domestic trunk prefix and refuses what cannot be a number', () => {
        expect(toE164('+971', '050 123 4567')).toBe('+971501234567');
        expect(toE164('+961', '3 123 456')).toBe('+9613123456');
        expect(validatePhone('+971', '')).toBe('account:phone.errors.empty');
        expect(validatePhone('+971', '12')).toBe('account:phone.errors.tooShort');
        expect(validatePhone('+971', '0501234567')).toBeNull();
    });
});

describe('the four consent states', () => {
    /** The one that matters: agreed once, not agreed now, never withdrew — the text changed. */
    it('tells re-consent apart from a withdrawal and from never having agreed', () => {
        const definition = {
            key: 'terms_of_service',
            version: '2026-02',
            title: 'Terms',
            text: '…',
            required: true,
        };
        expect(
            consentStatus({
                definition,
                granted: true,
                grantedAt: '2026-01-01',
                withdrawnAt: null,
            }),
        ).toBe('granted');
        expect(
            consentStatus({
                definition,
                granted: false,
                grantedAt: '2026-01-01',
                withdrawnAt: null,
            }),
        ).toBe('reconsent');
        expect(
            consentStatus({
                definition,
                granted: false,
                grantedAt: '2026-01-01',
                withdrawnAt: '2026-02-01',
            }),
        ).toBe('withdrawn');
        expect(
            consentStatus({ definition, granted: false, grantedAt: null, withdrawnAt: null }),
        ).toBe('never');
    });

    /** "No allergies" is an answer; an empty profile that was never saved is silence. */
    it('distinguishes an unanswered allergy question from a declared absence', () => {
        const empty = { dietCategoryCodes: [], allergens: [], excludedIngredientIds: [] };
        expect(initialAllergyAnswer({ ...empty, updatedAt: null })).toBeNull();
        expect(initialAllergyAnswer({ ...empty, updatedAt: '2026-08-02T10:00:00.000Z' })).toBe(
            false,
        );
    });
});

/* ══ the checklist ═════════════════════════════════════════════════════════════════════════════ */

describe('AccountScreen', () => {
    it('draws the server’s outstanding steps without recomputing them', async () => {
        await renderAccount(<AccountScreen />);

        expect(await screen.findByTestId('account-checklist-list')).toBeTruthy();
        expect(screen.getByTestId('account-lifecycle')).toHaveTextContent(/Setup unfinished/);
        expect(screen.getByTestId('account-activation')).toHaveTextContent(
            /required steps are still outstanding/,
        );

        // Complete because the seed world confirmed the sign-in address.
        expect(screen.getByTestId('account-step-verify_email-state')).toHaveTextContent(/Done/);
        expect(screen.getByTestId('account-step-add_address-state')).toHaveTextContent(
            /Not done yet/,
        );
        // The server says phone verification does not block activation in this environment; the
        // screen reports that rather than assuming every step is mandatory.
        expect(screen.getByTestId('account-step-verify_phone-requirement')).toHaveTextContent(
            /Optional/,
        );
        expect(screen.getByTestId('account-step-add_address-requirement')).toHaveTextContent(
            /Needed to activate/,
        );
    });

    it('reports activation from the evaluator once every required step is done', async () => {
        await renderAccount(<AccountScreen />, completeSetup);

        expect(await screen.findByTestId('account-activation')).toHaveTextContent(
            /Everything needed is in place/,
        );
        expect(screen.getByTestId('account-lifecycle')).toHaveTextContent(/Active/);
        expect(screen.getByTestId('account-step-consents-state')).toHaveTextContent(/Done/);
    });

    it('offers the marketing consents as switches and writes them straight through', async () => {
        const { repositories } = await renderAccount(<AccountScreen />);

        const toggle = await screen.findByTestId('account-marketing-marketing_email-control');
        await fireEvent.press(toggle);

        await waitFor(async () => {
            const consents = await repositories.account.listConsents();
            expect(
                consents.find((entry) => entry.definition.key === 'marketing_email')?.granted,
            ).toBe(true);
        });
    });
});

/* ══ phone and the one-time code ═══════════════════════════════════════════════════════════════ */

describe('PhoneScreen', () => {
    it('sends a code to the number already on file and confirms it', async () => {
        const { repositories } = await renderAccount(<PhoneScreen />);

        // The seeded world has an unconfirmed number, so the screen offers it rather than a form.
        await fireEvent.press(await screen.findByTestId('phone-screen-send'));

        const input = await screen.findByTestId('phone-screen-challenge-code-input');
        // Server-authored mask, never reconstructed here.
        expect(screen.getByTestId('phone-screen-challenge-destination')).toHaveTextContent(/4567/);

        await fireEvent.changeText(input, MOCK_OTP_CODE);
        await fireEvent.press(screen.getByTestId('phone-screen-challenge-submit'));

        expect(await screen.findByTestId('phone-screen-verified')).toBeTruthy();
        await waitFor(async () => {
            const contacts = await repositories.verification.listContactPoints();
            expect(contacts.find((contact) => contact.kind === 'phone')?.verified).toBe(true);
        });
    });

    it('says a number is already on the account rather than showing a stale-write conflict', async () => {
        await renderAccount(<PhoneScreen />, async (repositories) => {
            // Remove nothing; simply confirm the seeded number so the form is what renders.
            const contacts = await repositories.verification.listContactPoints();
            const phone = contacts.find((contact) => contact.kind === 'phone');
            if (phone === undefined) throw new Error('The seed world has no phone contact.');
            const challenge = await repositories.verification.issueChallenge({
                purpose: 'contact_verification',
                contactPointId: phone.id,
            });
            await repositories.verification.verifyChallenge({
                challengeId: challenge.id,
                code: MOCK_OTP_CODE,
            });
        });

        await fireEvent.changeText(
            await screen.findByTestId('phone-screen-number'),
            '050 123 4567',
        );
        await fireEvent.press(screen.getByTestId('phone-screen-submit'));

        expect(await screen.findByTestId('phone-screen-duplicate')).toHaveTextContent(
            /already on your account/,
        );
    });
});

/* ══ addresses ═════════════════════════════════════════════════════════════════════════════════ */

describe('AddressEditorScreen', () => {
    it('saves an address against a chosen service area, never free text', async () => {
        const { repositories } = await renderAccount(<AddressEditorScreen addressId="new" />);
        const areas = await repositories.account.listServiceAreas();
        const area = areas[2]!;

        await fireEvent.changeText(await screen.findByTestId('address-editor-label'), 'Home');
        await fireEvent.press(screen.getByTestId('address-editor-area-trigger'));
        await fireEvent.press(await screen.findByTestId(`address-editor-area-option-${area.id}`));

        // Choosing an area produces the non-blocking coverage notice — a warning, not a gate.
        expect(await screen.findByTestId('address-editor-coverage')).toHaveTextContent(
            new RegExp(area.name),
        );

        await fireEvent.changeText(screen.getByTestId('address-editor-line1'), '12 Sunset Street');
        await fireEvent.press(screen.getByTestId('address-editor-save'));

        await waitFor(async () => {
            const saved = await repositories.account.listAddresses();
            expect(saved).toHaveLength(1);
            expect(saved[0]?.areaId).toBe(area.id);
            expect(saved[0]?.areaName).toBe(area.name);
            // First address is the default, decided by the server rather than by the checkbox.
            expect(saved[0]?.isDefault).toBe(true);
        });
    });
});

/* ══ the allergy declaration ═══════════════════════════════════════════════════════════════════ */

describe('AllergiesScreen', () => {
    it('branches on the Yes/No answer and records “none” as a real answer', async () => {
        const { repositories } = await renderAccount(<AllergiesScreen />);

        expect(await screen.findByTestId('allergies-screen-unanswered')).toBeTruthy();
        expect(screen.queryByTestId('allergies-screen-allergens')).toBeNull();
        // Health information is collected here, so the disclaimer is mandatory.
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('allergies-screen-answer-yes'));
        expect(await screen.findByTestId('allergies-screen-allergens')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('allergies-screen-answer-no'));
        expect(await screen.findByTestId('allergies-screen-none')).toBeTruthy();
        expect(screen.queryByTestId('allergies-screen-allergens')).toBeNull();

        await fireEvent.press(screen.getByTestId('allergies-screen-save'));
        await waitFor(async () => {
            const profile = await repositories.account.getDietaryProfile();
            expect(profile.updatedAt).not.toBeNull();
            expect(profile.allergens).toHaveLength(0);
        });
    });

    it('declares a ticked allergen at the strictest severity', async () => {
        const { repositories } = await renderAccount(<AllergiesScreen />);

        await fireEvent.press(await screen.findByTestId('allergies-screen-answer-yes'));
        await fireEvent.press(await screen.findByTestId('allergies-screen-allergens-peanut'));
        await fireEvent.press(screen.getByTestId('allergies-screen-save'));

        await waitFor(async () => {
            const profile = await repositories.account.getDietaryProfile();
            expect(profile.allergens).toEqual([
                { allergenCode: 'peanut', severity: 'allergy', note: null },
            ]);
        });
    });
});

/* ══ consents ══════════════════════════════════════════════════════════════════════════════════ */

describe('ConsentsScreen', () => {
    it('blocks every required agreement until the age is confirmed, then accepts one', async () => {
        const { repositories } = await renderAccount(<ConsentsScreen />);

        expect(await screen.findByTestId('consents-screen-age-blocking')).toBeTruthy();
        const grant = screen.getByTestId('consent-terms_of_service-grant');
        expect(grant.props.accessibilityState.disabled).toBe(true);

        await fireEvent.press(screen.getByTestId('consents-screen-age-checkbox-control'));
        await waitFor(() => {
            expect(
                screen.getByTestId('consent-terms_of_service-grant').props.accessibilityState
                    .disabled,
            ).toBe(false);
        });

        await fireEvent.press(screen.getByTestId('consent-terms_of_service-grant'));
        await waitFor(async () => {
            const consents = await repositories.account.listConsents();
            expect(
                consents.find((entry) => entry.definition.key === 'terms_of_service')?.granted,
            ).toBe(true);
        });

        // The full text is on the page rather than behind a link — it is what was agreed to.
        expect(screen.getByTestId('consent-privacy_notice-text')).toHaveTextContent(
            /What Healthy360 records about you/,
        );
    });
});
