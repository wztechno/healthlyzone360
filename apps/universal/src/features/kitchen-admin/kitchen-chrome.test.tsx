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

/** One router for the file, so a test can see where a crumb went. */
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
/** The address's query, as a test sets it — `returnTo` above all. */
let mockParams: Record<string, string> = {};
let mockPathname = '/kitchen/stock';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => mockRouter,
    useGlobalSearchParams: () => mockParams,
    usePathname: () => mockPathname,
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
    it('leads with Overview, then the families — the workspace switcher is not on the rail', async () => {
        await renderStubScreen(<Probe />, { session: kitchenManagerSession() });

        // The families appear once the stubbed session has hydrated the access state.
        await waitFor(() => {
            expect(screen.getByTestId('probe-stock')).toBeTruthy();
        });

        const index = (key: string) =>
            Number(String(screen.getByTestId(`probe-${key}`).props.children).split('|')[0]);
        expect(index('overview')).toBe(0);
        expect(index('overview')).toBeLessThan(index('stock'));
        expect(screen.getByTestId('probe-overview')).toHaveTextContent(/\|\(ungrouped\)\|/);

        // A family destination sits under its registry group and lights up for the pathname.
        expect(screen.getByTestId('probe-stock')).toHaveTextContent(/\|Operations\|/);
        expect(screen.getByTestId('probe-stock')).toHaveTextContent(/\|active$/);

        // The areas and the account are the shell's bottom bar now, not a rail module.
        expect(screen.queryByTestId('probe-area-kitchen')).toBeNull();
        expect(screen.queryByTestId('probe-profile')).toBeNull();
        expect(screen.queryByTestId('probe-workspace')).toBeNull();
    });

    it('drops Setup once the kitchen is live', async () => {
        await renderStubScreen(<Probe />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: { getKitchenSetup: async () => ({ isLive: true, steps: [] }) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('probe-stock')).toBeTruthy();
        });
        await waitFor(() => {
            expect(screen.queryByTestId('probe-setup')).toBeNull();
        });
        expect(screen.getByTestId('probe-review')).toHaveTextContent(/\|To do\|/);
    });

    it('keeps Setup under To do until the kitchen is live', async () => {
        await renderStubScreen(<Probe />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: { getKitchenSetup: async () => ({ isLive: false, steps: [] }) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('probe-setup')).toHaveTextContent(/\|To do\|/);
        });
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

/** A page opened from another page than its own list — a recipe opened from Stock gaps. */
function OpenedFrom({ onBack }: { readonly onBack: () => void }) {
    useKitchenTrailLeaf(
        'Lentil Soup',
        () => {
            onBack();
        },
        'Stock gaps',
    );
    return <RNText testID="record">record</RNText>;
}

describe('useKitchenTrail with a page that names where it was opened from', () => {
    it('puts that page above the leaf, as the way back, in place of the route’s own family', async () => {
        const onBack = jest.fn();
        await renderStubScreen(
            <KitchenTrailProvider>
                <TrailProbe />
                <OpenedFrom onBack={onBack} />
            </KitchenTrailProvider>,
            { session: kitchenManagerSession() },
        );

        await waitFor(() => {
            expect(screen.getByTestId('crumb-leaf')).toHaveTextContent('Lentil Soup|current');
        });
        expect(screen.getByTestId('crumb-hub')).toHaveTextContent(/\|link$/);
        expect(screen.getByTestId('crumb-return')).toHaveTextContent('Stock gaps|link');
        // The route's own family crumb gives way to it — "… › Stock gaps › Lentil Soup".
        expect(screen.queryByTestId('crumb-stock')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('crumb-return'));
        });
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('keeps the family crumb when a page names a parent but gives no way back to it', async () => {
        function NoBack() {
            useKitchenTrailLeaf('Lentil Soup', undefined, 'Stock gaps');
            return null;
        }
        await renderStubScreen(
            <KitchenTrailProvider>
                <TrailProbe />
                <NoBack />
            </KitchenTrailProvider>,
            { session: kitchenManagerSession() },
        );

        await waitFor(() => {
            expect(screen.getByTestId('crumb-stock')).toBeTruthy();
        });
        expect(screen.queryByTestId('crumb-return')).toBeNull();
    });
});

describe('useKitchenTrail — the module, and a page opened from somewhere else', () => {
    afterEach(() => {
        mockParams = {};
        mockPathname = '/kitchen/stock';
        jest.clearAllMocks();
    });

    it('names the rail module between home and the page, with its pages to move sideways', async () => {
        await renderStubScreen(
            <KitchenTrailProvider>
                <TrailProbe />
            </KitchenTrailProvider>,
            { session: kitchenManagerSession() },
        );

        expect(await screen.findByTestId('crumb-module')).toHaveTextContent('Operations|current');
        expect(screen.getByTestId('crumb-stock')).toHaveTextContent('Stock|current');
    });

    it('leads back to the page it was opened from when that is another module', async () => {
        mockParams = { returnTo: '/kitchen/consumption-exceptions?gap=g1' };
        await renderStubScreen(
            <KitchenTrailProvider>
                <TrailProbe />
            </KitchenTrailProvider>,
            { session: kitchenManagerSession() },
        );

        // `⌂ / ↩ Stock gaps / Stock` — the module gives way to the return, which is the way back.
        expect(await screen.findByTestId('crumb-stock')).toHaveTextContent('Stock|current');
        expect(screen.getByTestId('crumb-return')).toHaveTextContent('Stock gaps|link');
        expect(screen.queryByTestId('crumb-module')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('crumb-return'));
        });
        expect(mockRouter.dismissTo).toHaveBeenCalledWith('/kitchen/consumption-exceptions?gap=g1');
    });

    it('keeps the ordinary trail for a return to its own list, which the list crumb goes back to', async () => {
        // A movement page under Stock, opened from the Stock list's record.
        mockPathname = '/kitchen/stock/movement';
        mockParams = { returnTo: '/kitchen/stock?view=s1' };
        await renderStubScreen(
            <KitchenTrailProvider>
                <TrailProbe />
                <OpenedOwn />
            </KitchenTrailProvider>,
            { session: kitchenManagerSession() },
        );

        expect(await screen.findByTestId('crumb-module')).toBeTruthy();
        expect(screen.getByTestId('crumb-leaf')).toHaveTextContent('Olive oil|current');
        expect(screen.queryByTestId('crumb-return')).toBeNull();
        await act(async () => {
            fireEvent.press(screen.getByTestId('crumb-stock'));
        });
        expect(mockRouter.dismissTo).toHaveBeenCalledWith('/kitchen/stock?view=s1');
    });
});

/** A record on a route of its own under the family — the list crumb above it is a link. */
function OpenedOwn() {
    useKitchenTrailLeaf('Olive oil');
    return null;
}
