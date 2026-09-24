import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text as RNText } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { useKitchenNavigation } from './kitchen-chrome.tsx';
import { KitchenPageSearch } from './kitchen-page-search.tsx';
import {
    KitchenTrailProvider,
    useKitchenTrail,
    useKitchenTrailLeaf,
} from './kitchen-ops-shell.tsx';

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

        // The families appear once the stubbed session has hydrated the access state.
        await waitFor(() => {
            expect(screen.getByTestId('probe-stock')).toBeTruthy();
        });

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

/** The page search over the rail's own items, as the kitchen layout wires it. */
function SearchProbe() {
    const navigation = useKitchenNavigation();
    return <KitchenPageSearch navigation={navigation} />;
}

describe('KitchenPageSearch', () => {
    it('opens from the top-bar box and finds a page among the rail items', async () => {
        await renderStubScreen(<SearchProbe />, { session: kitchenManagerSession() });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-page-search-trigger'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-page-search-item-stock')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-page-search-item-ingredients')).toBeTruthy();

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-page-search-input'), 'stock');
        });
        expect(screen.getByTestId('kitchen-page-search-item-stock')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-page-search-item-ingredients')).toBeNull();
    });

    it('finds the recipe book by the names of the pages that went into it', async () => {
        await renderStubScreen(<SearchProbe />, { session: kitchenManagerSession() });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-page-search-trigger'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-page-search-item-recipes')).toBeTruthy();
        });

        // No page is called "Sauces" any more; the book answers to the word instead.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-page-search-input'), 'sauces');
        });
        expect(screen.getByTestId('kitchen-page-search-item-recipes')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-page-search-item-stock')).toBeNull();
    });
});

/** The trail as pressable text, so a test can read each crumb and press the ones that link. */
function TrailProbe() {
    const crumbs = useKitchenTrail();
    return (
        <>
            {crumbs.map((crumb) => (
                <Pressable
                    key={crumb.key}
                    testID={`crumb-${crumb.key}`}
                    disabled={crumb.onPress === undefined}
                    onPress={crumb.onPress}
                >
                    <RNText>{`${crumb.label}|${crumb.onPress === undefined ? 'current' : 'link'}`}</RNText>
                </Pressable>
            ))}
        </>
    );
}

/** A list page that opens one record in place, as every Catalogue View does. */
function ListWithView() {
    const [open, setOpen] = useState(true);
    return open ? (
        <OpenRecord
            onBack={() => {
                setOpen(false);
            }}
        />
    ) : (
        <RNText testID="list">list</RNText>
    );
}

function OpenRecord({ onBack }: { readonly onBack: () => void }) {
    // A fresh closure every render, as the screens pass one — the trail must not loop on it.
    useKitchenTrailLeaf('Olive oil', () => {
        onBack();
    });
    return <RNText testID="record">record</RNText>;
}

describe('useKitchenTrail with a record open inside its list', () => {
    it('names the record and makes the list crumb the way back to the list', async () => {
        await renderStubScreen(
            <KitchenTrailProvider>
                <TrailProbe />
                <ListWithView />
            </KitchenTrailProvider>,
            { session: kitchenManagerSession() },
        );

        // `/kitchen/stock` is the family route itself, so without the record's back this crumb
        // would be the current page and not a link — which is why the View pages could not drop
        // their own Back button before.
        await waitFor(() => {
            expect(screen.getByTestId('crumb-leaf')).toHaveTextContent('Olive oil|current');
        });
        expect(screen.getByTestId('crumb-stock')).toHaveTextContent(/\|link$/);

        await act(async () => {
            fireEvent.press(screen.getByTestId('crumb-stock'));
        });

        expect(screen.getByTestId('list')).toBeTruthy();
        // Closed: the trail is the list page's own two crumbs again.
        expect(screen.queryByTestId('crumb-leaf')).toBeNull();
        expect(screen.getByTestId('crumb-stock')).toHaveTextContent(/\|current$/);
    });
});
