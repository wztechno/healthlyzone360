import type {
    AccountChecklistItem,
    AccountOverview,
    AccountServiceArea,
    AccountSetupChecklist,
    ConsentState,
    ContactPoint,
    CustomerAccount,
    CustomerAddress,
    DietaryProfile,
    OtpChallenge,
    OtpVerificationResult,
} from '@healthy360/api-client/contracts';
import { ApiError, conflictFailure } from '@healthy360/api-client/contracts';
import type { ServiceAreaId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { testMeResponse } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { consentStatus } from './consents.ts';
import { initialAllergyAnswer } from './dietary.ts';
import { toE164, validatePhone } from './phone.ts';
import { AccountScreen } from './screens/account-screen.tsx';
import { AddressEditorScreen } from './screens/address-editor-screen.tsx';
import { AllergiesScreen } from './screens/allergies-screen.tsx';
import { ConsentsScreen } from './screens/consents-screen.tsx';
import { PhoneScreen } from './screens/phone-screen.tsx';

/**
 * The J1 account area, against the stub harness.
 *
 * Every fact these screens draw is now *authored by the test* and handed over as a repository
 * answer, rather than fished out of a seeded fixture world. That is the whole point of the
 * migration: a checklist assertion used to depend on what `consumer-account-setup` happened to
 * contain, so "two steps outstanding" was a fact about a fixture. Here the checklist is written a
 * few lines above the assertion and the count is derived from it — if the two disagree, the test is
 * wrong rather than the world having moved.
 *
 * Where a case previously reached into a mock store to *observe* a write (`listConsents()` after a
 * toggle), the equivalent here is a closure variable the override reads: the screen's own
 * invalidation refetches it, so the assertion is still "the screen shows what the server now says"
 * rather than "the mutation function was called". Both are asserted where both are meaningful.
 *
 * What no longer belongs to this suite: the OTP expiry, the attempt budget, the cooldown and the
 * supersession rule were the mock store's mechanics. They are backend behaviour, and a screen test
 * can only assert what the screen does with the answers — which is what the phone cases below do.
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

/* ══ authored entities ═════════════════════════════════════════════════════════════════════════ */

const NOW = '2026-08-11T09:00:00.000Z';

function customerAccount(overrides: Partial<CustomerAccount> = {}): CustomerAccount {
    return {
        id: 'account-0001',
        lifecycle: 'provisional',
        displayName: 'Test Person',
        loginEmail: 'test.person@example.test',
        locale: 'en',
        createdAt: '2026-07-01T09:00:00.000Z',
        activatedAt: null,
        ...overrides,
    };
}

function step(
    name: AccountChecklistItem['step'],
    complete: boolean,
    required: boolean,
    blockedReason: string | null = null,
): AccountChecklistItem {
    return { step: name, complete, required, blockedReason };
}

function checklist(
    items: readonly AccountChecklistItem[],
    overrides: Partial<AccountSetupChecklist> = {},
): AccountSetupChecklist {
    return { lifecycle: 'provisional', items, canActivate: false, ...overrides };
}

function overview(
    setup: AccountSetupChecklist,
    contacts: readonly ContactPoint[] = [],
): AccountOverview {
    return {
        account: customerAccount({ lifecycle: setup.lifecycle }),
        contacts,
        checklist: setup,
    };
}

interface ConsentOverrides {
    readonly required?: boolean;
    readonly granted?: boolean;
    readonly grantedAt?: string | null;
    readonly withdrawnAt?: string | null;
    readonly title?: string;
    readonly text?: string;
}

function consent(key: string, overrides: ConsentOverrides = {}): ConsentState {
    const granted = overrides.granted ?? false;
    return {
        definition: {
            key,
            version: '2026-01',
            title: overrides.title ?? `Consent ${key}`,
            text: overrides.text ?? `The full authored text of ${key}.`,
            required: overrides.required ?? false,
        },
        granted,
        grantedAt: overrides.grantedAt ?? (granted ? NOW : null),
        withdrawnAt: overrides.withdrawnAt ?? null,
    };
}

/** Flip one consent, the way a server would: agreeing stamps a date, withdrawing stamps the other. */
function applyConsent(
    consents: readonly ConsentState[],
    key: string,
    granted: boolean,
): readonly ConsentState[] {
    return consents.map((entry) =>
        entry.definition.key === key
            ? {
                  ...entry,
                  granted,
                  grantedAt: granted ? NOW : entry.grantedAt,
                  withdrawnAt: granted ? null : NOW,
              }
            : entry,
    );
}

function serviceArea(ordinal: number, name: string): AccountServiceArea {
    return { id: `area-${String(ordinal)}` as ServiceAreaId, name };
}

function phoneContact(overrides: Partial<ContactPoint> = {}): ContactPoint {
    return {
        id: 'contact-phone-1',
        kind: 'phone',
        value: '+971501234567',
        maskedValue: '+971 50 *** 4567',
        verified: false,
        verifiedAt: null,
        isPrimary: true,
        isLoginEmail: false,
        createdAt: '2026-07-01T09:00:00.000Z',
        ...overrides,
    };
}

function otpChallenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
    return {
        id: 'challenge-1',
        purpose: 'contact_verification',
        channel: 'sms',
        maskedDestination: '+971 50 *** 4567',
        codeLength: 6,
        // A live challenge, in real time: the panel closes entry once the expiry has run out, so a
        // fixed past timestamp would silently disable the submit button.
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendCooldownSeconds: 0,
        attemptsRemaining: 3,
        resendsRemaining: 2,
        availableChannels: ['sms'],
        simulatedChannels: [],
        ...overrides,
    };
}

const TEST_CODE = '424242';

function dietaryProfile(overrides: Partial<DietaryProfile> = {}): DietaryProfile {
    return {
        dietCategoryCodes: [],
        allergens: [],
        excludedIngredientIds: [],
        updatedAt: null,
        ...overrides,
    };
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
        // Two required steps outstanding — and the screen's count is asserted against that number
        // rather than against whatever a fixture happened to seed.
        const setup = checklist([
            step('verify_email', true, true),
            // The server says phone verification does not block activation in this environment.
            step('verify_phone', false, false),
            step('add_address', false, true),
            step('dietary_profile', false, false),
            step('consents', false, true),
        ]);

        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(setup),
                    listConsents: async () => [],
                },
            },
        });

        expect(await screen.findByTestId('account-checklist-list')).toBeTruthy();
        expect(screen.getByTestId('account-lifecycle')).toHaveTextContent(/Setup unfinished/);
        expect(screen.getByTestId('account-activation')).toHaveTextContent(
            /required steps are still outstanding/,
        );
        // Derived from the two required-and-incomplete steps authored above.
        expect(screen.getByTestId('account-activation')).toHaveTextContent(
            /2 required steps to go/,
        );

        expect(screen.getByTestId('account-step-verify_email-state')).toHaveTextContent(/Done/);
        expect(screen.getByTestId('account-step-add_address-state')).toHaveTextContent(
            /Not done yet/,
        );
        // The screen reports the server's per-step `required` rather than assuming every step is
        // mandatory — the one field that stops the client owning the activation rules.
        expect(screen.getByTestId('account-step-verify_phone-requirement')).toHaveTextContent(
            /Optional/,
        );
        expect(screen.getByTestId('account-step-add_address-requirement')).toHaveTextContent(
            /Needed to activate/,
        );
    });

    it('reports activation from the evaluator once every required step is done', async () => {
        const setup = checklist(
            [
                step('verify_email', true, true),
                step('verify_phone', false, false),
                step('add_address', true, true),
                step('dietary_profile', true, false),
                step('consents', true, true),
            ],
            { lifecycle: 'active', canActivate: true },
        );

        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(setup),
                    listConsents: async () => [],
                },
            },
        });

        expect(await screen.findByTestId('account-activation')).toHaveTextContent(
            /Everything needed is in place/,
        );
        expect(screen.getByTestId('account-lifecycle')).toHaveTextContent(/Active/);
        expect(screen.getByTestId('account-step-consents-state')).toHaveTextContent(/Done/);
    });

    it('offers the marketing consents as switches and writes them straight through', async () => {
        let consents: readonly ConsentState[] = [
            consent('terms_of_service', { required: true, granted: true }),
            consent('marketing_email', { required: false, granted: false }),
            consent('marketing_sms', { required: false, granted: false }),
        ];

        const { repositories } = await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(checklist([step('consents', true, true)])),
                    listConsents: async () => consents,
                    setConsent: async ({ key, granted }) => {
                        consents = applyConsent(consents, key, granted);
                        const written = consents.find((entry) => entry.definition.key === key);
                        if (written === undefined) throw new Error(`No consent ${key}.`);
                        return written;
                    },
                },
            },
        });

        // Only the optional `marketing_*` consents belong here; the required one stays on the
        // compliance screen.
        expect(await screen.findByTestId('account-marketing-marketing_email')).toBeTruthy();
        expect(screen.queryByTestId('account-marketing-terms_of_service')).toBeNull();

        await fireEvent.press(screen.getByTestId('account-marketing-marketing_email-control'));

        expect(repositories.account.setConsent).toHaveBeenCalledWith({
            key: 'marketing_email',
            granted: true,
        });

        // And the screen shows what the server now says, having refetched on its own invalidation.
        await waitFor(() => {
            expect(
                screen.getByTestId('account-marketing-marketing_email-control').props
                    .accessibilityState.checked,
            ).toBe(true);
        });
    });
});

/* ══ phone and the one-time code ═══════════════════════════════════════════════════════════════ */

describe('PhoneScreen', () => {
    it('sends a code to the number already on file and confirms it', async () => {
        const challenge = otpChallenge();
        const contact = phoneContact();

        const { repositories } = await renderStubScreen(<PhoneScreen />, {
            session: testMeResponse(),
            repositories: {
                verification: {
                    listContactPoints: async () => [contact],
                    issueChallenge: async () => challenge,
                    getChallenge: async () => challenge,
                    verifyChallenge: async ({ challengeId }): Promise<OtpVerificationResult> => ({
                        challengeId,
                        purpose: 'contact_verification',
                        verifiedAt: NOW,
                        contactPointId: contact.id,
                        stepUpUntil: null,
                    }),
                },
            },
        });

        // An unconfirmed number is already on file, so the screen offers it rather than a form.
        await fireEvent.press(await screen.findByTestId('phone-screen-send'));

        const input = await screen.findByTestId('phone-screen-challenge-code-input');
        // Server-authored mask, never reconstructed by the panel.
        expect(screen.getByTestId('phone-screen-challenge-destination')).toHaveTextContent(/4567/);
        expect(repositories.verification.issueChallenge).toHaveBeenCalledWith({
            purpose: 'contact_verification',
            contactPointId: contact.id,
        });

        await fireEvent.changeText(input, TEST_CODE);
        await fireEvent.press(screen.getByTestId('phone-screen-challenge-submit'));

        expect(await screen.findByTestId('phone-screen-verified')).toBeTruthy();
        // The code is verified against the challenge the screen is driving, not against a contact.
        expect(repositories.verification.verifyChallenge).toHaveBeenCalledWith({
            challengeId: challenge.id,
            code: TEST_CODE,
        });
    });

    it('says a number is already on the account rather than showing a stale-write conflict', async () => {
        await renderStubScreen(<PhoneScreen />, {
            session: testMeResponse(),
            repositories: {
                verification: {
                    // A confirmed number, so the form is what renders.
                    listContactPoints: async () => [
                        phoneContact({ verified: true, verifiedAt: NOW }),
                    ],
                    // Adding a number already on the account is refused with `resource.conflict`.
                    addContactPoint: async () => {
                        throw new ApiError(conflictFailure());
                    },
                },
            },
        });

        await fireEvent.changeText(
            await screen.findByTestId('phone-screen-number'),
            '050 123 4567',
        );
        await fireEvent.press(screen.getByTestId('phone-screen-submit'));

        // The generic conflict copy would be wrong here — nobody changed anything.
        expect(await screen.findByTestId('phone-screen-duplicate')).toHaveTextContent(
            /already on your account/,
        );
        expect(screen.queryByTestId('phone-screen-add-error')).toBeNull();
    });
});

/* ══ addresses ═════════════════════════════════════════════════════════════════════════════════ */

describe('AddressEditorScreen', () => {
    it('saves an address against a chosen service area, never free text', async () => {
        const areas = [
            serviceArea(1, 'Jumeirah'),
            serviceArea(2, 'Dubai Marina'),
            serviceArea(3, 'Al Barsha'),
        ];
        const area = areas[2]!;

        const { repositories } = await renderStubScreen(<AddressEditorScreen addressId="new" />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    listServiceAreas: async () => areas,
                    addAddress: async (request): Promise<CustomerAddress> => ({
                        id: 'address-1',
                        label: request.label,
                        areaId: request.areaId,
                        areaName: area.name,
                        isDeliverable: true,
                        line1: request.line1,
                        line2: null,
                        building: null,
                        floor: null,
                        notes: null,
                        // The server decides the first address is the default — the screen sent
                        // `makeDefault: false`, which is asserted below.
                        isDefault: true,
                    }),
                },
            },
        });

        await fireEvent.changeText(await screen.findByTestId('address-editor-label'), 'Home');
        await fireEvent.press(screen.getByTestId('address-editor-area-trigger'));
        await fireEvent.press(await screen.findByTestId(`address-editor-area-option-${area.id}`));

        // Choosing an area produces the non-blocking coverage notice — a warning, not a gate.
        expect(await screen.findByTestId('address-editor-coverage')).toHaveTextContent(
            new RegExp(area.name),
        );

        await fireEvent.changeText(screen.getByTestId('address-editor-line1'), '12 Sunset Street');
        await fireEvent.press(screen.getByTestId('address-editor-save'));

        await waitFor(() => {
            expect(repositories.account.addAddress).toHaveBeenCalledWith({
                label: 'Home',
                // The area travels as the identifier the list published, never as its name.
                areaId: area.id,
                line1: '12 Sunset Street',
                makeDefault: false,
            });
        });
        // A saved address returns to the list rather than sitting on a filled-in form.
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/addresses');
        });
    });
});

/* ══ the allergy declaration ═══════════════════════════════════════════════════════════════════ */

describe('AllergiesScreen', () => {
    it('branches on the Yes/No answer and records “none” as a real answer', async () => {
        let profile = dietaryProfile();

        const { repositories } = await renderStubScreen(<AllergiesScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getDietaryProfile: async () => profile,
                    saveDietaryProfile: async (request) => {
                        profile = { ...request, updatedAt: NOW };
                        return profile;
                    },
                },
            },
        });

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

        await waitFor(() => {
            expect(repositories.account.saveDietaryProfile).toHaveBeenCalledWith({
                dietCategoryCodes: [],
                allergens: [],
                excludedIngredientIds: [],
            });
        });

        // "None" is a real answer, not silence: the saved profile carries a timestamp, so the
        // re-seeded screen reads "no" rather than falling back to the unanswered state.
        expect(await screen.findByTestId('allergies-screen-saved')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('allergies-screen-none')).toBeTruthy();
        });
        expect(screen.queryByTestId('allergies-screen-unanswered')).toBeNull();
    });

    it('declares a ticked allergen at the strictest severity', async () => {
        let profile = dietaryProfile();

        const { repositories } = await renderStubScreen(<AllergiesScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getDietaryProfile: async () => profile,
                    saveDietaryProfile: async (request) => {
                        profile = { ...request, updatedAt: NOW };
                        return profile;
                    },
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('allergies-screen-answer-yes'));
        await fireEvent.press(await screen.findByTestId('allergies-screen-allergens-peanut'));
        await fireEvent.press(screen.getByTestId('allergies-screen-save'));

        await waitFor(() => {
            expect(repositories.account.saveDietaryProfile).toHaveBeenCalledWith({
                dietCategoryCodes: [],
                // A tick declares the strictest reading; softening it is a separate decision.
                allergens: [{ allergenCode: 'peanut', severity: 'allergy', note: null }],
                excludedIngredientIds: [],
            });
        });

        // The saved profile becomes the seed again, so the declaration survives the refetch the
        // save triggers rather than reverting to the unanswered state.
        expect(await screen.findByTestId('allergies-screen-saved')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('allergies-screen-allergens-row-peanut')).toBeTruthy();
        });
    });
});

/* ══ consents ══════════════════════════════════════════════════════════════════════════════════ */

describe('ConsentsScreen', () => {
    it('blocks every required agreement until the age is confirmed, then accepts one', async () => {
        const privacyText = 'What Healthy360 records about you, and for how long.';
        let consents: readonly ConsentState[] = [
            consent('age_confirmation', { required: true, title: 'Your age' }),
            consent('terms_of_service', { required: true, title: 'Terms of service' }),
            consent('privacy_notice', {
                required: true,
                title: 'Privacy notice',
                text: privacyText,
            }),
        ];

        const { repositories } = await renderStubScreen(<ConsentsScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    listConsents: async () => consents,
                    setConsent: async ({ key, granted }) => {
                        consents = applyConsent(consents, key, granted);
                        const written = consents.find((entry) => entry.definition.key === key);
                        if (written === undefined) throw new Error(`No consent ${key}.`);
                        return written;
                    },
                },
            },
        });

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
        expect(repositories.account.setConsent).toHaveBeenCalledWith({
            key: 'age_confirmation',
            granted: true,
        });

        await fireEvent.press(screen.getByTestId('consent-terms_of_service-grant'));
        expect(repositories.account.setConsent).toHaveBeenCalledWith({
            key: 'terms_of_service',
            granted: true,
        });
        await waitFor(() => {
            expect(screen.getByTestId('consent-terms_of_service-status')).toHaveTextContent(
                /Agreed/,
            );
        });

        // The full text is on the page rather than behind a link — it is what was agreed to.
        expect(screen.getByTestId('consent-privacy_notice-text')).toHaveTextContent(
            new RegExp('What Healthy360 records about you'),
        );
    });
});
