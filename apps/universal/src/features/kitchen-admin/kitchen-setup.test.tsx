import type { KitchenSetup } from '@healthy360/api-client/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { KitchenSetupScreen } from './screens/kitchen-setup-screen.tsx';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
    __esModule: true,
    useSegments: () => [],
    useGlobalSearchParams: () => ({}),
    useNavigation: () => ({}),
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/setup',
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

const setup = (done: readonly boolean[], isLive = false): KitchenSetup => ({
    isLive,
    steps: (['hours', 'delivery', 'menu', 'prices', 'team'] as const).map((key, index) => ({
        key,
        required: key !== 'team',
        done: done[index] === true,
    })),
});

async function renderSetup(
    state: KitchenSetup,
    session = kitchenManagerSession({
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    }),
    goLive = jest.fn(async () => state),
) {
    await renderStubScreen(<KitchenSetupScreen />, {
        session,
        repositories: { kitchenOps: { getKitchenSetup: async () => state, goLive } },
    });
    await waitFor(() => {
        expect(screen.getByTestId('kitchen-setup-state')).toBeTruthy();
    });
    return goLive;
}

describe('the Setup page', () => {
    beforeEach(() => {
        mockPush.mockClear();
    });

    it('leads with the first unfinished required step, and offers no Go live yet', async () => {
        await renderSetup(setup([true, true, false, false, false]));

        expect(screen.getByTestId('kitchen-setup-state')).toHaveTextContent('Not open yet');
        expect(screen.getByTestId('kitchen-setup-focus-title')).toHaveTextContent('Menu');
        expect(screen.queryByTestId('kitchen-setup-go-live')).toBeNull();

        fireEvent.press(screen.getByTestId('kitchen-setup-focus-open'));

        // With Setup as the way back, so the step's page leads back here.
        expect(mockPush).toHaveBeenCalledWith(
            '/kitchen/recipes?kind=meal&returnTo=%252Fkitchen%252Fsetup',
        );
    });

    it('offers Go live once the required steps are done, whatever Team says', async () => {
        const goLive = await renderSetup(setup([true, true, true, true, false]));

        expect(screen.getByTestId('kitchen-setup-state')).toHaveTextContent('Ready to open');
        expect(screen.queryByTestId('kitchen-setup-focus-open')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-setup-go-live'));
        });

        await waitFor(() => {
            expect(goLive).toHaveBeenCalledTimes(1);
        });
    });

    it('offers no Go live to someone who may not open the kitchen', async () => {
        await renderSetup(setup([true, true, true, true, false]), kitchenManagerSession());

        expect(screen.getByTestId('kitchen-setup-state')).toHaveTextContent('Ready to open');
        expect(screen.queryByTestId('kitchen-setup-go-live')).toBeNull();
    });

    it('says a live kitchen is open and offers no Go live', async () => {
        await renderSetup(setup([true, true, true, true, true], true));

        expect(screen.getByTestId('kitchen-setup-state')).toHaveTextContent('This kitchen is open');
        expect(screen.queryByTestId('kitchen-setup-go-live')).toBeNull();
        expect(screen.queryByTestId('kitchen-setup-focus-open')).toBeNull();
    });

    it('still reaches an optional step from its own card', async () => {
        await renderSetup(setup([true, true, true, true, false]));

        fireEvent.press(screen.getByTestId('kitchen-setup-team-open'));

        expect(mockPush).toHaveBeenCalledWith('/kitchen/team?returnTo=%252Fkitchen%252Fsetup');
    });
});
