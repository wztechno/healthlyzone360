import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { queryKeys } from '../../data/query-keys.ts';
import { consumerNavigation, marketplaceNavigation } from '../../navigation/consumer-items.ts';
import { ConsumerShell } from '../../shell/consumer-shell.tsx';
import { renderScreen } from '../../testing/render-screen.tsx';
import { clearResumeIntent, getResumeIntent, recordResumeIntent } from './resume-intent.ts';
import { ConsumerHomeScreen } from './screens/consumer-home-screen.tsx';
import { DietitianProfileScreen } from './screens/dietitian-profile-screen.tsx';
import { DietitiansScreen } from './screens/dietitians-screen.tsx';
import { DiscoverScreen } from './screens/discover-screen.tsx';
import { ForBusinessScreen } from './screens/for-business-screen.tsx';
import { HowItWorksScreen } from './screens/how-it-works-screen.tsx';
import { KitchenMenuScreen } from './screens/kitchen-menu-screen.tsx';
import { KitchenProfileScreen } from './screens/kitchen-profile-screen.tsx';
import { KitchensScreen } from './screens/kitchens-screen.tsx';
import { PublicLandingScreen } from './screens/public-landing-screen.tsx';

const CONSUMER = MOCK_SCENARIOS['consumer-prototype'].primaryEmail;

/**
 * Route parameters are the one thing these screens cannot reach through a repository, so the router
 * is mocked rather than rendered. `params` is mutable so a test can put a kitchen identifier in
 * front of a screen the way a deep link would.
 */
const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const setParams = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams, back: jest.fn() }),
        usePathname: () => '/customer',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
    clearResumeIntent();
});

/* ── public landing ──────────────────────────────────────────────────────────────────────────── */

describe('PublicLandingScreen', () => {
    it('shows a skeleton while the featured kitchens load, then the kitchens', async () => {
        await renderScreen(<PublicLandingScreen />, { scenario: 'consumer-prototype' });

        expect(screen.getByTestId('landing-hero')).toBeTruthy();
        expect(screen.getByTestId('landing-featured-loading')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('landing-featured-grid')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-card-verdant-kitchen')).toBeTruthy();
    });

    it('offers both authentication entry points', async () => {
        await renderScreen(<PublicLandingScreen />, { scenario: 'consumer-prototype' });

        await fireEvent.press(screen.getByTestId('landing-register'));
        expect(routerMock.__push).toHaveBeenCalledWith('/register');

        await fireEvent.press(screen.getByTestId('landing-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });
});

/* ── kitchen directory ───────────────────────────────────────────────────────────────────────── */

describe('KitchensScreen', () => {
    it('lists only kitchens configured for the marketplace channel', async () => {
        await renderScreen(<KitchensScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });

        expect(screen.getByTestId('kitchen-card-verdant-kitchen')).toBeTruthy();
        // Wholesale only, and counter only: neither sells to a household through the marketplace.
        expect(screen.queryByTestId('kitchen-card-northwind-provisions')).toBeNull();
        expect(screen.queryByTestId('kitchen-card-olive-terrace-counter')).toBeNull();
    });

    it('renders the empty state, with a way out, when a search matches nothing', async () => {
        routerState.params = { q: 'zzzz-nothing-matches' };
        await renderScreen(<KitchensScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchens-empty-clear')).toBeTruthy();
    });

    it('narrows the list from a URL filter parameter', async () => {
        routerState.params = { cuisine: 'Coastal' };
        await renderScreen(<KitchensScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-card-saffron-and-sea')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-card-verdant-kitchen')).toBeNull();
    });

    it('shows the loading skeleton first', async () => {
        await renderScreen(<KitchensScreen />, { scenario: 'consumer-prototype' });
        expect(screen.getByTestId('kitchens-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('kitchens-grid'));
    });
});

/* ── kitchen profile and menu ────────────────────────────────────────────────────────────────── */

/**
 * Identifiers are read straight from a throwaway repository bundle rather than by rendering a
 * listing and scraping it. Rendering a second tree inside a test to obtain a route parameter leaves
 * the testing library's `screen` pointing at a tree the test then unmounts, which quietly breaks
 * every render that follows it in the file.
 */
const scratchRepositories = createMockRepositories({
    scenario: 'consumer-prototype',
    latencyMs: 0,
});

async function firstKitchenId(): Promise<string> {
    const page = await scratchRepositories.marketplace.listKitchens({
        channels: ['b2c', 'marketplace'],
    });
    const kitchen = page.items.find((row) => row.slug === 'verdant-kitchen') ?? page.items[0];
    if (kitchen === undefined) throw new Error('The prototype world has no marketplace kitchens.');
    return String(kitchen.id);
}

async function firstDietitianId(): Promise<string> {
    const page = await scratchRepositories.marketplace.listDietitians({ acceptingClients: true });
    const dietitian = page.items[0];
    if (dietitian === undefined) throw new Error('The prototype world has no dietitians.');
    return String(dietitian.id);
}

describe('KitchenProfileScreen', () => {
    it('renders the profile, its channels and its branches', async () => {
        const id = await firstKitchenId();

        await renderScreen(<KitchenProfileScreen kitchenId={id} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-name')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-channels')).toBeTruthy();
        expect(screen.getByTestId('kitchen-branches')).toBeTruthy();
        expect(screen.getByTestId('kitchen-view-menu')).toBeTruthy();
    });

    it('reports a failure rather than an empty page when the kitchen is unknown', async () => {
        await renderScreen(
            <KitchenProfileScreen kitchenId="01935f6d-f000-7000-8000-0000000000ff" />,
            { scenario: 'consumer-prototype' },
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-error')).toBeTruthy();
        });
    });

    it('shows the loading state before anything has arrived', async () => {
        await renderScreen(
            <KitchenProfileScreen kitchenId="01935f6d-f000-7000-8000-0000000000ff" />,
            { scenario: 'consumer-prototype' },
        );
        expect(screen.getByTestId('kitchen-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('kitchen-error'));
    });
});

describe('KitchenMenuScreen', () => {
    it('puts nutrition on the card and navigates to the meal record', async () => {
        const id = await firstKitchenId();

        await renderScreen(<KitchenMenuScreen kitchenId={id} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-menu-grid')).toBeTruthy();
        });

        // Doc 17, IA-12 / MKT-05: the energy figure is on the card, not behind a tap.
        const cards = screen.getAllByTestId(/^meal-card-.*-nutrition$/);
        expect(cards.length).toBeGreaterThan(0);

        const pressable = screen.getAllByTestId(/^meal-card-[a-z0-9-]+$/)[0];
        expect(pressable).toBeTruthy();
        await fireEvent.press(pressable!);

        // The catalogue wave's `/meals/{meal}` replaced the in-place summary drawer.
        expect(routerMock.__push).toHaveBeenCalledWith(expect.stringMatching(/^\/meals\//));
    });

    it('carries the medical disclaimer, because the cards carry figures', async () => {
        const id = await firstKitchenId();

        await renderScreen(<KitchenMenuScreen kitchenId={id} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-grid'));
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });

    it('renders an empty state when the filter excludes everything', async () => {
        const id = await firstKitchenId();

        routerState.params = { q: 'zzzz-nothing-matches' };
        await renderScreen(<KitchenMenuScreen kitchenId={id} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-menu-empty')).toBeTruthy();
        });
    });

    it('filters the mixed menu down to products only', async () => {
        const id = await firstKitchenId();

        routerState.params = { itemType: 'product' };
        await renderScreen(<KitchenMenuScreen kitchenId={id} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-menu-grid')).toBeTruthy();
        });

        expect(screen.getAllByTestId(/^meal-card-[a-z0-9-]+$/).length).toBeGreaterThan(0);
        expect(screen.queryAllByTestId(/^meal-card-.*-nutrition$/)).toHaveLength(0);
    });
});

/* ── dietitians ──────────────────────────────────────────────────────────────────────────────── */

describe('DietitiansScreen', () => {
    it('lists professionals with their synthetic-credential note', async () => {
        await renderScreen(<DietitiansScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('dietitians-grid')).toBeTruthy();
        });
        expect(screen.getAllByTestId(/-synthetic-credentials$/).length).toBeGreaterThan(0);
    });

    it('shows the empty state when a specialism matches nobody', async () => {
        routerState.params = { specialism: 'Underwater basket weaving' };
        await renderScreen(<DietitiansScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('dietitians-empty')).toBeTruthy();
        });
    });
});

describe('DietitianProfileScreen', () => {
    it('marks the invented registration and offers an honest consultation control', async () => {
        const id = await firstDietitianId();

        await renderScreen(<DietitianProfileScreen dietitianId={id} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('dietitian-name')).toBeTruthy();
        });
        expect(screen.getByTestId('dietitian-synthetic-note')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('prototype-action'));

        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });
});

/* ── explainer and business ──────────────────────────────────────────────────────────────────── */

describe('HowItWorksScreen', () => {
    it('renders four steps and the standing disclaimer', async () => {
        await renderScreen(<HowItWorksScreen />);

        for (const step of ['tell', 'target', 'plan', 'eat']) {
            expect(screen.getByTestId(`how-it-works-step-${step}`)).toBeTruthy();
        }
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });
});

describe('ForBusinessScreen', () => {
    it('presents the programmes without a single price', async () => {
        await renderScreen(<ForBusinessScreen />);

        for (const programme of ['corporate', 'clinic', 'gym', 'wholesale']) {
            expect(screen.getByTestId(`for-business-programme-${programme}`)).toBeTruthy();
        }
        // Business-price privacy: no currency marker may appear anywhere on this screen.
        const rendered = JSON.stringify(screen.toJSON());
        expect(rendered).not.toMatch(/AED|SAR|\bfrom \d/i);
        expect(screen.getByTestId('for-business-pricing')).toBeTruthy();
    });

    it('answers the quotation request with a real route rather than a dead control', async () => {
        await renderScreen(<ForBusinessScreen />);

        await fireEvent.press(screen.getByTestId('for-business-request-quotation'));

        await waitFor(() => {
            expect(screen.getByTestId('for-business-enquiry')).toBeTruthy();
        });

        await fireEvent.press(screen.getByTestId('for-business-enquiry-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });
});

/* ── discover ────────────────────────────────────────────────────────────────────────────────── */

describe('DiscoverScreen', () => {
    it('hands a search over to the kitchen directory with the query in the URL', async () => {
        await renderScreen(<DiscoverScreen />, { scenario: 'consumer-prototype' });

        await fireEvent.changeText(screen.getByTestId('discover-search-input'), 'coastal');
        await fireEvent.press(screen.getByTestId('discover-search-submit'));

        expect(routerMock.__push).toHaveBeenCalledWith('/kitchens?q=coastal');
    });

    it('links every catalogue family to its real route', async () => {
        await renderScreen(<DiscoverScreen />, { scenario: 'consumer-prototype' });

        await fireEvent.press(screen.getByTestId('discover-family-meals'));

        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });
});

/* ── consumer home ───────────────────────────────────────────────────────────────────────────── */

describe('ConsumerHomeScreen', () => {
    it('shows the running subscription and opens the screen that manages it', async () => {
        await renderScreen(<ConsumerHomeScreen />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-card-content')).toBeTruthy();
        });
        expect(screen.getByTestId('consumer-greeting')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('consumer-subscription-manage'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            expect.stringMatching(/^\/customer\/subscriptions\//),
        );
    });

    it('offers to resume a marketplace page recorded before sign-in', async () => {
        recordResumeIntent({ href: '/kitchens', labelKey: 'marketplace:nav.kitchens' });

        await renderScreen(<ConsumerHomeScreen />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        expect(screen.getByTestId('consumer-resume')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('consumer-resume-continue'));
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchens');
        expect(getResumeIntent()).toBeNull();
    });
});

/* ── navigation and shells ───────────────────────────────────────────────────────────────────── */

describe('navigation descriptors', () => {
    it('offers only the destinations whose feature has a backend today', () => {
        const offered = [...consumerNavigation(), ...marketplaceNavigation()]
            .map((item) => item.href)
            .sort();

        expect([...new Set(offered)]).toEqual([
            '/customer',
            '/customer/cart',
            '/customer/subscriptions',
            '/discover',
            '/for-business',
            '/how-it-works',
            '/kitchens',
            '/meals',
            '/plans',
            '/profile',
        ]);
    });
});

describe('ConsumerShell', () => {
    it('renders only reachable destinations and navigates them for real', async () => {
        await renderScreen(
            <ConsumerShell unguarded>
                <></>
            </ConsumerShell>,
            { scenario: 'consumer-prototype', signInAs: CONSUMER },
        );

        expect(screen.getByTestId('consumer-nav-home')).toBeTruthy();
        expect(screen.queryByTestId('consumer-nav-planner')).toBeNull();
        expect(screen.queryByTestId('consumer-nav-nutrition')).toBeNull();
        expect(screen.queryByTestId('consumer-nav-virtual-dietitian')).toBeNull();

        await fireEvent.press(screen.getByTestId('consumer-nav-subscriptions'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/subscriptions');
        expect(screen.queryByTestId('prototype-notice')).toBeNull();
    });
});

/* ── the resume-intent store ─────────────────────────────────────────────────────────────────── */

describe('resume intent', () => {
    it('records, reads and clears one destination', () => {
        expect(getResumeIntent()).toBeNull();

        recordResumeIntent({ href: '/kitchens/abc', labelKey: 'marketplace:nav.kitchens' });
        expect(getResumeIntent()?.href).toBe('/kitchens/abc');

        clearResumeIntent();
        expect(getResumeIntent()).toBeNull();
    });
});

/* ── query keys ──────────────────────────────────────────────────────────────────────────────── */

describe('query keys', () => {
    it('nests every family under a prefix its own root can invalidate', () => {
        expect(queryKeys.marketplace.kitchens({ query: 'a' })[0]).toBe('marketplace');
        expect(queryKeys.catalogue.meals()[0]).toBe('catalogue');
        expect(queryKeys.planner.week('plan-1' as never, '2026-07-27')[0]).toBe('planner');
        expect(queryKeys.commerce.cart()[0]).toBe('commerce');
        expect(queryKeys.vd.sessions()[0]).toBe('vd');
        expect(queryKeys.business.quotations()[0]).toBe('business');
        expect(queryKeys.professional.reviewQueue()[0]).toBe('professional');
        expect(queryKeys.nutrition.currentTargets()[0]).toBe('nutrition');
    });

    it('uses null rather than undefined for an absent filter', () => {
        expect(queryKeys.marketplace.kitchens()).toEqual(['marketplace', 'kitchens', null]);
    });

    it('sorts a comparison key so the order plans were picked in is not part of it', () => {
        const a = queryKeys.catalogue.planComparison(['b', 'a'] as never);
        const b = queryKeys.catalogue.planComparison(['a', 'b'] as never);
        expect(a).toEqual(b);
    });
});
