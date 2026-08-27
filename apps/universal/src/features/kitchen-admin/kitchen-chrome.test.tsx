import { screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { useKitchenNavigation } from './kitchen-chrome.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/stock',
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/** Renders the hook's items as text so the list can be asserted without a shell. */
function Probe() {
    const navigation = useKitchenNavigation();
    return (
        <>
            {navigation.map((item, index) => (
                <RNText key={item.key} testID={`probe-${item.key}`}>
                    {`${String(index)}|${item.group ?? '(ungrouped)'}|${item.label}|${
                        item.active === true ? 'active' : ''
                    }`}
                </RNText>
            ))}
        </>
    );
}

describe('useKitchenNavigation', () => {
    it('leads with Overview, groups the families, and keeps the workspace trio reachable', async () => {
        await renderStubScreen(<Probe />, { session: kitchenManagerSession() });

        // Overview first and unheaded — AppShell renders ungrouped items before any group.
        expect(screen.getByTestId('probe-overview')).toHaveTextContent(/^0\|\(ungrouped\)\|/);

        // A family destination sits under its registry group and lights up for the pathname.
        expect(screen.getByTestId('probe-stock')).toHaveTextContent(/\|Operations\|/);
        expect(screen.getByTestId('probe-stock')).toHaveTextContent(/\|active$/);

        // The trio the sidebar carried before the rail existed, under its own heading, with the
        // same keys (their nav-* test ids derive from these).
        expect(screen.getByTestId('probe-workspace')).toHaveTextContent(/\|Workspace\|/);
        expect(screen.getByTestId('probe-profile')).toHaveTextContent(/\|Workspace\|/);
    });

    it('offers no destination the session is not permitted to open', async () => {
        // The default anonymous-ish stub session: no kitchen permissions, no families.
        await renderStubScreen(<Probe />, {});

        expect(screen.getByTestId('probe-overview')).toBeTruthy();
        expect(screen.queryByTestId('probe-stock')).toBeNull();
        expect(screen.queryByTestId('probe-review')).toBeNull();
    });
});
