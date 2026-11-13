import { apiFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CatalogueItemRef,
    ItemChannelOffering,
    PriceListAdmin,
    PriceListChannels,
    PriceListEntry,
    SalesChannelRecord,
} from '@healthy360/api-client/contracts';
import { KitchenId, MealId, PriceListId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
    KITCHEN_MANAGER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    WholesaleSetupScreen,
    pickWholesaleChannel,
    pricedItemIds,
} from './screens/wholesale-setup-screen.tsx';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace: jest.fn(),
            setParams: jest.fn(),
            back: jest.fn(),
            canGoBack: () => false,
            dismissTo: jest.fn(),
        }),
        usePathname: () => '/kitchen/wholesale',
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
});

/**
 * `/kitchen/wholesale` against a world this file authors: the four checklist rows, each in its
 * not-done state, then the action that does it and the row reading done.
 *
 * 1. **Channel** — none open; *Open wholesale channel* creates a `b2b` row coded `wholesale`, named
 *    in both languages whatever the page is read in.
 * 2. **Agreement list** — *New agreement price list* creates an agreement-scoped draft in the
 *    kitchen's currency and opens it in the editor, with the way back here.
 * 3. **Assignment** — only agreement lists are listed; *Assign* appends the wholesale channel to
 *    the list's own channels under the list's lock version.
 * 4. **Items** — only confirmed prices count; *Offer* writes each missing item, keeps going past a
 *    failure, and names the failure.
 */

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000a001');
const AGREEMENT_ID = PriceListId.unsafe('01935f6d-0000-7000-8000-00000000d001');
const PUBLIC_ID = PriceListId.unsafe('01935f6d-0000-7000-8000-00000000d002');
const NEW_LIST_ID = PriceListId.unsafe('01935f6d-0000-7000-8000-00000000d003');

const RETAIL: SalesChannelRecord = {
    id: '01935f6d-0000-7000-8000-00000000e001',
    code: 'web',
    kind: 'b2c_web',
    name: { en: 'Web shop', ar: 'المتجر' },
    isActive: true,
};
const WHOLESALE: SalesChannelRecord = {
    id: '01935f6d-0000-7000-8000-00000000e002',
    code: 'wholesale',
    kind: 'b2b',
    name: { en: 'Wholesale', ar: 'البيع بالجملة' },
    isActive: true,
};

function mealId(ordinal: number): MealId {
    return MealId.unsafe(`01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`);
}

function mealRef(ordinal: number): CatalogueItemRef {
    return { kind: 'meal', mealId: mealId(ordinal) };
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 3,
        status: 'draft',
        updatedAt: '2026-10-26T09:00:00.000Z',
        updatedByName: null,
        ...overrides,
    };
}

function entry(item: CatalogueItemRef, overrides: Partial<PriceListEntry> = {}): PriceListEntry {
    return {
        item,
        priceStatus: 'confirmed',
        amountMinor: 1250,
        effectiveFrom: '2026-10-01',
        effectiveUntil: null,
        note: null,
        ...overrides,
    };
}

const AGREEMENT_LIST: PriceListAdmin = {
    id: AGREEMENT_ID,
    meta: meta({ status: 'published' }),
    name: { en: 'Acme agreement', ar: 'اتفاقية أكمي' },
    currency: 'USD',
    kitchenId: KITCHEN_ID,
    channels: ['b2b'],
    entries: [
        entry(mealRef(1)),
        entry(mealRef(2)),
        entry(mealRef(3)),
        // Not a price: never counted, never offered.
        entry(mealRef(4), { priceStatus: 'placeholder', amountMinor: null }),
    ],
};

const PUBLIC_LIST: PriceListAdmin = {
    ...AGREEMENT_LIST,
    id: PUBLIC_ID,
    name: { en: 'Retail', ar: 'التجزئة' },
    channels: ['b2c'],
    entries: [entry(mealRef(5))],
};

function scope(
    id: PriceListId,
    customerScope: PriceListChannels['customerScope'],
    salesChannelIds: readonly string[],
): PriceListChannels {
    return { priceListId: id, lockVersion: 3, customerScope, salesChannelIds };
}

function offering(ordinal: number, salesChannelIds: readonly string[]): ItemChannelOffering {
    return {
        itemId: String(mealId(ordinal)),
        name: { en: `Meal ${String(ordinal)}`, ar: `وجبة ${String(ordinal)}` },
        lockVersion: 1,
        salesChannelIds,
    };
}

/** A world the stubs read live, so a write is visible to the refetch that follows it. */
interface World {
    channels: SalesChannelRecord[];
    lists: PriceListAdmin[];
    scopes: Map<string, PriceListChannels>;
    offerings: Map<string, ItemChannelOffering>;
}

function stubs(world: World): RepositoryOverrides {
    return {
        kitchenAdmin: {
            listSalesChannels: async () => world.channels,
            listPriceLists: async () => page(world.lists),
            // One read each, as the screen now makes them — never one per list or per item.
            listPriceListChannels: async () => [...world.scopes.values()],
            listItemChannelOfferings: async (ids) =>
                ids.flatMap((id) => {
                    const found = world.offerings.get(id);
                    return found === undefined ? [] : [found];
                }),
        },
    };
}

async function press(testID: string) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

describe('the wholesale setup model', () => {
    it('picks an active wholesale row, b2b first', () => {
        const corporate: SalesChannelRecord = { ...WHOLESALE, id: 'c', kind: 'corporate' };
        expect(pickWholesaleChannel([RETAIL])).toBeNull();
        expect(pickWholesaleChannel([RETAIL, { ...WHOLESALE, isActive: false }])).toBeNull();
        expect(pickWholesaleChannel([corporate, WHOLESALE])?.id).toBe(WHOLESALE.id);
        expect(pickWholesaleChannel([corporate])?.id).toBe('c');
    });

    it('counts each confirmed article once', () => {
        expect(pricedItemIds([AGREEMENT_LIST, AGREEMENT_LIST])).toEqual(
            [1, 2, 3].map((ordinal) => String(mealId(ordinal))),
        );
    });
});

describe('/kitchen/wholesale', () => {
    it('opens the wholesale channel when the kitchen has none', async () => {
        const world: World = {
            channels: [RETAIL],
            lists: [],
            scopes: new Map(),
            offerings: new Map(),
        };
        const { repositories } = await renderStubScreen(<WholesaleSetupScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                ...stubs(world),
                kitchenAdmin: {
                    ...stubs(world).kitchenAdmin,
                    createSalesChannel: async () => {
                        world.channels = [RETAIL, WHOLESALE];
                        return WHOLESALE;
                    },
                },
            },
        });

        await untilVisible('kitchen-wholesale-channel');
        expect(screen.getByTestId('kitchen-wholesale-channel-state')).toHaveTextContent('To do');
        expect(screen.getByTestId('kitchen-wholesale-assign-body')).toHaveTextContent(
            'Open the wholesale channel first.',
        );
        expect(screen.getByTestId('kitchen-wholesale-items-body')).toHaveTextContent(
            'Open the wholesale channel first.',
        );

        await press('kitchen-wholesale-channel-open');

        expect(repositories.kitchenAdmin.createSalesChannel).toHaveBeenCalledWith({
            code: 'wholesale',
            kind: 'b2b',
            name: { en: 'Wholesale', ar: 'البيع بالجملة' },
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-wholesale-channel-state')).toHaveTextContent('Done');
        });
        expect(screen.queryByTestId('kitchen-wholesale-channel-open')).toBeNull();
    });

    it('creates an agreement list in the kitchen’s currency and opens it in the editor', async () => {
        const world: World = {
            channels: [WHOLESALE],
            lists: [],
            scopes: new Map(),
            offerings: new Map(),
        };
        const { repositories } = await renderStubScreen(<WholesaleSetupScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                ...stubs(world),
                kitchenAdmin: {
                    ...stubs(world).kitchenAdmin,
                    createPriceList: async (request) => ({
                        ...AGREEMENT_LIST,
                        id: NEW_LIST_ID,
                        meta: meta(),
                        name: request.name,
                        channels: [],
                        entries: [],
                    }),
                },
                kitchenOps: {
                    getProcurementReference: async () => ({
                        currencies: [],
                        defaultCurrencyCode: 'USD',
                        measurementUnits: [],
                    }),
                },
            },
        });

        await untilVisible('kitchen-wholesale-lists');
        expect(screen.getByTestId('kitchen-wholesale-lists-state')).toHaveTextContent('To do');
        expect(screen.getByTestId('kitchen-wholesale-lists-body')).toHaveTextContent(
            /No agreement price list yet\./,
        );

        await press('kitchen-wholesale-lists-new');
        await untilVisible('kitchen-wholesale-new-list');
        // The scope is fixed here: an agreement list is what this row is for.
        expect(screen.queryByTestId('kitchen-wholesale-new-list-scope')).toBeNull();

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-wholesale-new-list-name-en-input'),
                'Acme agreement',
            );
            fireEvent.changeText(
                screen.getByTestId('kitchen-wholesale-new-list-code-input'),
                'acme-2026',
            );
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-wholesale-new-list-currency-input').props.value,
            ).toBe('USD');
        });
        await press('kitchen-wholesale-new-list-confirm');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.createPriceList).toHaveBeenCalledWith({
                code: 'acme-2026',
                name: { en: 'Acme agreement', ar: '' },
                currency: 'USD',
                customerScope: 'agreement',
            });
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith(
                `/kitchen/price-lists/${String(NEW_LIST_ID)}?returnTo=${encodeURIComponent('/kitchen/wholesale')}`,
            );
        });
    });

    it('lists only agreement lists and assigns one to the wholesale channel', async () => {
        const world: World = {
            channels: [RETAIL, WHOLESALE],
            lists: [AGREEMENT_LIST, PUBLIC_LIST],
            scopes: new Map([
                [String(AGREEMENT_ID), scope(AGREEMENT_ID, 'agreement', [])],
                [String(PUBLIC_ID), scope(PUBLIC_ID, 'public', [RETAIL.id])],
            ]),
            offerings: new Map(
                [1, 2, 3].map((ordinal) => [
                    String(mealId(ordinal)),
                    offering(ordinal, [WHOLESALE.id]),
                ]),
            ),
        };
        const { repositories } = await renderStubScreen(<WholesaleSetupScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                ...stubs(world),
                kitchenAdmin: {
                    ...stubs(world).kitchenAdmin,
                    setPriceListChannels: async (id, request) => {
                        const next = scope(id, 'agreement', request.salesChannelIds);
                        world.scopes.set(String(id), { ...next, lockVersion: 4 });
                        return next;
                    },
                },
            },
        });

        const row = `kitchen-wholesale-list-${String(AGREEMENT_ID)}`;
        await untilVisible(row);
        expect(screen.queryByTestId(`kitchen-wholesale-list-${String(PUBLIC_ID)}`)).toBeNull();
        expect(screen.getByTestId('kitchen-wholesale-lists-state')).toHaveTextContent('Done');
        expect(screen.getByTestId('kitchen-wholesale-assign-state')).toHaveTextContent('To do');
        expect(screen.getByTestId('kitchen-wholesale-assign-body')).toHaveTextContent(
            '0 of 1 agreement lists are on “Wholesale”.',
        );

        await press(`${row}-assign`);

        expect(repositories.kitchenAdmin.setPriceListChannels).toHaveBeenCalledWith(AGREEMENT_ID, {
            lockVersion: 3,
            salesChannelIds: [WHOLESALE.id],
        });
        await untilVisible(`${row}-assigned`);
        expect(screen.getByTestId('kitchen-wholesale-assign-state')).toHaveTextContent('Done');
    });

    it('offers each missing priced item, keeps going past a failure and names it', async () => {
        const world: World = {
            channels: [RETAIL, WHOLESALE],
            lists: [AGREEMENT_LIST],
            scopes: new Map([
                [String(AGREEMENT_ID), scope(AGREEMENT_ID, 'agreement', [WHOLESALE.id])],
            ]),
            offerings: new Map([
                [String(mealId(1)), offering(1, [RETAIL.id, WHOLESALE.id])],
                [String(mealId(2)), offering(2, [RETAIL.id])],
                [String(mealId(3)), offering(3, [])],
            ]),
        };
        const { repositories } = await renderStubScreen(<WholesaleSetupScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                ...stubs(world),
                kitchenAdmin: {
                    ...stubs(world).kitchenAdmin,
                    offerItemOnChannel: async (itemId, salesChannelId) => {
                        if (itemId === String(mealId(3))) {
                            throwFailure(apiFailure('server', { message: 'Not sellable.' }));
                        }
                        const current = world.offerings.get(itemId);
                        if (current === undefined) throw new Error('unknown item');
                        const next = {
                            ...current,
                            salesChannelIds: [...current.salesChannelIds, salesChannelId],
                        };
                        world.offerings.set(itemId, next);
                        return next;
                    },
                },
            },
        });

        await untilVisible('kitchen-wholesale-items-offer');
        // Three confirmed prices; the placeholder is not an item on offer.
        expect(screen.getByTestId('kitchen-wholesale-items-body')).toHaveTextContent(
            '1 of 3 priced items offered on wholesale',
        );

        await press('kitchen-wholesale-items-offer');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.offerItemOnChannel).toHaveBeenCalledTimes(2);
        });
        expect(repositories.kitchenAdmin.offerItemOnChannel).toHaveBeenCalledWith(
            String(mealId(2)),
            WHOLESALE.id,
        );
        expect(repositories.kitchenAdmin.offerItemOnChannel).toHaveBeenCalledWith(
            String(mealId(3)),
            WHOLESALE.id,
        );
        await untilVisible(`kitchen-wholesale-items-failure-${String(mealId(3))}`);
        expect(
            screen.getByTestId(`kitchen-wholesale-items-failure-${String(mealId(3))}`),
        ).toHaveTextContent('Meal 3: Not sellable.');
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-wholesale-items-body')).toHaveTextContent(
                '2 of 3 priced items offered on wholesale',
            );
        });
        expect(screen.getByTestId('kitchen-wholesale-items-state')).toHaveTextContent('To do');
    });

    it('shows the state but not the catalogue writes to a reader without catalogue.manage', async () => {
        const world: World = {
            channels: [RETAIL],
            lists: [],
            scopes: new Map(),
            offerings: new Map(),
        };
        await renderStubScreen(<WholesaleSetupScreen />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({
                    permissions: KITCHEN_MANAGER_PERMISSIONS.filter(
                        (code) => code !== 'catalogue.manage_organisation',
                    ),
                }),
            }),
            repositories: stubs(world),
        });

        await untilVisible('kitchen-wholesale-channel');
        expect(screen.getByTestId('kitchen-wholesale-channel-state')).toHaveTextContent('To do');
        expect(screen.queryByTestId('kitchen-wholesale-channel-open')).toBeNull();
        // The price-list half is still this reader's.
        expect(screen.getByTestId('kitchen-wholesale-lists-new')).toBeTruthy();
    });
});
