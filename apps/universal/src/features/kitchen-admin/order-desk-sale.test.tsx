import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    CursorPage,
    KitchenOrder,
    MealAdmin,
    OrderDeskCustomer,
    OrderDeskCustomerCreated,
    OrderDeskQuote,
    OrderDeskQuoteLine,
    OrderDeskSaleRequest,
    PlaceOrderDeskSaleRequest,
    ProductAdmin,
    ProductAdminFilter,
} from '@healthy360/api-client/contracts';
import { KitchenId, MealId, OrderId, ProductId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { OrderDeskSaleScreen } from './screens/order-desk-sale-screen.tsx';

/* `mock`-prefixed so the factory below may close over them — Jest's hoisting rule. */
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk/sale',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The sale page (Kitchen v2 `4f`), against repositories this file writes.
 *
 * The sale's state rules and the basket are proved in `order-desk-sale-model.test.ts`; what is
 * asserted here is what only a rendered page can answer — that a tile's price is the quote's answer
 * for one of it, that a tap lands on the ticket, that the kind of sale opens exactly the cards it
 * needs and the ticket says what is still missing, that a counter sale clears for the next customer
 * while a collection goes back to the queue, and that a refusal is rendered as reasons.
 *
 * Every `fireEvent` that changes a debounced value is followed by a real wait, because the quote and
 * both searches wait 300 ms before asking anything.
 */

const MEAL_ID = MealId.unsafe('test-0000-meal-0001');
const PRODUCT_ID = ProductId.unsafe('test-0000-prod-0001');
const KITCHEN_ID = KitchenId.unsafe('test-0000-kitchen-01');
const ACCOUNT_ID = 'test-0000-account-001';

/** What the stub quote charges for one of each article, in minor units. */
const UNIT_PRICE: Readonly<Record<string, number>> = {
    [String(MEAL_ID)]: 3_200,
    [String(PRODUCT_ID)]: 1_500,
};

function pageOf<T>(items: readonly T[]): CursorPage<T> {
    return { items, nextCursor: null, hasMore: false, totalCount: items.length };
}

function adminMeal(): MealAdmin {
    return {
        id: MEAL_ID,
        meta: {
            status: 'published',
            lockVersion: 1,
            updatedAt: '2026-08-01T09:00:00.000Z',
            updatedByName: 'Seed',
        },
        name: { en: 'Mujaddara bowl', ar: 'مجدرة' },
        description: { en: 'Served warm.', ar: 'يُقدَّم دافئًا.' },
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KITCHEN_ID,
        recipeId: null,
        recipeVersionId: null,
        productionMode: null,
        ingredientId: null,
        sellsFromFinishedStock: false,
        netContentQuantity: null,
        netContentUnitId: null,
        portionFactor: 1,
        mealTypes: ['lunch'],
        dietClassifications: [],
        allergens: [],
        channelAvailability: [],
        availability: [],
        imagePlaceholderId: 'placeholder-1',
        marginPercent: 42,
    };
}

function adminProduct(): ProductAdmin {
    return {
        id: PRODUCT_ID,
        meta: {
            status: 'published',
            lockVersion: 1,
            updatedAt: '2026-08-01T09:00:00.000Z',
            updatedByName: 'Seed',
        },
        name: { en: 'Garlic sauce', ar: 'صلصة الثوم' },
        description: { en: 'A pot of it.', ar: 'علبة منه.' },
        categoryId: null,
        categoryCode: 'sauces',
        itemType: 'sauce',
        reference: null,
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KITCHEN_ID,
        isMarketPriced: false,
        isAssorted: false,
        netContentQuantity: null,
        netContentUnitId: null,
        packVariants: [],
        channelAvailability: [],
        recipeId: null,
        dietClassifications: [],
        dataQualityFlags: [],
        imagePlaceholderId: 'sauce-garlic-sauce',
    };
}

interface QuoteRules {
    /** Articles refused `channel_unavailable` at any quantity. */
    readonly refuse?: ReadonlySet<string>;
    /** Refuse an article only at this quantity — a ticket line, never the one-of-each shelf. */
    readonly refuseAtQuantity?: string;
    readonly orderRefusals?: OrderDeskQuote['refusals'];
}

/** A quote that prices whatever it is asked, by {@link UNIT_PRICE}. */
function quoteFor(request: OrderDeskSaleRequest, rules: QuoteRules = {}): OrderDeskQuote {
    const lines: OrderDeskQuoteLine[] = request.lines.map((line) => {
        const refused =
            (rules.refuse?.has(line.catalogueItemId) ?? false) ||
            rules.refuseAtQuantity === line.quantity;
        const unit = UNIT_PRICE[line.catalogueItemId] ?? 1_000;
        return {
            catalogueItemId: line.catalogueItemId,
            catalogueItemVariantId: line.catalogueItemVariantId,
            quantity: line.quantity,
            nameEn: null,
            nameAr: null,
            // Null together — a refused line has no price, and a zero reads as free.
            unitPriceMinor: refused ? null : unit,
            lineTotalMinor: refused ? null : unit * Number(line.quantity),
            currencyCode: 'AED',
            refusals: refused ? [{ reason: 'channel_unavailable', context: {} }] : [],
        };
    });
    const subtotal = lines.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0);
    const orderRefusals = rules.orderRefusals ?? [];
    return {
        lines,
        subtotalMinor: subtotal,
        deliveryFeeMinor: null,
        totalMinor: subtotal,
        currencyCode: 'AED',
        refusals: orderRefusals,
        quotable: orderRefusals.length === 0 && lines.every((line) => line.refusals.length === 0),
    };
}

function placedOrder(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
    return {
        id: OrderId.unsafe('test-0000-order-0001'),
        orderNumber: 'H360-2026-0500',
        branchId: null,
        status: 'fulfilled',
        currencyCode: 'AED',
        subtotalMinor: 6_400,
        deliveryFeeMinor: null,
        totalMinor: 6_400,
        paymentMethod: 'cash_at_counter',
        fulfilmentType: 'counter',
        delivery: {
            label: null,
            lineOne: null,
            lineTwo: null,
            city: null,
            areaNameEn: null,
            areaNameAr: null,
            areaId: null,
            windowCode: null,
            requestedDate: null,
            zoneId: null,
        },
        placedAt: '2026-08-16T09:00:00.000Z',
        confirmedAt: '2026-08-16T09:00:00.000Z',
        fulfilledAt: '2026-08-16T09:00:00.000Z',
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 2,
        lineCount: 1,
        lines: [],
        ...overrides,
    };
}

function customer(overrides: Partial<OrderDeskCustomer> = {}): OrderDeskCustomer {
    return {
        id: ACCOUNT_ID,
        displayName: 'Layla Haddad',
        phone: '+9613000111',
        origin: 'staff',
        hasOrdersWithOrg: true,
        ...overrides,
    };
}

interface SaleStubs {
    readonly quoteSale?: (request: OrderDeskSaleRequest) => Promise<OrderDeskQuote>;
    readonly placeSale?: (request: PlaceOrderDeskSaleRequest) => Promise<KitchenOrder>;
    readonly createCustomer?: () => Promise<OrderDeskCustomerCreated>;
    readonly listMeals?: () => Promise<CursorPage<MealAdmin>>;
    readonly listProducts?: (filter?: ProductAdminFilter) => Promise<CursorPage<ProductAdmin>>;
}

async function renderSale(stubs: SaleStubs = {}) {
    return renderStubScreen(<OrderDeskSaleScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenAdmin: {
                listMeals: stubs.listMeals ?? (async () => pageOf([adminMeal()])),
                listProducts: stubs.listProducts ?? (async () => pageOf([adminProduct()])),
                listServiceAreas: async () => pageOf([]),
            },
            orderDesk: {
                quoteSale: stubs.quoteSale ?? (async (request) => quoteFor(request)),
                placeSale: stubs.placeSale ?? (async () => placedOrder()),
                searchCustomers: async () => ({ rows: [customer()], limit: 20 }),
                createCustomer:
                    stubs.createCustomer ??
                    (async () => ({ customer: customer(), possibleDuplicates: [] })),
            },
        },
    });
}

async function untilVisible(testID: string) {
    await waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 5000 },
    );
}

/** Past every debounce on the page: the quote and both searches wait 300 ms. */
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
    });
}

const MEAL_TILE = `kitchen-order-desk-sale-tile-${String(MEAL_ID)}`;
const MEAL_LINE = `kitchen-order-desk-sale-line-${String(MEAL_ID)}`;
const SUBMIT = 'kitchen-order-desk-sale-submit';

/** Tap the seeded meal `times` times, each tap its own commit as a finger's would be. */
async function tapMeal(times = 1) {
    await untilVisible(MEAL_TILE);
    for (let tap = 0; tap < times; tap += 1) {
        await act(async () => {
            fireEvent.press(screen.getByTestId(MEAL_TILE));
        });
    }
    await settle();
}

async function chooseKind(kind: 'counter' | 'pickup' | 'delivery') {
    await untilVisible(`kitchen-order-desk-sale-kind-${kind}`);
    await act(async () => {
        fireEvent.press(screen.getByTestId(`kitchen-order-desk-sale-kind-${kind}`));
    });
}

async function chooseLayla() {
    await act(async () => {
        fireEvent.changeText(
            screen.getByTestId('kitchen-order-desk-sale-customer-search-input'),
            'Layla',
        );
    });
    await settle();
    await untilVisible(`kitchen-order-desk-sale-customer-${ACCOUNT_ID}-choose`);
    await act(async () => {
        fireEvent.press(
            screen.getByTestId(`kitchen-order-desk-sale-customer-${ACCOUNT_ID}-choose`),
        );
    });
}

beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
});

describe('sale — the menu', () => {
    it('prices each tile from a quote of one of each, and starts with an empty ticket', async () => {
        const quoteSale = jest.fn(async (request: OrderDeskSaleRequest) => quoteFor(request));
        await renderSale({ quoteSale });

        await waitFor(() => {
            expect(screen.getByTestId(`${MEAL_TILE}-price`)).toHaveTextContent('AED 32.00');
        });
        // The shelf is asked as a counter basket of one per tile — the tariff the ticket will use.
        expect(quoteSale).toHaveBeenCalledWith({
            fulfilmentType: 'counter',
            lines: [
                { catalogueItemId: String(MEAL_ID), catalogueItemVariantId: null, quantity: '1' },
            ],
        });
        expect(screen.getByTestId('kitchen-order-desk-sale-ticket-empty')).toBeTruthy();
        expect(screen.getByTestId(SUBMIT)).toBeDisabled();
    });

    it('marks a product the desk does not sell, and will not add it', async () => {
        await renderSale({
            quoteSale: async (request) => quoteFor(request, { refuse: new Set([String(MEAL_ID)]) }),
        });

        await waitFor(() => {
            expect(screen.getByTestId(`${MEAL_TILE}-price`)).toHaveTextContent('Not sold here');
        });
        expect(screen.getByTestId(MEAL_TILE)).toBeDisabled();
    });

    it('reads a packaged section through the product endpoint by its item type', async () => {
        const listProducts = jest.fn(async () => pageOf([adminProduct()]));
        await renderSale({ listProducts });
        await untilVisible(MEAL_TILE);

        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-order-desk-sale-menu-toolbar-status-sauce'),
            );
        });

        await untilVisible(`kitchen-order-desk-sale-tile-${String(PRODUCT_ID)}`);
        expect(listProducts).toHaveBeenCalledWith(
            expect.objectContaining({ itemType: 'sauce', statuses: ['published'] }),
        );
    });

    it('shows the menu failure with a retry rather than an empty menu', async () => {
        await renderSale({
            // What a dedicated `order_desk_agent` actually gets: no `catalogue.view_organisation`.
            listMeals: async () => {
                throw new ApiError(apiFailure('server'));
            },
        });

        await untilVisible('kitchen-order-desk-sale-menu-error');
        expect(screen.queryByTestId(MEAL_TILE)).toBeNull();
    });
});

describe('sale — the ticket is priced by the quote alone', () => {
    it('adds a line per tap, counts it on the tile, and totals it from the quote', async () => {
        await renderSale();
        await tapMeal(2);

        await waitFor(() => {
            expect(screen.getByTestId(`${MEAL_LINE}-total`)).toHaveTextContent('AED 64.00');
        });
        expect(screen.getByTestId(`${MEAL_LINE}-quantity`)).toHaveTextContent('2');
        // The badge is drawn for the eye and hidden from assistive technology; the tile's own label
        // is where the count is spoken.
        expect(
            screen.getByTestId(`${MEAL_TILE}-count`, { includeHiddenElements: true }),
        ).toHaveTextContent('2');
        expect(screen.getByTestId(MEAL_TILE)).toHaveAccessibleName(/2 on the ticket/);
        expect(screen.getByTestId('kitchen-order-desk-sale-total')).toHaveTextContent('AED 64.00');
        // Null is not zero: a counter sale has no fee at all.
        expect(screen.queryByTestId('kitchen-order-desk-sale-fee')).toBeNull();
        expect(screen.getByTestId(SUBMIT)).toHaveTextContent(
            'Charge AED 64.00 · Cash at the counter',
        );
    });

    it('asks the ticket quote once, debounced, rather than per tap', async () => {
        const quoteSale = jest.fn(async (request: OrderDeskSaleRequest) => quoteFor(request));
        await renderSale({ quoteSale });
        await tapMeal(3);
        await untilVisible('kitchen-order-desk-sale-totals');

        // The shelf asks for one of each; every other call is the ticket's, and there is one.
        const ticketCalls = quoteSale.mock.calls.filter(([request]) =>
            request.lines.some((line) => line.quantity !== '1'),
        );
        expect(ticketCalls).toEqual([
            [
                {
                    fulfilmentType: 'counter',
                    lines: [
                        {
                            catalogueItemId: String(MEAL_ID),
                            catalogueItemVariantId: null,
                            quantity: '3',
                        },
                    ],
                },
            ],
        ]);
    });

    it('takes the line off when it is stepped below one', async () => {
        await renderSale();
        await tapMeal();
        await untilVisible(MEAL_LINE);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${MEAL_LINE}-decrement`));
        });

        expect(screen.queryByTestId(MEAL_LINE)).toBeNull();
        expect(screen.getByTestId('kitchen-order-desk-sale-ticket-empty')).toBeTruthy();
    });

    it('renders a line refusal against its own line and will not place the order', async () => {
        await renderSale({
            quoteSale: async (request) => quoteFor(request, { refuseAtQuantity: '2' }),
        });
        await tapMeal(2);

        await untilVisible(`${MEAL_LINE}-refusal-channel_unavailable`);
        // No price to show, and an em dash rather than a confident zero.
        expect(screen.getByTestId(`${MEAL_LINE}-total`)).toHaveTextContent('—');
        expect(screen.getByTestId(SUBMIT)).toBeDisabled();
    });
});

describe('sale — a counter sale', () => {
    it('places it with its payment, then clears the ticket for the next customer', async () => {
        const placeSale = jest.fn(async () => placedOrder());
        await renderSale({ placeSale });
        await tapMeal(2);
        await waitFor(() => {
            expect(screen.getByTestId(SUBMIT)).toBeEnabled();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(SUBMIT));
        });

        await untilVisible('kitchen-order-desk-sale-sold');
        expect(placeSale).toHaveBeenCalledWith({
            fulfilmentType: 'counter',
            lines: [
                { catalogueItemId: String(MEAL_ID), catalogueItemVariantId: null, quantity: '2' },
            ],
            paymentMethod: 'cash_at_counter',
            // Required on a counter sale; the wire is a 422 without it.
            payment: { method: 'cash_at_counter' },
        });
        expect(
            within(screen.getByTestId('kitchen-order-desk-sale-sold')).getByText(/H360-2026-0500/),
        ).toBeTruthy();
        // The order is already fulfilled, so there is no queue to send anybody to.
        expect(mockReplace).not.toHaveBeenCalled();
        expect(screen.getByTestId('kitchen-order-desk-sale-ticket-empty')).toBeTruthy();
    });

    it('holds a WISH payment until the transfer reference is written down', async () => {
        const placeSale = jest.fn(async () => placedOrder());
        await renderSale({ placeSale });
        await tapMeal();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-method-wish'));
        });
        expect(screen.getByTestId(SUBMIT)).toBeDisabled();
        expect(screen.getByTestId('kitchen-order-desk-sale-shortfall')).toHaveTextContent(
            'Write down the transfer reference to take a Whish payment.',
        );

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-reference-input'),
                'WSH-4471',
            );
        });
        await waitFor(() => {
            expect(screen.getByTestId(SUBMIT)).toBeEnabled();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(SUBMIT));
        });
        await untilVisible('kitchen-order-desk-sale-sold');
        expect(placeSale).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'wish',
                payment: { method: 'wish', reference: 'WSH-4471' },
            }),
        );
    });

    it('lists every reason a placement was refused, and never retries', async () => {
        const placeSale = jest.fn(async (): Promise<KitchenOrder> => {
            throw new ApiError({
                ...apiFailure('server'),
                code: 'order.placement_refused',
                message: 'This order could not be placed.',
                reasons: [
                    { reason: 'cut_off_passed', context: { cut_off_at: '11:00' } },
                    { reason: 'channel_unavailable', context: {} },
                ],
            });
        });
        await renderSale({ placeSale });
        await tapMeal();
        await waitFor(() => {
            expect(screen.getByTestId(SUBMIT)).toBeEnabled();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(SUBMIT));
        });

        await untilVisible('kitchen-order-desk-sale-refusal');
        expect(screen.getByTestId('kitchen-order-desk-sale-refusal-cut_off_passed')).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-order-desk-sale-refusal-channel_unavailable'),
        ).toBeTruthy();
        // The ticket is still there, nothing sold and nothing auto-retried.
        expect(screen.getByTestId(MEAL_LINE)).toBeTruthy();
        expect(placeSale).toHaveBeenCalledTimes(1);
    });
});

describe('sale — collections and deliveries', () => {
    it('opens the customer card for a collection and holds the order until one is chosen', async () => {
        await renderSale({
            quoteSale: async (request) =>
                quoteFor(request, {
                    orderRefusals:
                        request.fulfilmentType !== 'counter' &&
                        request.customerAccountId === undefined
                            ? [{ reason: 'customer_required', context: {} }]
                            : [],
                }),
        });
        expect(screen.queryByTestId('kitchen-order-desk-sale-customer')).toBeNull();

        await chooseKind('pickup');
        await untilVisible('kitchen-order-desk-sale-customer');
        // A collection has nowhere to go.
        expect(screen.queryByTestId('kitchen-order-desk-sale-address')).toBeNull();

        await tapMeal();
        expect(screen.getByTestId(SUBMIT)).toBeDisabled();
        expect(screen.getByTestId('kitchen-order-desk-sale-shortfall')).toHaveTextContent(
            'Choose the customer to place this order.',
        );
        // The order-level refusal is listed while the rest is still totalled.
        await untilVisible('kitchen-order-desk-sale-order-refusal-customer_required');
        expect(screen.getByTestId('kitchen-order-desk-sale-total')).toHaveTextContent('AED 32.00');
    });

    it('places a collection for the chosen customer, with no payment block, and returns to the queue', async () => {
        const placeSale = jest.fn(async () =>
            placedOrder({ fulfilmentType: 'pickup', status: 'confirmed' }),
        );
        await renderSale({ placeSale });
        await chooseKind('pickup');
        await untilVisible('kitchen-order-desk-sale-customer');
        await chooseLayla();

        // The card folds to the one line it answered.
        await untilVisible('kitchen-order-desk-sale-customer-chosen');
        expect(screen.getByTestId('kitchen-order-desk-sale-customer-chosen')).toHaveTextContent(
            /Layla Haddad/,
        );

        await tapMeal();
        await waitFor(() => {
            expect(screen.getByTestId(SUBMIT)).toBeEnabled();
        });
        expect(screen.getByTestId(SUBMIT)).toHaveTextContent('Place order · AED 32.00');

        await act(async () => {
            fireEvent.press(screen.getByTestId(SUBMIT));
        });

        await waitFor(() => {
            expect(mockReplace).toHaveBeenCalledWith('/kitchen/order-desk');
        });
        // Forbidden on a collection: the wire is a 422 with it.
        expect(placeSale).toHaveBeenCalledWith({
            fulfilmentType: 'pickup',
            lines: [
                { catalogueItemId: String(MEAL_ID), catalogueItemVariantId: null, quantity: '1' },
            ],
            paymentMethod: 'cash_at_counter',
            customerAccountId: ACCOUNT_ID,
        });
    });

    it('opens the address card for a delivery and asks for it once the customer is known', async () => {
        await renderSale();
        await chooseKind('delivery');
        await untilVisible('kitchen-order-desk-sale-customer');
        await untilVisible('kitchen-order-desk-sale-address');
        // Cash at the counter is not a thing that can happen to a delivery.
        expect(screen.getByTestId('kitchen-order-desk-sale-method-cash_on_delivery')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-order-desk-sale-method-cash_at_counter')).toBeNull();

        await tapMeal();
        expect(screen.getByTestId('kitchen-order-desk-sale-shortfall')).toHaveTextContent(
            'Choose the customer to place this order.',
        );

        await chooseLayla();
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-sale-shortfall')).toHaveTextContent(
                'Save the delivery address to place this order.',
            );
        });
        expect(screen.getByTestId(SUBMIT)).toBeDisabled();
    });

    it('drops the customer and closes both cards when the sale goes back to the counter', async () => {
        await renderSale();
        await chooseKind('delivery');
        await untilVisible('kitchen-order-desk-sale-customer');
        await chooseLayla();
        await tapMeal();

        await chooseKind('counter');

        expect(screen.queryByTestId('kitchen-order-desk-sale-customer')).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-sale-address')).toBeNull();
        // The same food is being sold either way, so the ticket stays.
        expect(screen.getByTestId(MEAL_LINE)).toBeTruthy();
    });

    it('never spends a request on a customer search shorter than the server accepts', async () => {
        const { repositories } = await renderSale();
        await chooseKind('pickup');
        await untilVisible('kitchen-order-desk-sale-customer');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-customer-search-input'),
                'La',
            );
        });
        await settle();

        // A hint, not an error, and no 422 spent finding out.
        await untilVisible('kitchen-order-desk-sale-customer-too-short');
        expect(repositories.orderDesk.searchCustomers).not.toHaveBeenCalled();
    });

    it('surfaces possible duplicates as a warning with a way to use the other record', async () => {
        const other = customer({ id: 'test-0000-account-002', displayName: 'L. Haddad' });
        await renderSale({
            createCustomer: async () => ({
                customer: customer({ id: 'test-0000-account-003' }),
                possibleDuplicates: [other],
            }),
        });
        await chooseKind('pickup');
        await untilVisible('kitchen-order-desk-sale-customer');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-customer-new'));
        });
        await untilVisible('kitchen-order-desk-sale-customer-form');
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-customer-name-input'),
                'Layla Haddad',
            );
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-customer-phone-input'),
                '+9613000111',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-customer-create'));
        });

        // A warning, never a refusal — a household genuinely shares a telephone — held open so it
        // is read, with the other record one press away.
        await untilVisible('kitchen-order-desk-sale-customer-duplicates');
        expect(
            screen.getByTestId(`kitchen-order-desk-sale-customer-duplicate-${other.id}-choose`),
        ).toBeTruthy();
        // The new customer was chosen straight away, so the ticket no longer asks for one.
        await tapMeal();
        expect(screen.queryByTestId('kitchen-order-desk-sale-shortfall')).toBeNull();
    });
});
