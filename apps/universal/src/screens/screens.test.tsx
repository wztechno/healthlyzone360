import { ApiError, apiFailure, rateLimitFailure, validationFailure } from '@healthy360/api-client';
import type { LoginResult, MeResponse, PendingConsent } from '@healthy360/api-client';
import type {
    ActiveContext,
    Branch,
    BranchId,
    Device,
    DeviceId,
    Membership,
    MembershipId,
    MembershipRole,
    OrganisationId,
    RoleId,
} from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
    TEST_USER_ID,
    testActiveContext,
    testBranch,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../testing/session-fixtures.ts';
import { sequence } from '../testing/stub-repositories.ts';
import { renderStubScreen } from '../testing/stub-screen.tsx';
import { DevicesScreen } from './devices-screen.tsx';
import { ForbiddenScreen } from './forbidden-screen.tsx';
import { OrganisationPickerScreen } from './organisation-picker-screen.tsx';
import { ProfileScreen } from './profile-screen.tsx';
import { SignInScreen } from './sign-in-screen.tsx';
import { WorkspaceSelectorScreen } from './workspace-selector-screen.tsx';

/**
 * The world these suites run in is *authored here*, not signed into.
 *
 * Every screen below is rendered by `renderStubScreen` against a declared session and a declared set
 * of repository answers, so each case states the exact server behaviour it is about — a wrong
 * password, a rate limit, a step-up demand — instead of arranging a fixture world into the state
 * that happens to produce it. Anything a screen reaches for that a case did not declare rejects with
 * `StubNotConfiguredError` naming the surface.
 */

const DIETITIAN_EMAIL = 'layla.haddad@cedarclinic.example';

const role = (key: string, name: string): MembershipRole => ({
    id: `test-0000-role-${key}` as RoleId,
    key,
    name,
});

const CEDAR_CLINIC = testOrganisation({
    id: 'test-0000-org-clinic' as OrganisationId,
    name: 'Cedar Clinic',
    slug: 'cedar-clinic',
    type: 'clinic',
});

const VERDANT_KITCHEN = testOrganisation({
    id: 'test-0000-org-kitchen' as OrganisationId,
    name: 'Verdant Kitchen',
    slug: 'verdant-kitchen',
});

const HAMRA: Branch = testBranch({
    id: 'test-0000-branch-hamra' as BranchId,
    organisationId: CEDAR_CLINIC.id,
    name: 'Hamra',
    code: 'hamra',
});

const JOUNIEH: Branch = testBranch({
    id: 'test-0000-branch-jounieh' as BranchId,
    organisationId: CEDAR_CLINIC.id,
    name: 'Jounieh',
    code: 'jounieh',
});

const AL_QUOZ: Branch = testBranch({
    id: 'test-0000-branch-al-quoz' as BranchId,
    organisationId: VERDANT_KITCHEN.id,
    name: 'Al Quoz',
    code: 'al-quoz',
});

const CLINIC_MEMBERSHIP: Membership = testMembership({
    id: 'test-0000-membership-clinic' as MembershipId,
    organisation: CEDAR_CLINIC,
    roles: [role('clinic_dietitian', 'Clinic dietitian')],
    branches: [HAMRA, JOUNIEH],
});

const KITCHEN_MEMBERSHIP: Membership = testMembership({
    id: 'test-0000-membership-kitchen' as MembershipId,
    organisation: VERDANT_KITCHEN,
    roles: [role('kitchen_manager', 'Kitchen manager')],
    branches: [AL_QUOZ],
});

/** Listed by the picker, never selectable (plan §10 step 2). */
const PENDING_MEMBERSHIP: Membership = testMembership({
    id: 'test-0000-membership-pending' as MembershipId,
    organisation: VERDANT_KITCHEN,
    status: 'pending',
    roles: [role('clinic_receptionist', 'Clinic receptionist')],
    branches: [],
});

const MARKETING_CONSENT: PendingConsent = {
    code: 'marketing_updates',
    version: '2026-01',
    required: false,
    publishedAt: '2026-01-05T00:00:00.000Z',
};

/**
 * A dietitian in two organisations plus a pending invitation, with no context chosen yet — the
 * session the picker, profile and device suites all start from.
 */
function dietitianSession(activeContext: ActiveContext | null = null): MeResponse {
    return testMeResponse({
        user: { email: DIETITIAN_EMAIL },
        profile: { displayName: 'Layla Haddad', givenName: 'Layla', familyName: 'Haddad' },
        memberships: [CLINIC_MEMBERSHIP, KITCHEN_MEMBERSHIP, PENDING_MEMBERSHIP],
        activeContext,
        pendingConsents: [MARKETING_CONSENT],
    });
}

const device = (
    slug: string,
    name: string,
    platform: Device['platform'],
    overrides: Partial<Device> = {},
): Device => ({
    id: `test-0000-device-${slug}` as DeviceId,
    userId: TEST_USER_ID,
    name,
    platform,
    lastUsedAt: '2026-08-10T18:42:00.000Z',
    isCurrent: false,
    ...overrides,
});

const LAPTOP = device('laptop', 'Chrome on Windows', 'web', { isCurrent: true });
const PHONE = device('phone', 'iPhone 16', 'ios');
const TABLET = device('tablet', 'Galaxy Tab S10', 'android');

jest.mock('expo-router', () => {
    const replace = jest.fn();
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ replace, push, back: jest.fn() }),
        usePathname: () => '/workspace',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __replace: replace,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __replace: jest.Mock; __push: jest.Mock };

beforeEach(() => {
    // The router mock is module scoped, so navigation from one case would otherwise still be
    // recorded when the next one asserts on it.
    routerMock.__replace.mockClear();
    routerMock.__push.mockClear();
});

describe('SignInScreen', () => {
    it('validates before it ever reaches the repository', async () => {
        // `auth.login` is deliberately left unstubbed: reaching it at all would reject with
        // StubNotConfiguredError, which is exactly the failure this case is about.
        const { repositories } = await renderStubScreen(<SignInScreen />);

        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('sign-in-email-error')).toBeTruthy();
        });
        expect(screen.getByTestId('sign-in-password-error')).toBeTruthy();
        expect(repositories.auth.login).not.toHaveBeenCalled();
    });

    it('shows the credentials message for a wrong password', async () => {
        await renderStubScreen(<SignInScreen />, {
            repositories: {
                auth: {
                    login: () =>
                        Promise.reject(new ApiError(apiFailure('auth.invalid_credentials'))),
                },
            },
        });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN_EMAIL);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'wrong');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
                /do not match our records/,
            );
        });
    });

    it('reports the wait when the attempt limit is reached', async () => {
        // The allowance is the *server's* bookkeeping, so it is expressed as what the server
        // answers per attempt: the first is a plain refusal, the next one carries the wait. The
        // screen only has to render what it is told, and must not keep showing the first message.
        await renderStubScreen(<SignInScreen />, {
            repositories: {
                auth: {
                    login: sequence<LoginResult>(
                        new ApiError(apiFailure('auth.invalid_credentials')),
                        new ApiError(rateLimitFailure(30)),
                    ),
                },
            },
        });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN_EMAIL);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'wrong');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));
        await waitFor(() => {
            expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
                /do not match our records/,
            );
        });

        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('sign-in-error')).toHaveTextContent(/30 seconds/);
        });
    });

    it('advances to the two-factor step instead of reporting an error', async () => {
        await renderStubScreen(<SignInScreen />, {
            repositories: {
                auth: {
                    login: async (): Promise<LoginResult> => ({
                        status: 'two_factor_required',
                        challengeId: 'test-challenge-0001',
                        recoveryCodesAvailable: true,
                    }),
                },
            },
        });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN_EMAIL);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('two-factor-screen')).toBeTruthy();
        });
        expect(screen.queryByTestId('sign-in-error')).toBeNull();
    });

    it('rejects a wrong authenticator code inline on the code field', async () => {
        const { repositories } = await renderStubScreen(<SignInScreen />, {
            repositories: {
                auth: {
                    login: async (): Promise<LoginResult> => ({
                        status: 'two_factor_required',
                        challengeId: 'test-challenge-0001',
                        recoveryCodesAvailable: true,
                    }),
                    challengeTwoFactor: () =>
                        Promise.reject(
                            new ApiError(validationFailure({ code: ['That code is not right.'] })),
                        ),
                },
            },
        });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN_EMAIL);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));
        await waitFor(() => screen.getByTestId('two-factor-code-input'));

        await fireEvent.changeText(screen.getByTestId('two-factor-code-input'), '000000');
        await fireEvent.press(screen.getByTestId('two-factor-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('two-factor-code-error')).toBeTruthy();
        });
        expect(repositories.auth.challengeTwoFactor).toHaveBeenCalledWith({
            challengeId: 'test-challenge-0001',
            code: '000000',
            recovery: false,
        });
    });

    it('switches the challenge between authenticator and recovery codes', async () => {
        await renderStubScreen(<SignInScreen />, {
            repositories: {
                auth: {
                    login: async (): Promise<LoginResult> => ({
                        status: 'two_factor_required',
                        challengeId: 'test-challenge-0001',
                        recoveryCodesAvailable: true,
                    }),
                },
            },
        });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN_EMAIL);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));
        await waitFor(() => screen.getByTestId('two-factor-toggle-recovery'));

        await fireEvent.press(screen.getByTestId('two-factor-toggle-recovery'));
        expect(screen.getByTestId('two-factor-code-label')).toHaveTextContent(/Recovery code/);
    });
});

describe('OrganisationPickerScreen', () => {
    it('lists every membership with its roles and status', async () => {
        await renderStubScreen(<OrganisationPickerScreen />, { session: dietitianSession() });

        await waitFor(() => {
            expect(screen.getByTestId('organisation-cedar-clinic')).toBeTruthy();
        });
        expect(screen.getByTestId('organisation-cedar-clinic-role-clinic_dietitian')).toBeTruthy();
        expect(screen.getByTestId('organisation-cedar-clinic-status')).toHaveTextContent(/active/);
    });

    it('disables a membership that is not active', async () => {
        await renderStubScreen(<OrganisationPickerScreen />, { session: dietitianSession() });

        // Non-active memberships carry a status-suffixed testID (uniqueness when the same
        // organisation appears twice) and render as a disabled, non-pressable row.
        await waitFor(() => screen.getByTestId('organisation-verdant-kitchen-pending'));
        const pending = screen.getByTestId('organisation-verdant-kitchen-pending');
        expect(
            pending.props.accessibilityState?.disabled ?? pending.props.onPress === undefined,
        ).toBeTruthy();
    });

    it('redirects a consumer with no memberships straight to the customer home', async () => {
        await renderStubScreen(<OrganisationPickerScreen />, {
            // A consumer: a global identity with no organisation at all (decision D1).
            session: testMeResponse(),
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith('/customer');
        });
        expect(screen.queryByTestId('organisation-picker-empty')).toBeNull();
    });

    it('auto-skips when there is exactly one active membership', async () => {
        const applied = testActiveContext({
            organisationId: CEDAR_CLINIC.id,
            branchId: HAMRA.id,
            membershipId: CLINIC_MEMBERSHIP.id,
        });
        const { repositories } = await renderStubScreen(<OrganisationPickerScreen />, {
            session: testMeResponse({ memberships: [CLINIC_MEMBERSHIP], activeContext: null }),
            repositories: { context: { setContext: async () => applied } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('organisation-picker-autoskip')).toBeTruthy();
        });
        // A picker with one option is a dead click, so the context is applied without a press.
        await waitFor(() => {
            expect(repositories.context.setContext).toHaveBeenCalledWith({
                organisationId: CEDAR_CLINIC.id,
            });
        });
    });

    it('applies the chosen organisation', async () => {
        const applied = testActiveContext({
            organisationId: CEDAR_CLINIC.id,
            branchId: null,
            membershipId: CLINIC_MEMBERSHIP.id,
        });
        const { repositories } = await renderStubScreen(<OrganisationPickerScreen />, {
            session: dietitianSession(),
            repositories: { context: { setContext: async () => applied } },
        });

        await waitFor(() => screen.getByTestId('organisation-cedar-clinic'));
        await fireEvent.press(screen.getAllByTestId('organisation-cedar-clinic')[0]!);

        await waitFor(() => {
            expect(repositories.context.setContext).toHaveBeenCalledWith({
                organisationId: CEDAR_CLINIC.id,
            });
        });
        // No branch came back, so the journey continues at the branch picker rather than the
        // workspace — the screen navigates on the server's echo, not on what it asked for.
        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith('/select-branch');
        });
    });
});

describe('WorkspaceSelectorScreen', () => {
    /** A kitchen manager whose organisation and branch the server has already confirmed. */
    function kitchenSession(): MeResponse {
        return testMeResponse({
            memberships: [KITCHEN_MEMBERSHIP],
            activeContext: testActiveContext({
                organisationId: VERDANT_KITCHEN.id,
                branchId: AL_QUOZ.id,
                membershipId: KITCHEN_MEMBERSHIP.id,
            }),
        });
    }

    it('offers only the areas the kernel would admit, and marks the context', async () => {
        await renderStubScreen(<WorkspaceSelectorScreen />, { session: kitchenSession() });

        await waitFor(() => {
            expect(screen.getByTestId('workspace-selector-title')).toBeTruthy();
        });

        // The confirmed context is on the screen, not merely in the cache.
        await waitFor(() => {
            expect(screen.getByTestId('workspace-organisation')).toHaveTextContent(
                /Verdant Kitchen/,
            );
        });
        expect(screen.getByTestId('workspace-branch')).toHaveTextContent(/Al Quoz/);

        // The kitchen gate opens on this context; the platform-admin one does not, because the
        // server's permission set does not carry `organisation.manage_platform`.
        expect(screen.getByTestId('workspace-area-kitchen')).toBeTruthy();
        expect(screen.queryByTestId('workspace-area-platform-admin')).toBeNull();
    });

    it('offers a switch back to the organisation picker', async () => {
        await renderStubScreen(<WorkspaceSelectorScreen />, { session: kitchenSession() });

        await waitFor(() => {
            expect(screen.getByTestId('workspace-switch-organisation')).toBeTruthy();
        });
    });
});

describe('ProfileScreen', () => {
    it('renders the account, memberships and consents read-only', async () => {
        await renderStubScreen(<ProfileScreen />, { session: dietitianSession() });

        await waitFor(() => {
            expect(screen.getByTestId('profile-email')).toHaveTextContent(DIETITIAN_EMAIL);
        });
        expect(screen.getByTestId('profile-display-name')).toHaveTextContent(/Layla Haddad/);
        expect(screen.getByTestId('profile-membership-cedar-clinic')).toBeTruthy();
        expect(screen.getByTestId('profile-consent-marketing_updates')).toBeTruthy();
    });

    it('says so plainly when no organisation has been chosen', async () => {
        await renderStubScreen(<ProfileScreen />, { session: dietitianSession(null) });

        await waitFor(() => {
            expect(screen.getByTestId('profile-no-context')).toBeTruthy();
        });
    });
});

describe('DevicesScreen', () => {
    it('lists the sessions and marks the current one', async () => {
        await renderStubScreen(<DevicesScreen />, {
            session: dietitianSession(),
            repositories: { devices: { list: async () => [LAPTOP, PHONE, TABLET] } },
        });

        await waitFor(() => {
            expect(screen.getByTestId(`device-${LAPTOP.id}`)).toBeTruthy();
        });
        expect(screen.getByTestId(`device-${LAPTOP.id}-current`)).toBeTruthy();
        expect(screen.getByTestId(`device-${PHONE.id}-revoke`)).toBeTruthy();
    });

    it('asks for confirmation before revoking', async () => {
        await renderStubScreen(<DevicesScreen />, {
            session: dietitianSession(),
            repositories: { devices: { list: async () => [LAPTOP, PHONE, TABLET] } },
        });
        await waitFor(() => screen.getByTestId(`device-${PHONE.id}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${PHONE.id}-revoke`));
        expect(screen.getByTestId('revoke-dialog')).toBeTruthy();
        expect(screen.getByTestId('revoke-dialog-confirm')).toBeTruthy();
    });

    /**
     * The step-up loop is the interesting behaviour: a 403 opens the password prompt, and the
     * original revocation is retried automatically once the password is confirmed.
     */
    it('opens the step-up prompt when the server demands one', async () => {
        await renderStubScreen(<DevicesScreen />, {
            session: dietitianSession(),
            repositories: {
                devices: {
                    list: async () => [LAPTOP, PHONE, TABLET],
                    revoke: () => Promise.reject(new ApiError(apiFailure('auth.step_up_required'))),
                },
            },
        });
        await waitFor(() => screen.getByTestId(`device-${PHONE.id}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${PHONE.id}-revoke`));
        await fireEvent.press(screen.getByTestId('revoke-dialog-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('step-up-dialog')).toBeTruthy();
        });
        expect(screen.getByTestId('step-up-password-input')).toBeTruthy();
    });

    it('rejects a wrong step-up password inline and keeps the device', async () => {
        const { repositories } = await renderStubScreen(<DevicesScreen />, {
            session: dietitianSession(),
            repositories: {
                devices: {
                    list: async () => [LAPTOP, PHONE, TABLET],
                    revoke: () => Promise.reject(new ApiError(apiFailure('auth.step_up_required'))),
                },
                auth: {
                    confirmPassword: () =>
                        Promise.reject(
                            new ApiError(
                                validationFailure({
                                    password: ['That password is not right.'],
                                }),
                            ),
                        ),
                },
            },
        });
        await waitFor(() => screen.getByTestId(`device-${PHONE.id}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${PHONE.id}-revoke`));
        await fireEvent.press(screen.getByTestId('revoke-dialog-confirm'));
        await waitFor(() => screen.getByTestId('step-up-password-input'));

        await fireEvent.changeText(screen.getByTestId('step-up-password-input'), 'nope');
        await fireEvent.press(screen.getByTestId('step-up-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('step-up-password-error')).toBeTruthy();
        });
        expect(await repositories.devices.list()).toHaveLength(3);
    });

    it('retries the revocation automatically after the password is confirmed', async () => {
        // The world the screen changes: a closure the stub reads on every list, so the revocation
        // is a real mutation the refetch can observe rather than a call count.
        let remaining: readonly Device[] = [LAPTOP, PHONE, TABLET];

        const { repositories } = await renderStubScreen(<DevicesScreen />, {
            session: dietitianSession(),
            repositories: {
                devices: {
                    list: async () => remaining,
                    // The first attempt is refused for a step-up; the retry after the password is
                    // confirmed actually removes the device.
                    revoke: sequence<void>(
                        new ApiError(apiFailure('auth.step_up_required')),
                        () => {
                            remaining = remaining.filter((entry) => entry.id !== PHONE.id);
                        },
                    ),
                },
                auth: {
                    confirmPassword: async () => ({
                        confirmedUntil: '2026-08-11T10:15:00.000Z',
                    }),
                },
            },
        });
        await waitFor(() => screen.getByTestId(`device-${PHONE.id}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${PHONE.id}-revoke`));
        await fireEvent.press(screen.getByTestId('revoke-dialog-confirm'));
        await waitFor(() => screen.getByTestId('step-up-password-input'));

        await fireEvent.changeText(screen.getByTestId('step-up-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('step-up-submit'));

        // No second press of "Revoke": the intent was already expressed. The world change is
        // the durable fact; the toast auto-dismisses, so it is asserted inside the SAME retry
        // window rather than afterwards (outside, worker contention loses the race - it did).
        await waitFor(async () => {
            expect(await repositories.devices.list()).toHaveLength(2);
            expect(screen.getByTestId('device-revoked-toast')).toBeTruthy();
        });
    });
});

describe('ForbiddenScreen', () => {
    it('translates the denial reason and shows the stable code', async () => {
        await renderStubScreen(
            <ForbiddenScreen
                reason="permission_missing"
                missing={['organisation.manage_platform']}
            />,
        );

        expect(screen.getByTestId('forbidden-reason-title')).toHaveTextContent(
            /You do not have access/,
        );
        expect(screen.getByTestId('forbidden-reason-code')).toHaveTextContent(/permission_missing/);
        expect(screen.getByTestId('forbidden-missing-organisation.manage_platform')).toBeTruthy();
    });

    it('offers a way out rather than a dead end', async () => {
        await renderStubScreen(<ForbiddenScreen reason="entitlement_missing" />);

        expect(screen.getByTestId('forbidden-workspace')).toBeTruthy();
        expect(screen.getByTestId('forbidden-switch-organisation')).toBeTruthy();
    });
});
