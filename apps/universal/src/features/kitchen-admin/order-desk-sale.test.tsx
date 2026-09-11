import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    CursorPage,
    KitchenOrder,
    MealAdmin,
    OrderDeskCustomer,
    OrderDeskCustomerCreated,
    OrderDeskQuote,
    OrderDeskSaleRequest,
    PlaceOrderDeskSaleRequest,
    ProductAdmin,
} from '@healthy360/api-client/contracts';
import {
    AllergenCode,
    KitchenId,
    MealId,
    OrderId,
    ProductId,
    ServiceAreaId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

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
 * The sale wizard, against repositories this file writes.
 *
 * The step machine and the basket are proved in `order-desk-sale-model.test.ts`; what is asserted
 * here is the part only a rendered wizard can answer — that the ladder each fulfilment type produces
 * is the one the agent actually walks, that a counter sale ends in a completed state rather than a
 * redirect to a queue the order is not in, and that a refusal is rendered as reasons rather than as
 * one sentence with nothing to act on.
 *
 * `latencyMs` is left at the harness default so the loading frames stay observable, and every
 * `fireEvent` that changes a debounced value is wrapped in `act` with the timers advanced, because
 * the quote and the search both wait 300 ms before asking anything.
 */

const MEAL_ID = MealId.unsafe('test-0000-meal-0001');
const PRODUCT_ID = ProductId.unsafe('test-0000-prod-0001');
const KITCHEN_ID = KitchenId.unsafe('test-0000-kitchen-01');
const ACCOUNT_ID = 'test-0000-account-001';
const ADDRESS_ID = 'test-0000-address-001';
const AREA_ID = 'test-0000-area-0001';

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
        portionFactor: 1,
        mealTypes: ['lunch'],
        dietClassifications: [],
        allergens: [AllergenCode.parse('gluten')],
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
        name: { en: 'Cold brew', ar: 'قهوة باردة' },
        description: { en: 'A bottle of it.', ar: 'زجاجة منه.' },
        categoryId: null,
        categoryCode: 'drinks',
        itemType: 'product',
        reference: null,
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KITCHEN_ID,
        isMarketPriced: false,
        isAssorted: false,
        packVariants: [],
        channelAvailability: [],
        recipeId: null,
        dietClassifications: [],
        dataQualityFlags: [],
    };
}

function quote(overrides: Partial<OrderDeskQuote> = {}): OrderDeskQuote {
    return {
        lines: [
            {
                catalogueItemId: String(MEAL_ID),
                catalogueItemVariantId: null,
                quantity: '1',
                nameEn: 'Mujaddara bowl',
                nameAr: 'مجدرة',
                unitPriceMinor: 3_200,
                lineTotalMinor: 3_200,
                currencyCode: 'AED',
                refusals: [],
            },
        ],
        subtotalMinor: 3_200,
        deliveryFeeMinor: null,
        totalMinor: 3_200,
        currencyCode: 'AED',
        refusals: [],
        quotable: true,
        ...overrides,
    };
}

function placedOrder(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
    return {
        id: OrderId.unsafe('test-0000-order-0001'),
        orderNumber: 'H360-2026-0500',
        branchId: null,
        status: 'fulfilled',
        currencyCode: 'AED',
        subtotalMinor: 3_200,
        deliveryFeeMinor: null,
        totalMinor: 3_200,
        paymentMethod: 'cash_at_counter',
        // A walk-in: the wizard's own starting shape, and the one whose order comes back already
        // fulfilled — which is what the completed step asserts about.
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

interface DeskStubs {
    readonly quoteSale?: (request: OrderDeskSaleRequest) => Promise<OrderDeskQuote>;
    readonly placeSale?: (request: PlaceOrderDeskSaleRequest) => Promise<KitchenOrder>;
    readonly searchCustomers?: (query: string) => Promise<{
        readonly rows: readonly OrderDeskCustomer[];
        readonly limit: number;
    }>;
    readonly createCustomer?: () => Promise<OrderDeskCustomerCreated>;
    readonly addCustomerAddress?: () => Promise<{
        readonly id: string;
        readonly label: string | null;
        readonly lineOne: string;
        readonly lineTwo: string | null;
        readonly deliveryAreaId: string;
        readonly isDeliverable: boolean;
    }>;
}

async function renderSale(stubs: DeskStubs = {}) {
    return renderStubScreen(<OrderDeskSaleScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenAdmin: {
                listMeals: async () => pageOf([adminMeal()]),
                listProducts: async () => pageOf([adminProduct()]),
                listServiceAreas: async () =>
                    pageOf([
                        {
                            id: ServiceAreaId.unsafe(AREA_ID),
                            name: { en: 'Hamra', ar: 'الحمرا' },
                            countryCode: 'AE',
                            parentName: { en: 'Beirut', ar: 'بيروت' },
                            isActive: true,
                        },
                    ]),
            },
            orderDesk: {
                quoteSale: async () => quote(),
                placeSale: async () => placedOrder(),
                searchCustomers: async () => ({ rows: [customer()], limit: 20 }),
                createCustomer: async () => ({
                    customer: customer(),
                    possibleDuplicates: [],
                }),
                addCustomerAddress: async () => ({
                    id: ADDRESS_ID,
                    label: 'Home',
                    lineOne: 'Villa 12',
                    lineTwo: null,
                    deliveryAreaId: AREA_ID,
                    isDeliverable: true,
                }),
                ...stubs,
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

/** Adds the seeded meal and waits for the debounced quote to land against it. */
async function addMealAndQuote() {
    await untilVisible('kitchen-order-desk-sale-picker-rows');
    await act(async () => {
        fireEvent.press(
            screen.getByTestId(`kitchen-order-desk-sale-picker-${String(MEAL_ID)}-add`),
        );
    });
    // The quote waits 300 ms before it asks anything.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await untilVisible('kitchen-order-desk-sale-basket-totals-total');
}

beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
});

describe('sale wizard — the ladder each sale walks', () => {
    it('starts on the type step with counter chosen and four steps to walk', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');

        // The shortest sale, pre-selected but never assumed — the step is explicit.
        expect(screen.getByTestId('kitchen-order-desk-sale-stepper')).toBeTruthy();
        expect(screen.getByTestId('kitchen-order-desk-sale-position')).toHaveTextContent(
            'Step 1 of 4',
        );
        // Back is a dead end on the first step, and it says so rather than disappearing.
        expect(screen.getByTestId('kitchen-order-desk-sale-back')).toBeDisabled();
    });

    it('skips customer and address for a counter sale, going straight to the basket', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));

        await untilVisible('kitchen-order-desk-sale-basket');
        expect(screen.queryByTestId('kitchen-order-desk-sale-customer')).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-sale-address')).toBeNull();
    });

    it('inserts customer and address once the sale becomes a delivery', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-type-delivery'));
        });

        await waitFor(() => {
            // Five steps now, not four.
            expect(screen.getByTestId('kitchen-order-desk-sale-position')).toHaveTextContent(
                'Step 1 of 5',
            );
        });

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-customer');
        // Nothing chosen yet, so the wizard will not move on.
        expect(screen.getByTestId('kitchen-order-desk-sale-next')).toBeDisabled();
    });

    it('holds the basket step shut until the quote says the sale is possible', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-basket');

        // An empty basket has no total and no way forward.
        expect(screen.getByTestId('kitchen-order-desk-sale-next')).toBeDisabled();
        expect(screen.getByTestId('kitchen-order-desk-sale-basket-empty')).toBeTruthy();

        await addMealAndQuote();

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-sale-next')).not.toBeDisabled();
        });
    });
});

describe('sale wizard — the quote is the only price', () => {
    it('renders the line total and the order total from the quote, and no fee when there is none', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();

        expect(
            screen.getByTestId(`kitchen-order-desk-sale-line-${String(MEAL_ID)}-total`),
        ).toHaveTextContent('AED 32.00');
        expect(screen.getByTestId('kitchen-order-desk-sale-basket-totals-total')).toHaveTextContent(
            'AED 32.00',
        );
        // Null is not zero: a counter sale has no delivery fee at all, and printing 0.00 would
        // invent a line the order does not have.
        expect(screen.queryByTestId('kitchen-order-desk-sale-basket-totals-fee')).toBeNull();
    });

    it('sends the basket to the quote once, debounced, rather than per tap', async () => {
        const { repositories } = await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-picker-rows');

        for (let tap = 0; tap < 3; tap += 1) {
            // Each tap in its own `act`: batching all three onto one commit would have them all
            // read the same stale basket, which is not what a finger does.
            await act(async () => {
                fireEvent.press(
                    screen.getByTestId(`kitchen-order-desk-sale-picker-${String(MEAL_ID)}-add`),
                );
            });
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
        });
        await untilVisible('kitchen-order-desk-sale-basket-totals-total');

        // Three taps of the same article are one line of three, priced once.
        expect(repositories.orderDesk.quoteSale).toHaveBeenCalledTimes(1);
        expect(repositories.orderDesk.quoteSale).toHaveBeenCalledWith({
            fulfilmentType: 'counter',
            lines: [
                { catalogueItemId: String(MEAL_ID), catalogueItemVariantId: null, quantity: '3' },
            ],
        });
    });

    it('renders a line refusal against its own line and refuses to move on', async () => {
        await renderSale({
            quoteSale: async () =>
                quote({
                    lines: [
                        {
                            catalogueItemId: String(MEAL_ID),
                            catalogueItemVariantId: null,
                            quantity: '1',
                            nameEn: 'Mujaddara bowl',
                            nameAr: 'مجدرة',
                            // Null together — a refused line has no price, and a zero reads as free.
                            unitPriceMinor: null,
                            lineTotalMinor: null,
                            currencyCode: 'AED',
                            refusals: [{ reason: 'channel_unavailable', context: {} }],
                        },
                    ],
                    subtotalMinor: 0,
                    totalMinor: 0,
                    quotable: false,
                }),
        });
        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();

        expect(
            screen.getByTestId(`kitchen-order-desk-sale-line-${String(MEAL_ID)}-refusals`),
        ).toHaveTextContent(
            'That article is not offered at the counter. Publish it to the desk channel first.',
        );
        // No price to show, and an em dash rather than a confident zero.
        expect(
            screen.getByTestId(`kitchen-order-desk-sale-line-${String(MEAL_ID)}-total`),
        ).toHaveTextContent('—');
        expect(screen.getByTestId('kitchen-order-desk-sale-next')).toBeDisabled();
    });

    it('lists order-level refusals above the total while still showing what the rest comes to', async () => {
        await renderSale({
            quoteSale: async () =>
                quote({
                    refusals: [{ reason: 'customer_required', context: {} }],
                    quotable: false,
                }),
        });
        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();

        expect(
            screen.getByTestId('kitchen-order-desk-sale-basket-totals-refusal-customer_required'),
        ).toBeTruthy();
        // The total is still offered — "drop the soup and it comes to…" is the agent's next
        // sentence.
        expect(screen.getByTestId('kitchen-order-desk-sale-basket-totals-total')).toHaveTextContent(
            'AED 32.00',
        );
    });
});

describe('sale wizard — a counter sale, end to end', () => {
    it('sends the payment block, and lands on a completed state rather than the queue', async () => {
        const { repositories } = await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-payment');

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-review');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-submit'));
        });

        await untilVisible('kitchen-order-desk-sale-completed');

        expect(repositories.orderDesk.placeSale).toHaveBeenCalledWith({
            fulfilmentType: 'counter',
            lines: [
                { catalogueItemId: String(MEAL_ID), catalogueItemVariantId: null, quantity: '1' },
            ],
            paymentMethod: 'cash_at_counter',
            // Required on a counter sale; the wire is a 422 without it.
            payment: { method: 'cash_at_counter' },
        });

        // The order is already fulfilled, so there is no queue to send anybody to.
        expect(mockReplace).not.toHaveBeenCalled();
        expect(
            screen.getByTestId('kitchen-order-desk-sale-completed-state-title'),
        ).toHaveTextContent('Order H360-2026-0500');
        expect(screen.getByTestId('kitchen-order-desk-sale-completed-status')).toBeTruthy();
    });

    it('starts over from an empty basket when the agent asks for another sale', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-payment');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-review');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-submit'));
        });
        await untilVisible('kitchen-order-desk-sale-completed');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-completed-new'));
        });

        await untilVisible('kitchen-order-desk-sale-type');
        expect(screen.getByTestId('kitchen-order-desk-sale-position')).toHaveTextContent(
            'Step 1 of 4',
        );
    });

    it('demands a transfer reference before a WISH sale may be completed', async () => {
        await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-payment');

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-payment-method-wish'));

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-sale-payment-wish-note')).toBeTruthy();
        });
        // The agent is asserting they saw the money arrive; an assertion nobody can check later is
        // worth nothing, so the reference is this wizard's own requirement.
        expect(screen.getByTestId('kitchen-order-desk-sale-next')).toBeDisabled();

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-payment-reference-input'),
                'WSH-4471',
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-sale-next')).not.toBeDisabled();
        });
    });
});

describe('sale wizard — refusals and failures', () => {
    it('lists every reason a placement was refused, and never retries', async () => {
        await renderSale({
            placeSale: async () => {
                throw new ApiError({
                    ...apiFailure('server'),
                    code: 'order.placement_refused',
                    message: 'This order could not be placed.',
                    reasons: [
                        { reason: 'cut_off_passed', context: { cut_off_at: '11:00' } },
                        { reason: 'channel_unavailable', context: {} },
                    ],
                });
            },
        });

        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await addMealAndQuote();
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-payment');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        await untilVisible('kitchen-order-desk-sale-review');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-submit'));
        });

        await untilVisible('kitchen-order-desk-sale-refusal');
        // Every reason, not the first: one sentence would send the agent back with nothing to
        // change.
        expect(screen.getByTestId('kitchen-order-desk-sale-refusal-cut_off_passed')).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-order-desk-sale-refusal-channel_unavailable'),
        ).toBeTruthy();
        // Still on the review step, with nothing sold and nothing auto-retried.
        expect(screen.getByTestId('kitchen-order-desk-sale-review')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-order-desk-sale-completed')).toBeNull();
    });

    it('shows the picker failure with a retry rather than an empty menu', async () => {
        await renderStubScreen(<OrderDeskSaleScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    // What a dedicated `order_desk_agent` actually gets: the role holds no
                    // `catalogue.view_organisation`.
                    listMeals: async () => {
                        throw new ApiError(apiFailure('server'));
                    },
                    listProducts: async () => pageOf([]),
                },
                orderDesk: { quoteSale: async () => quote() },
            },
        });

        await untilVisible('kitchen-order-desk-sale-type');
        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));

        await untilVisible('kitchen-order-desk-sale-picker-error');
        expect(screen.queryByTestId('kitchen-order-desk-sale-picker-rows')).toBeNull();
    });
});

describe('sale wizard — the customer step', () => {
    it('never spends a request on a query shorter than the server accepts', async () => {
        const { repositories } = await renderSale();
        await untilVisible('kitchen-order-desk-sale-type');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-type-pickup'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        });
        await untilVisible('kitchen-order-desk-sale-customer');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-customer-search-input'),
                'La',
            );
            await new Promise((resolve) => setTimeout(resolve, 400));
        });

        // A hint, not an error, and no 422 spent finding out.
        await untilVisible('kitchen-order-desk-sale-customer-too-short');
        expect(repositories.orderDesk.searchCustomers).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-order-desk-sale-customer-search-input'),
                'Layla',
            );
            await new Promise((resolve) => setTimeout(resolve, 400));
        });

        await waitFor(() => {
            expect(repositories.orderDesk.searchCustomers).toHaveBeenCalledWith('Layla');
        });
        await untilVisible(`kitchen-order-desk-sale-customer-${ACCOUNT_ID}-choose`);
    });

    it('surfaces possible duplicates as a warning with a way to use the other record', async () => {
        const other = customer({ id: 'test-0000-account-002', displayName: 'L. Haddad' });

        await renderSale({
            createCustomer: async () => ({
                customer: customer({ id: 'test-0000-account-003' }),
                possibleDuplicates: [other],
            }),
        });

        await untilVisible('kitchen-order-desk-sale-type');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-type-pickup'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-next'));
        });
        await untilVisible('kitchen-order-desk-sale-customer');

        fireEvent.press(screen.getByTestId('kitchen-order-desk-sale-customer-new'));
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

        await untilVisible('kitchen-order-desk-sale-customer-duplicates');
        // A warning, never a refusal — a household genuinely shares a telephone — and the other
        // record is one press away.
        expect(
            screen.getByTestId(`kitchen-order-desk-sale-customer-duplicate-${other.id}-choose`),
        ).toBeTruthy();
        // The new customer was chosen straight away, so the step is already satisfied.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-sale-next')).not.toBeDisabled();
        });
    });
});
