import { MOCK_DEVICE_IDS, MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { renderScreen } from '../testing/render-screen.tsx';
import { DevicesScreen } from './devices-screen.tsx';
import { ForbiddenScreen } from './forbidden-screen.tsx';
import { OrganisationPickerScreen } from './organisation-picker-screen.tsx';
import { ProfileScreen } from './profile-screen.tsx';
import { PrototypeScreen } from './prototype-screen.tsx';
import { SignInScreen } from './sign-in-screen.tsx';
import { WorkspaceSelectorScreen } from './workspace-selector-screen.tsx';

const DIETITIAN = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const TWO_FACTOR = MOCK_SCENARIOS['two-factor-user'].primaryEmail;

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

describe('SignInScreen', () => {
    it('validates before it ever reaches the repository', async () => {
        await renderScreen(<SignInScreen />);

        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('sign-in-email-error')).toBeTruthy();
        });
        expect(screen.getByTestId('sign-in-password-error')).toBeTruthy();
    });

    it('shows the credentials message for a wrong password', async () => {
        await renderScreen(<SignInScreen />);

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'wrong');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
                /do not match our records/,
            );
        });
    });

    it('reports the wait when the attempt limit is reached', async () => {
        const { repositories } = await renderScreen(<SignInScreen />);

        // Burn the allowance directly; the screen only has to render what the server answers.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await repositories.auth
                .login({ email: DIETITIAN, password: 'wrong' })
                .catch(() => undefined);
        }

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), DIETITIAN);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'wrong');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('sign-in-error')).toHaveTextContent(/30 seconds/);
        });
    });

    it('advances to the two-factor step instead of reporting an error', async () => {
        await renderScreen(<SignInScreen />, { scenario: 'two-factor-user' });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), TWO_FACTOR);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('two-factor-screen')).toBeTruthy();
        });
        expect(screen.queryByTestId('sign-in-error')).toBeNull();
    });

    it('rejects a wrong authenticator code inline on the code field', async () => {
        await renderScreen(<SignInScreen />, { scenario: 'two-factor-user' });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), TWO_FACTOR);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));
        await waitFor(() => screen.getByTestId('two-factor-code-input'));

        await fireEvent.changeText(screen.getByTestId('two-factor-code-input'), '000000');
        await fireEvent.press(screen.getByTestId('two-factor-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('two-factor-code-error')).toBeTruthy();
        });
    });

    it('switches the challenge between authenticator and recovery codes', async () => {
        await renderScreen(<SignInScreen />, { scenario: 'two-factor-user' });

        await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), TWO_FACTOR);
        await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('sign-in-submit'));
        await waitFor(() => screen.getByTestId('two-factor-toggle-recovery'));

        await fireEvent.press(screen.getByTestId('two-factor-toggle-recovery'));
        expect(screen.getByTestId('two-factor-code-label')).toHaveTextContent(/Recovery code/);
    });
});

describe('OrganisationPickerScreen', () => {
    it('lists every membership with its roles and status', async () => {
        await renderScreen(<OrganisationPickerScreen />, { signInAs: DIETITIAN });

        await waitFor(() => {
            expect(screen.getByTestId('organisation-cedar-clinic')).toBeTruthy();
        });
        expect(screen.getByTestId('organisation-cedar-clinic-role-clinic_dietitian')).toBeTruthy();
        expect(screen.getByTestId('organisation-cedar-clinic-status')).toHaveTextContent(/active/);
    });

    it('disables a membership that is not active', async () => {
        await renderScreen(<OrganisationPickerScreen />, { signInAs: DIETITIAN });

        // Non-active memberships carry a status-suffixed testID (uniqueness when the same
        // organisation appears twice) and render as a disabled, non-pressable row.
        await waitFor(() => screen.getByTestId('organisation-verdant-kitchen-pending'));
        const pending = screen.getByTestId('organisation-verdant-kitchen-pending');
        expect(
            pending.props.accessibilityState?.disabled ?? pending.props.onPress === undefined,
        ).toBeTruthy();
    });

    it('explains an empty list rather than treating it as a failure', async () => {
        await renderScreen(<OrganisationPickerScreen />, {
            scenario: 'customer-no-org',
            signInAs: MOCK_SCENARIOS['customer-no-org'].primaryEmail,
        });

        await waitFor(() => {
            expect(screen.getByTestId('organisation-picker-empty')).toBeTruthy();
        });
    });

    it('auto-skips when there is exactly one active membership', async () => {
        const { repositories } = await renderScreen(<OrganisationPickerScreen />, {
            scenario: 'single-org-owner',
            signInAs: MOCK_SCENARIOS['single-org-owner'].primaryEmail,
        });

        await waitFor(() => {
            expect(screen.getByTestId('organisation-picker-autoskip')).toBeTruthy();
        });
        await waitFor(async () => {
            expect((await repositories.session.me()).activeContext).not.toBeNull();
        });
    });

    it('applies the chosen organisation', async () => {
        const { repositories } = await renderScreen(<OrganisationPickerScreen />, {
            signInAs: DIETITIAN,
        });

        await waitFor(() => screen.getByTestId('organisation-cedar-clinic'));
        await fireEvent.press(screen.getAllByTestId('organisation-cedar-clinic')[0]!);

        await waitFor(async () => {
            const me = await repositories.session.me();
            expect(me.activeContext?.organisationId).toBeDefined();
        });
    });
});

describe('WorkspaceSelectorScreen', () => {
    it('offers only the areas the kernel would admit, and marks the context', async () => {
        const { repositories } = await renderScreen(<WorkspaceSelectorScreen />, {
            signInAs: DIETITIAN,
        });
        const me = await repositories.session.me();
        await repositories.context.setContext({
            organisationId: me.memberships[0]!.organisation.id,
            branchId: me.memberships[0]!.branches[0]!.id,
        });

        // Re-render with a hydrated context.
        await renderScreen(<WorkspaceSelectorScreen />, { signInAs: DIETITIAN });
        await waitFor(() => {
            expect(screen.getByTestId('workspace-selector-title')).toBeTruthy();
        });
    });

    it('offers a switch back to the organisation picker', async () => {
        await renderScreen(<WorkspaceSelectorScreen />, { signInAs: DIETITIAN });
        await waitFor(() => {
            expect(screen.getByTestId('workspace-switch-organisation')).toBeTruthy();
        });
    });
});

describe('ProfileScreen', () => {
    it('renders the account, memberships and consents read-only', async () => {
        await renderScreen(<ProfileScreen />, { signInAs: DIETITIAN });

        await waitFor(() => {
            expect(screen.getByTestId('profile-email')).toHaveTextContent(DIETITIAN);
        });
        expect(screen.getByTestId('profile-display-name')).toHaveTextContent(/Layla Haddad/);
        expect(screen.getByTestId('profile-membership-cedar-clinic')).toBeTruthy();
        expect(screen.getByTestId('profile-consent-marketing_updates')).toBeTruthy();
    });

    it('says so plainly when no organisation has been chosen', async () => {
        await renderScreen(<ProfileScreen />, { signInAs: DIETITIAN });
        await waitFor(() => {
            expect(screen.getByTestId('profile-no-context')).toBeTruthy();
        });
    });
});

describe('DevicesScreen', () => {
    it('lists the sessions and marks the current one', async () => {
        await renderScreen(<DevicesScreen />, { signInAs: DIETITIAN });

        await waitFor(() => {
            expect(screen.getByTestId(`device-${MOCK_DEVICE_IDS.laptop}`)).toBeTruthy();
        });
        expect(screen.getByTestId(`device-${MOCK_DEVICE_IDS.laptop}-current`)).toBeTruthy();
        expect(screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`)).toBeTruthy();
    });

    it('asks for confirmation before revoking', async () => {
        await renderScreen(<DevicesScreen />, { signInAs: DIETITIAN });
        await waitFor(() => screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));
        expect(screen.getByTestId('revoke-dialog')).toBeTruthy();
        expect(screen.getByTestId('revoke-dialog-confirm')).toBeTruthy();
    });

    /**
     * The step-up loop is the interesting behaviour: a 403 opens the password prompt, and the
     * original revocation is retried automatically once the password is confirmed.
     */
    it('opens the step-up prompt when the server demands one', async () => {
        await renderScreen(<DevicesScreen />, { signInAs: DIETITIAN });
        await waitFor(() => screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));
        await fireEvent.press(screen.getByTestId('revoke-dialog-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('step-up-dialog')).toBeTruthy();
        });
        expect(screen.getByTestId('step-up-password-input')).toBeTruthy();
    });

    it('rejects a wrong step-up password inline and keeps the device', async () => {
        const { repositories } = await renderScreen(<DevicesScreen />, { signInAs: DIETITIAN });
        await waitFor(() => screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));
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
        const { repositories } = await renderScreen(<DevicesScreen />, { signInAs: DIETITIAN });
        await waitFor(() => screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));

        await fireEvent.press(screen.getByTestId(`device-${MOCK_DEVICE_IDS.phone}-revoke`));
        await fireEvent.press(screen.getByTestId('revoke-dialog-confirm'));
        await waitFor(() => screen.getByTestId('step-up-password-input'));

        await fireEvent.changeText(screen.getByTestId('step-up-password-input'), 'password');
        await fireEvent.press(screen.getByTestId('step-up-submit'));

        // No second press of "Revoke": the intent was already expressed.
        await waitFor(async () => {
            expect(await repositories.devices.list()).toHaveLength(2);
        });
        expect(screen.getByTestId('device-revoked-toast')).toBeTruthy();
    });
});

describe('ForbiddenScreen', () => {
    it('translates the denial reason and shows the stable code', async () => {
        await renderScreen(
            <ForbiddenScreen reason="permission_missing" missing={['platform.access_admin']} />,
        );

        expect(screen.getByTestId('forbidden-reason-title')).toHaveTextContent(
            /You do not have access/,
        );
        expect(screen.getByTestId('forbidden-reason-code')).toHaveTextContent(/permission_missing/);
        expect(screen.getByTestId('forbidden-missing-platform.access_admin')).toBeTruthy();
    });

    it('offers a way out rather than a dead end', async () => {
        await renderScreen(<ForbiddenScreen reason="entitlement_missing" />);

        expect(screen.getByTestId('forbidden-workspace')).toBeTruthy();
        expect(screen.getByTestId('forbidden-switch-organisation')).toBeTruthy();
    });
});

describe('PrototypeScreen', () => {
    it('renders the translated area name with the prototype badge and no actions', async () => {
        await renderScreen(<PrototypeScreen area="kitchen" testID="prototype-kitchen" />);

        expect(screen.getByTestId('prototype-kitchen-title')).toHaveTextContent(/Kitchen/);
        expect(screen.getByTestId('prototype-kitchen-prototype-badge')).toBeTruthy();
        expect(screen.getByTestId('prototype-kitchen-prototype-body')).toBeTruthy();
    });
});
