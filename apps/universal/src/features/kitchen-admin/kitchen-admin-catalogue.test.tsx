import {
    apiFailure,
    conflictFailure,
    throwFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    ChannelAvailability,
    CursorPage,
    MealAdmin,
    MealAdminFilter,
    ProductAdmin,
    ProductAdminFilter,
    ProductPackVariant,
    RecipeAdminSummary,
} from '@healthy360/api-client/contracts';
import { AllergenCode, KitchenId, MealId, ProductId, RoleId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions } from 'react-native';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { availabilityErrors, packErrors } from './catalogue-row-editors.tsx';
import type { AvailabilityDraft, PackDraft } from './catalogue-row-editors.tsx';
import {
    availableChannels,
    defaultPackVariant,
    parseClockTime,
    parseWholeNumber,
} from './format.ts';
import { MealEditScreen } from './screens/meal-edit-screen.tsx';
import { MealsScreen } from './screens/meals-screen.tsx';
import { ProductEditScreen } from './screens/product-edit-screen.tsx';
import { ProductsScreen } from './screens/products-screen.tsx';

/**
 * The product and meal half of the kitchen workspace, against a world this file declares.
 *
 * Nothing here stubs a hook: the screens still run through `Repositories`, the interface production
 * speaks. What changed with the mock world's removal is where the records come from — every product,
 * pack, meal, availability day and rejection below is authored here and handed to
 * `renderStubScreen`, so "two packs" is a statement about what this test wrote.
 *
 * Five things this file exists to prove:
 *
 * 1. **Both lists tell the truth about what they cannot do.** A product has no publish action on
 *    this contract, so no row offers one; a meal has no archive, because retiring *is* the archive.
 * 2. **The pack editor keeps the row-editor promises.** Add, remove, undo to the row's own position,
 *    and a save that is refused — with the reason on the offending row — rather than silently
 *    writing a duplicate code that would orphan a price.
 * 3. **Channel and availability writes are their own acts.** Each has its own save, each lands
 *    through its own contract method carrying the version it was based on, and each is read back
 *    from the record the write answered with.
 * 4. **Publishing a meal is a gate with a consequence stated in front of it.** The dialog names the
 *    label about to go public, the write carries the lock version, and the editor only claims public
 *    visibility once the server has answered `published`.
 * 5. **The confidential field is confidential by construction.** The margin renders in the admin
 *    editor, labelled, and `null` renders as an honest refusal rather than a fabricated zero.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace,
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/products',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

/** Waits for an element, with the contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 *
 * Every builder is typed against its contract shape, so a contract that grows a required field fails
 * the typecheck here rather than producing a record the screen cannot render. Identifiers are
 * UUIDv7-shaped because both editors parse their route parameter with `…Id.safeParse`.
 * ---------------------------------------------------------------------------------------------- */

const TEST_KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');

function productIdentifier(ordinal: number): ProductId {
    return ProductId.unsafe(`01935f6d-0000-7000-8000-0000000d000${String(ordinal)}`);
}

function mealIdentifier(ordinal: number): MealId {
    return MealId.unsafe(`01935f6d-0000-7000-8000-0000000f000${String(ordinal)}`);
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function packVariant(
    code: string,
    overrides: Partial<ProductPackVariant> = {},
): ProductPackVariant {
    return {
        code,
        label: { en: code, ar: code },
        netQuantity: 250,
        netUnit: 'g',
        unitsPerPack: 1,
        ...overrides,
    };
}

function channel(name: ChannelAvailability['channel'], isAvailable: boolean): ChannelAvailability {
    return { channel: name, isAvailable, availableFrom: null, availableUntil: null };
}

interface ProductSeed {
    readonly ordinal: number;
    readonly name?: string;
    readonly overrides?: Partial<ProductAdmin>;
}

/** A product carrying more than one pack and at least one channel — the shape both halves need. */
function product({ ordinal, name, overrides = {} }: ProductSeed): ProductAdmin {
    const label = name ?? `Product ${String(ordinal)}`;
    return {
        id: productIdentifier(ordinal),
        meta: meta(),
        name: { en: label, ar: `${label} بالعربية` },
        description: { en: 'A jar of it.', ar: 'برطمان منه.' },
        categoryCode: 'store-cupboard',
        itemType: 'product',
        reference: null,
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: TEST_KITCHEN_ID,
        isMarketPriced: false,
        isAssorted: false,
        packVariants: [
            packVariant('JAR', { label: { en: 'Jar', ar: 'برطمان' } }),
            packVariant('TRAY', {
                label: { en: 'Tray', ar: 'صينية' },
                netQuantity: 3000,
                unitsPerPack: 12,
            }),
        ],
        channelAvailability: [channel('b2c', true), channel('b2b', false)],
        recipeId: null,
        dietClassifications: [],
        dataQualityFlags: [],
        ...overrides,
    };
}

interface MealSeed {
    readonly ordinal: number;
    readonly name?: string;
    readonly overrides?: Partial<MealAdmin>;
}

/** A meal complete enough to publish: both languages on both fields, and a meal type. */
function meal({ ordinal, name, overrides = {} }: MealSeed): MealAdmin {
    const label = name ?? `Meal ${String(ordinal)}`;
    return {
        id: mealIdentifier(ordinal),
        meta: meta(),
        name: { en: label, ar: `${label} بالعربية` },
        description: { en: 'Served warm.', ar: 'يُقدَّم دافئًا.' },
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: TEST_KITCHEN_ID,
        recipeId: null,
        recipeVersionId: null,
        portionFactor: 1,
        mealTypes: ['lunch'],
        dietClassifications: [],
        allergens: [AllergenCode.parse('gluten')],
        channelAvailability: [channel('b2c', true)],
        availability: [],
        imagePlaceholderId: 'placeholder-1',
        marginPercent: 42,
        ...overrides,
    };
}

function productListing(
    read: () => readonly ProductAdmin[],
): (filter?: ProductAdminFilter) => Promise<CursorPage<ProductAdmin>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';
        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (needle === '' ||
                        row.name.en.toLocaleLowerCase().includes(needle) ||
                        row.name.ar.includes(needle)),
            ),
        );
    };
}

function mealListing(
    read: () => readonly MealAdmin[],
): (filter?: MealAdminFilter) => Promise<CursorPage<MealAdmin>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';
        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (needle === '' ||
                        row.name.en.toLocaleLowerCase().includes(needle) ||
                        row.name.ar.includes(needle)),
            ),
        );
    };
}

/** The recipe picker's vocabulary. Empty is legal — "bought in rather than cooked" is an answer. */
const NO_RECIPES: readonly RecipeAdminSummary[] = [];

/** An organisation owner: an organisation, a branch, and no catalogue permission at all. */
function organisationOwnerSession() {
    return testMeResponse({
        memberships: [
            testMembership({
                organisation: testOrganisation({
                    name: 'Cedar Clinic',
                    slug: 'cedar-clinic',
                    type: 'clinic',
                }),
                roles: [
                    {
                        id: RoleId.unsafe('test-0000-role-0002'),
                        key: 'organisation_owner',
                        name: 'Owner',
                    },
                ],
            }),
        ],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

/* ------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

function pack(overrides: Partial<PackDraft>): PackDraft {
    return {
        key: 'a',
        code: 'SINGLE',
        label: { en: 'Single', ar: 'مفردة' },
        netQuantity: '250',
        netUnit: 'g',
        unitsPerPack: '1',
        ...overrides,
    };
}

function day(overrides: Partial<AvailabilityDraft>): AvailabilityDraft {
    return {
        key: 'a',
        date: '2026-08-12',
        isAvailable: true,
        remaining: '',
        orderCutOffAt: '',
        ...overrides,
    };
}

const PACK_MESSAGES = {
    codeRequired: 'code required',
    codeDuplicate: 'code duplicate',
    quantityInvalid: 'quantity invalid',
    unitsInvalid: 'units invalid',
};

const DAY_MESSAGES = {
    dateRequired: 'date required',
    dateDuplicate: 'date duplicate',
    remainingInvalid: 'remaining invalid',
    cutOffInvalid: 'cut-off invalid',
};

describe('catalogue display helpers', () => {
    it('reads a whole count and refuses a fraction of one', () => {
        expect(parseWholeNumber('12')).toBe(12);
        expect(parseWholeNumber('0')).toBe(0);
        expect(parseWholeNumber('')).toBeNull();
        expect(parseWholeNumber('2.5')).toBeNull();
        expect(parseWholeNumber('-1')).toBeNull();
    });

    it('reads a branch-local cut-off and normalises the hour', () => {
        expect(parseClockTime('18:00')).toBe('18:00');
        expect(parseClockTime('9:30')).toBe('09:30');
        expect(parseClockTime('24:00')).toBeNull();
        expect(parseClockTime('18:60')).toBeNull();
        expect(parseClockTime('six')).toBeNull();
    });

    it('calls the first pack the default one, because position is the only ordering there is', () => {
        const packs = product({ ordinal: 1 }).packVariants;
        expect(defaultPackVariant([])).toBeNull();
        expect(defaultPackVariant(packs)?.code).toBe(packs[0]!.code);
        expect(defaultPackVariant(packs)?.code).toBe('JAR');
    });

    it('reports only the channels a record is actually available on', () => {
        expect(
            availableChannels([
                { channel: 'b2c', isAvailable: true },
                { channel: 'b2b', isAvailable: false },
            ]),
        ).toEqual(['b2c']);
    });

    it('refuses a pack with no code, a duplicate code or an impossible measure', () => {
        expect(packErrors([pack({ code: '  ' })], PACK_MESSAGES).get('a')).toBe('code required');

        const duplicates = packErrors(
            [pack({ key: 'a', code: 'TRAY' }), pack({ key: 'b', code: 'tray' })],
            PACK_MESSAGES,
        );
        expect(duplicates.get('a')).toBeUndefined();
        expect(duplicates.get('b')).toBe('code duplicate');

        expect(packErrors([pack({ netQuantity: '0' })], PACK_MESSAGES).get('a')).toBe(
            'quantity invalid',
        );
        expect(packErrors([pack({ unitsPerPack: '0' })], PACK_MESSAGES).get('a')).toBe(
            'units invalid',
        );
        expect(packErrors([pack({})], PACK_MESSAGES).size).toBe(0);
    });

    it('refuses two answers about one calendar day, and an unparseable count or cut-off', () => {
        expect(availabilityErrors([day({ date: null })], DAY_MESSAGES).get('a')).toBe(
            'date required',
        );

        const duplicates = availabilityErrors([day({ key: 'a' }), day({ key: 'b' })], DAY_MESSAGES);
        expect(duplicates.get('b')).toBe('date duplicate');

        expect(availabilityErrors([day({ remaining: 'lots' })], DAY_MESSAGES).get('a')).toBe(
            'remaining invalid',
        );
        expect(availabilityErrors([day({ orderCutOffAt: 'evening' })], DAY_MESSAGES).get('a')).toBe(
            'cut-off invalid',
        );
        // Blank is `null` on the wire, not zero and not midnight — both are legal.
        expect(availabilityErrors([day({})], DAY_MESSAGES).size).toBe(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The product list
 * ---------------------------------------------------------------------------------------------- */

/**
 * Both lists are desk surfaces, and above `md` the Catalogue draws a record as tracks rather than
 * as the two-line row it falls back to below it (§4.1). The two are different trees with different
 * element counts — the branch is JavaScript, not a class variant — so a column assertion is only
 * meaningful once the window is wide enough to draw columns.
 *
 * `Dimensions.set` rather than a mocked `useBreakpoint`: the branch reads the real window, and a
 * test that stubbed the hook would prove the stub. React Native's Jest default window is 750px,
 * eighteen short of the 768 `md` asks for, which is why this is needed at all. The narrow default
 * is captured up front and put back afterwards, so the editor blocks below keep the phone shape
 * they were written against.
 */
function atDeskWidth() {
    const narrowWindow = Dimensions.get('window');
    const narrowScreen = Dimensions.get('screen');

    beforeAll(() => {
        Dimensions.set({
            window: { ...narrowWindow, width: 1440, height: 900 },
            screen: { ...narrowScreen, width: 1440, height: 900 },
        });
    });

    afterAll(() => {
        Dimensions.set({ window: narrowWindow, screen: narrowScreen });
    });
}

describe('the product list', () => {
    atDeskWidth();

    it('renders skeletons, then the authored rows with their packs, channels and status', async () => {
        const row = product({ ordinal: 1, name: 'Pomegranate molasses' });

        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: {
                kitchenAdmin: { listProducts: productListing(() => [row]) },
            },
        });

        await untilVisible('kitchen-products-loading');
        await untilVisible('kitchen-products-table');

        const base = `kitchen-product-${String(row.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-category`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-packs`)).toBeTruthy();
        // Two packs, because this test authored two.
        expect(row.packVariants).toHaveLength(2);
        expect(screen.getByTestId(`${base}-packs-count`)).toHaveTextContent(/2/);
        // One channel is on and one is off, so the cell is the list rather than its "none" fallback.
        expect(screen.getByTestId(`${base}-channels`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-channels-none`)).toBeNull();
        expect(screen.getByTestId(`${base}-status`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
    });

    it('offers no publish control, because the contract publishes none for a product', async () => {
        const row = product({ ordinal: 1 });

        await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listProducts: productListing(() => [row]) } },
        });
        await untilVisible('kitchen-products-table');

        const base = `kitchen-product-${String(row.id)}`;
        expect(screen.getByTestId(`${base}-open`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-archive`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-publish`)).toBeNull();
    });

    it('opens the four figures with two of them wired to a filter', async () => {
        await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listProducts: productListing(() => [
                        product({ ordinal: 1, name: 'Pomegranate molasses' }),
                        product({
                            ordinal: 2,
                            name: 'Tahini',
                            overrides: { meta: meta({ status: 'published' }) },
                        }),
                        product({ ordinal: 3, name: 'Sumac', overrides: { packVariants: [] } }),
                    ]),
                },
            },
        });
        await untilVisible('kitchen-products-table');

        // Three rows, one of them still draft — and one with no pack at all, which is the figure
        // this family gets in the slot the ingredient list spends on Uncosted.
        expect(screen.getByTestId('kitchen-products-stats-shown-value')).toHaveTextContent('3');
        expect(screen.getByTestId('kitchen-products-stats-draft-value')).toHaveTextContent('2');
        expect(screen.getByTestId('kitchen-products-stats-noPack-value')).toHaveTextContent('1');

        // Draft is a filter, not a read-out: pressing it narrows the list the card counts.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-products-stats-draft'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-products-stats-shown-value')).toHaveTextContent('2');
        });
    });

    it('archives a row at the version the list was showing, and says so', async () => {
        const row = product({ ordinal: 1, name: 'Pomegranate molasses' });
        const archived = { ...row, meta: meta({ status: 'retired', lockVersion: 2 }) };

        const { repositories } = await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listProducts: productListing(() => [row]),
                    archiveProduct: async () => archived,
                },
            },
        });
        await untilVisible('kitchen-products-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-product-${String(row.id)}-archive`));
        });

        await untilVisible('kitchen-products-archive-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-products-archive-confirm'));
        });

        await untilVisible('kitchen-products-archived-toast');
        // The version the row was rendered at, not one the client invented — an archive based on a
        // stale record is what optimistic locking exists to refuse.
        expect(repositories.kitchenAdmin.archiveProduct).toHaveBeenCalledWith(row.id, {
            lockVersion: row.meta.lockVersion,
        });
    });

    it('reads a record in the View panel without loading the editor', async () => {
        const row = product({ ordinal: 1, name: 'Pomegranate molasses' });

        await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listProducts: productListing(() => [row]) } },
        });
        await untilVisible('kitchen-products-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-product-${String(row.id)}-view`));
        });

        // Every field is read off the record the list already holds, so no second read is made and
        // nothing routes away from the list.
        await untilVisible('kitchen-products-view-field-defaultPack');
        expect(screen.getByTestId('kitchen-products-view-field-packs')).toHaveTextContent(/2/);
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listProducts: productListing(() => [
                        product({ ordinal: 1, name: 'Pomegranate molasses' }),
                        product({ ordinal: 2, name: 'Tahini' }),
                    ]),
                },
            },
        });
        await untilVisible('kitchen-products-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-products-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-products-empty');
        expect(screen.getByTestId('kitchen-products-clear')).toBeTruthy();
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<ProductsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listProducts: async () =>
                        throwFailure(apiFailure('server', { message: 'Boom.' })),
                },
            },
        });

        await untilVisible('kitchen-products-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        // No repository overrides at all: the gate refuses before the table can ask for anything, so
        // a screen that fetched here would fail loudly with StubNotConfiguredError.
        await renderStubScreen(<ProductsScreen />, { session: organisationOwnerSession() });

        await untilVisible('kitchen-products-forbidden');
        expect(screen.queryByTestId('kitchen-products-table')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The meal list
 * ---------------------------------------------------------------------------------------------- */

describe('the meal list', () => {
    atDeskWidth();

    it('renders skeletons, then the authored rows with their label and publication state', async () => {
        const row = meal({
            ordinal: 1,
            name: 'Freekeh bowl',
            overrides: { meta: meta({ status: 'published' }) },
        });

        await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: { kitchenAdmin: { listMeals: mealListing(() => [row]) } },
        });

        await untilVisible('kitchen-meals-loading');
        await untilVisible('kitchen-meals-table');

        const base = `kitchen-meal-${String(row.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-meal-types`)).toBeTruthy();
        // "Live", not "Published": the Catalogue's status badges take the short vocabulary every
        // one of its lists uses, so a kitchen reads the same word down every column.
        expect(screen.getByTestId(`${base}-status`)).toHaveTextContent(/Live/);
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
    });

    it('states what publication means in the View panel, where a record is read one at a time', async () => {
        const row = meal({
            ordinal: 1,
            name: 'Freekeh bowl',
            overrides: { meta: meta({ status: 'published' }) },
        });

        await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listMeals: mealListing(() => [row]) } },
        });
        await untilVisible('kitchen-meals-table');

        /*
         * The row used to carry this as a caption under its status badge. A 28px Catalogue row has
         * one line, and a sentence that reads the same on every published row is not what it is
         * worth spending — so the statement moved into the panel, and this is where it is asserted.
         */
        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-meal-${String(row.id)}-view`));
        });

        await untilVisible('kitchen-meals-view-field-visible');
        expect(screen.getByTestId('kitchen-meals-view-field-visible')).toHaveTextContent(
            /customers/i,
        );
    });

    it('offers withdraw rather than archive, because retiring is the archive here', async () => {
        const row = meal({ ordinal: 1, overrides: { meta: meta({ status: 'published' }) } });

        await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listMeals: mealListing(() => [row]) } },
        });
        await untilVisible('kitchen-meals-table');

        const base = `kitchen-meal-${String(row.id)}`;
        expect(screen.getByTestId(`${base}-retire`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-archive`)).toBeNull();
    });

    it('counts what is live, and pressing that card narrows the list to it', async () => {
        await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listMeals: mealListing(() => [
                        meal({
                            ordinal: 1,
                            name: 'Freekeh bowl',
                            overrides: { meta: meta({ status: 'published' }) },
                        }),
                        meal({ ordinal: 2, name: 'Lentil soup' }),
                    ]),
                },
            },
        });
        await untilVisible('kitchen-meals-table');

        // Live is second here rather than the ingredient list's Uncosted, because publication is
        // what this catalogue is for: one of these two dishes is on the menu right now.
        expect(screen.getByTestId('kitchen-meals-stats-live-value')).toHaveTextContent('1');
        expect(screen.getByTestId('kitchen-meals-stats-draft-value')).toHaveTextContent('1');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meals-stats-live'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-meals-stats-shown-value')).toHaveTextContent('1');
        });
    });

    it('withdraws a published meal at the version the list was showing', async () => {
        const row = meal({ ordinal: 1, overrides: { meta: meta({ status: 'published' }) } });
        const withdrawn = { ...row, meta: meta({ status: 'retired', lockVersion: 2 }) };

        const { repositories } = await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listMeals: mealListing(() => [row]),
                    retireMeal: async () => withdrawn,
                },
            },
        });
        await untilVisible('kitchen-meals-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-meal-${String(row.id)}-retire`));
        });

        await untilVisible('kitchen-meals-retire-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meals-retire-confirm'));
        });

        await untilVisible('kitchen-meals-retired-toast');
        expect(repositories.kitchenAdmin.retireMeal).toHaveBeenCalledWith(row.id, {
            lockVersion: row.meta.lockVersion,
        });
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listMeals: mealListing(() => [
                        meal({ ordinal: 1, name: 'Freekeh bowl' }),
                        meal({ ordinal: 2, name: 'Lentil soup' }),
                    ]),
                },
            },
        });
        await untilVisible('kitchen-meals-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meals-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-meals-empty');
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<MealsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listMeals: async () => throwFailure(apiFailure('server', { message: 'Boom.' })),
                },
            },
        });

        await untilVisible('kitchen-meals-error');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The product editor
 * ---------------------------------------------------------------------------------------------- */

describe('creating and editing a product', () => {
    it('creates a draft and lands on its own address', async () => {
        const created = product({ ordinal: 9, name: 'Cold-pressed pomegranate' });

        const { repositories } = await renderStubScreen(<ProductEditScreen product="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    // The category picker's vocabulary is derived from the codes already in use,
                    // so this listing is what makes `store-cupboard` an option at all.
                    listProducts: productListing(() => [product({ ordinal: 1 })]),
                    listRecipes: async () => page(NO_RECIPES),
                    createProduct: async () => created,
                },
            },
        });

        await untilVisible('kitchen-product-name-en-input');
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-product-name-en-input'),
                'Cold-pressed pomegranate',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-product-name-ar-input'),
                'رمّان معصور على البارد',
            );
        });

        // A category is required, and the derived vocabulary is what the picker offers.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-category-trigger'));
        });
        // The dialog opens at once; its options land when the library query resolves. Waiting on
        // the list alone races the 25ms stub latency under a loaded worker pool.
        await untilVisible('kitchen-product-category-option-store-cupboard');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-category-option-store-cupboard'));
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/products/${String(created.id)}`,
            );
        });

        // Exactly this request and nothing else. `CreateProductRequest` carries no status field at
        // all, and the equality is what proves the screen invents none — both halves of the
        // bilingual name travel, because the person typing is responsible for both.
        expect(repositories.kitchenAdmin.createProduct).toHaveBeenCalledWith({
            name: { en: 'Cold-pressed pomegranate', ar: 'رمّان معصور على البارد' },
            description: { en: '', ar: '' },
            categoryCode: 'store-cupboard',
            itemType: 'product',
            isMarketPriced: false,
            isAssorted: false,
            packVariants: [],
        });
    });

    it('adds a pack, undoes a removal to its own position, and refuses a duplicate code', async () => {
        const stored = product({ ordinal: 1, name: 'Pomegranate molasses' });
        const first = stored.packVariants[0]!;
        const second = stored.packVariants[1]!;

        await renderStubScreen(<ProductEditScreen product={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getProduct: async () => stored,
                    listProducts: productListing(() => [stored]),
                    listRecipes: async () => page(NO_RECIPES),
                },
            },
        });
        await untilVisible('kitchen-product-packs-add');

        const firstRow = `kitchen-product-pack-editor-row-seed-0-${first.code}`;
        const secondRow = `kitchen-product-pack-editor-row-seed-1-${second.code}`;

        expect(screen.getByTestId(`${firstRow}-default`)).toBeTruthy();
        expect(screen.queryByTestId(`${secondRow}-default`)).toBeNull();

        // Remove the first pack; the second inherits the default badge, and undo puts it back.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${firstRow}-remove`));
        });
        expect(screen.queryByTestId(firstRow)).toBeNull();
        expect(screen.getByTestId(`${secondRow}-default`)).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-pack-editor-removed-bar-undo'));
        });
        await untilVisible(`${firstRow}-default`);
        expect(screen.queryByTestId(`${secondRow}-default`)).toBeNull();

        // A duplicate code is refused on the offending row and blocks the save, because a price
        // list points at a pack by its code and two of them make the reference ambiguous.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${secondRow}-code-input`), first.code);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-product-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        expect(screen.getByTestId('kitchen-product-pack-editor-row-pack-1')).toBeTruthy();
    });

    it('saves a new pack through the record write, and the editor reads it back', async () => {
        let stored = product({ ordinal: 1, name: 'Pomegranate molasses' });

        const { repositories } = await renderStubScreen(
            <ProductEditScreen product={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getProduct: async () => stored,
                        listProducts: productListing(() => [stored]),
                        listRecipes: async () => page(NO_RECIPES),
                        // The server's rule, stated once: an accepted write answers with the record
                        // at its *next* version.
                        updateProduct: async (_id, request) => {
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                ...(request.packVariants === undefined
                                    ? {}
                                    : { packVariants: request.packVariants }),
                                meta: meta({ lockVersion: request.lockVersion + 1 }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-product-packs-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-code-input`), 'CASE24');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-quantity-input`), '6000');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-units-per-pack-input`), '24');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        // The whole pack list travels with the record write — packs are a *field* on
        // `UpdateProductRequest`, not a sub-resource — at the version the editor opened with.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateProduct).toHaveBeenCalledWith(
                stored.id,
                expect.objectContaining({
                    lockVersion: 1,
                    packVariants: expect.arrayContaining([
                        expect.objectContaining({ code: 'CASE24', unitsPerPack: 24 }),
                    ]),
                }),
            );
        });

        // …and the editor rehydrates from the answer: the saved pack comes back as a seeded row
        // rather than staying the unsaved one it was typed into.
        await untilVisible('kitchen-product-pack-editor-row-seed-2-CASE24');
        expect(screen.queryByTestId('kitchen-product-editor-screen-dirty')).toBeNull();
    });

    /**
     * A pack code is the identity a price list points at, and the code is what the server matches a
     * submitted pack to its stored row by. The editor used to upper-case every code on the way out,
     * which on a catalogue whose codes are `1-kg` renamed all of them: the stored row counted as
     * absent from the submission and was archived, a new `1-KG` was inserted beside it, and every
     * price that quoted the old one was left pointing at a withdrawn pack.
     */
    it('submits each pack under the code it is stored with, case and all', async () => {
        const stored = product({
            ordinal: 1,
            name: 'Marinated chicken breast',
            overrides: {
                packVariants: [packVariant('1-kg', { label: { en: '1 Kg', ar: '1 Kg' } })],
            },
        });

        const { repositories } = await renderStubScreen(
            <ProductEditScreen product={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getProduct: async () => stored,
                        listProducts: productListing(() => [stored]),
                        listRecipes: async () => page(NO_RECIPES),
                        updateProduct: async () => stored,
                    },
                },
            },
        );
        await untilVisible('kitchen-product-packs-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-code-input`), 'case-24');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-quantity-input`), '6000');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateProduct).toHaveBeenCalledWith(
                stored.id,
                expect.objectContaining({
                    packVariants: [
                        expect.objectContaining({ code: '1-kg' }),
                        expect.objectContaining({ code: 'case-24' }),
                    ],
                }),
            );
        });
    });

    it('persists a channel toggle through its own contract method', async () => {
        let stored = product({ ordinal: 1, name: 'Pomegranate molasses' });

        const { repositories } = await renderStubScreen(
            <ProductEditScreen product={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getProduct: async () => stored,
                        listProducts: productListing(() => [stored]),
                        listRecipes: async () => page(NO_RECIPES),
                        setProductChannelAvailability: async (_id, request) => {
                            stored = {
                                ...stored,
                                channelAvailability: request.availability,
                                meta: meta({ lockVersion: request.lockVersion + 1 }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-product-channel-editor');

        // Every channel is a row, including the ones this product is not sold through.
        expect(screen.getByTestId('kitchen-product-channel-editor-pos')).toBeTruthy();
        expect(availableChannels(stored.channelAvailability)).not.toContain('pos');

        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-product-channel-editor-pos-toggle-control'),
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-channels-save'));
        });

        // Its own contract method, its own audit entry: a route to market is a commercial act, not
        // a rename, and the toggle lands through `setProductChannelAvailability` alone.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setProductChannelAvailability).toHaveBeenCalledWith(
                stored.id,
                expect.objectContaining({
                    lockVersion: 1,
                    availability: expect.arrayContaining([
                        expect.objectContaining({ channel: 'pos', isAvailable: true }),
                    ]),
                }),
            );
        });
        expect(repositories.kitchenAdmin.updateProduct).not.toHaveBeenCalled();
        await untilVisible('kitchen-product-channels-saved-toast');
        expect(availableChannels(stored.channelAvailability)).toContain('pos');
    });

    it('archives behind a confirmation that says nothing is deleted', async () => {
        let stored = product({ ordinal: 1, name: 'Pomegranate molasses' });

        const { repositories } = await renderStubScreen(
            <ProductEditScreen product={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getProduct: async () => stored,
                        listProducts: productListing(() => [stored]),
                        listRecipes: async () => page(NO_RECIPES),
                        archiveProduct: async (_id, request) => {
                            stored = {
                                ...stored,
                                meta: meta({
                                    status: 'retired',
                                    lockVersion: request.lockVersion + 1,
                                }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-product-archive');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-archive'));
        });
        await untilVisible('kitchen-product-archive-dialog');
        expect(screen.getByTestId('kitchen-product-archive-consequence')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-archive-confirm'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.archiveProduct).toHaveBeenCalledWith(stored.id, {
                lockVersion: 1,
            });
        });
        // Nothing is deleted: the record comes back retired, and the editor says so.
        await untilVisible('kitchen-product-archived');
        expect(stored.meta.status).toBe('retired');
    });

    it('offers reload-or-keep when somebody else has moved the product on', async () => {
        let stored = product({ ordinal: 1, name: 'Pomegranate molasses' });

        const { repositories } = await renderStubScreen(
            <ProductEditScreen product={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getProduct: async () => stored,
                        listProducts: productListing(() => [stored]),
                        listRecipes: async () => page(NO_RECIPES),
                        updateProduct: async (_id, request) => {
                            if (request.lockVersion !== stored.meta.lockVersion) {
                                throwFailure(
                                    conflictFailure({
                                        currentLockVersion: stored.meta.lockVersion,
                                    }),
                                );
                            }
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                meta: meta({ lockVersion: request.lockVersion + 1 }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-product-name-en-input');

        // Somebody else saves the same product. The editor is now holding a superseded version —
        // exactly the state `If-Match` exists to detect.
        stored = {
            ...stored,
            description: { en: 'Changed by the other tab.', ar: 'غُيّر من التبويب الآخر.' },
            meta: meta({ lockVersion: 2 }),
        };

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-product-name-en-input'), 'My version');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        await untilVisible('kitchen-product-editor-screen-conflict-dialog');

        // One attempt, refused, and the other tab's write stands.
        expect(repositories.kitchenAdmin.updateProduct).toHaveBeenCalledTimes(1);
        expect(stored.name.en).toBe('Pomegranate molasses');
        expect(stored.description.en).toBe('Changed by the other tab.');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-conflict-reload'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-product-name-en-input').props.value).toBe(
                'Pomegranate molasses',
            );
        });
    });

    it('asks before throwing away an unsaved pack', async () => {
        const stored = product({ ordinal: 1, name: 'Pomegranate molasses' });

        await renderStubScreen(<ProductEditScreen product={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getProduct: async () => stored,
                    listProducts: productListing(() => [stored]),
                    listRecipes: async () => page(NO_RECIPES),
                },
            },
        });
        await untilVisible('kitchen-product-packs-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-back'));
        });

        await untilVisible('kitchen-product-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalledWith('/kitchen/products');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-unsaved-discard'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/products');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The meal editor
 * ---------------------------------------------------------------------------------------------- */

describe('editing a meal', () => {
    it('saves both halves of a bilingual name and a changed portion', async () => {
        let stored = meal({ ordinal: 1, name: 'Freekeh bowl' });

        const { repositories } = await renderStubScreen(
            <MealEditScreen meal={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getMeal: async () => stored,
                        listRecipes: async () => page(NO_RECIPES),
                        updateMeal: async (_id, request) => {
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                ...(request.portionFactor === undefined
                                    ? {}
                                    : { portionFactor: request.portionFactor }),
                                meta: meta({ lockVersion: request.lockVersion + 1 }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-meal-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meal-name-en-input'),
                'Freekeh bowl, larger',
            );
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-meal-portion-input'), '1.5');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-editor-screen-save'));
        });

        // The Arabic half travels untouched beside the changed English one: a form that dropped the
        // language it was not editing would make the record unpublishable without saying so.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateMeal).toHaveBeenCalledWith(
                stored.id,
                expect.objectContaining({
                    lockVersion: 1,
                    name: { en: 'Freekeh bowl, larger', ar: 'Freekeh bowl بالعربية' },
                    portionFactor: 1.5,
                }),
            );
        });
        // …and the write really landed: the record the next read answers with carries both.
        await waitFor(() => {
            expect(stored.name.en).toBe('Freekeh bowl, larger');
        });
        expect(stored.portionFactor).toBe(1.5);
    });

    it('refuses a portion of nothing rather than dividing by it', async () => {
        const stored = meal({ ordinal: 1 });

        const { repositories } = await renderStubScreen(
            <MealEditScreen meal={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getMeal: async () => stored,
                        listRecipes: async () => page(NO_RECIPES),
                    },
                },
            },
        );
        await untilVisible('kitchen-meal-portion-input');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-meal-portion-input'), '0');
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-meal-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });
        // Refused in front of the request, not behind it: `updateMeal` is never reached, because a
        // portion of nothing is a division the margin would have to perform.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-editor-screen-save'));
        });
        expect(repositories.kitchenAdmin.updateMeal).not.toHaveBeenCalled();
    });

    it('writes a day of availability by its calendar date, and reads it back', async () => {
        let stored = meal({ ordinal: 1, name: 'Freekeh bowl' });

        const { repositories } = await renderStubScreen(
            <MealEditScreen meal={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getMeal: async () => stored,
                        listRecipes: async () => page(NO_RECIPES),
                        setMealAvailability: async (_id, request) => {
                            stored = {
                                ...stored,
                                availability: request.days,
                                meta: meta({ lockVersion: request.lockVersion + 1 }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-meal-availability-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-availability-add'));
        });

        const row = 'kitchen-meal-availability-editor-row-day-1';
        await untilVisible(row);

        // The date field is the design system's, so the value is set through its own onChange.
        await act(async () => {
            fireEvent(screen.getByTestId(`${row}-date`), 'onChange', '2026-09-01');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-remaining-input`), '40');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-cutoff-input`), '18:00');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-availability-save'));
        });

        // Keyed by the calendar date, with the branch-local cut-off as wall-clock text — no
        // recurrence rule the contract cannot store, and no timestamp with this browser's offset
        // baked into it.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setMealAvailability).toHaveBeenCalledWith(stored.id, {
                lockVersion: 1,
                days: [
                    {
                        date: '2026-09-01',
                        isAvailable: true,
                        remaining: 40,
                        orderCutOffAt: '18:00',
                    },
                ],
            });
        });

        // …and it is read back from the record the write answered with, as a seeded row.
        await untilVisible('kitchen-meal-availability-editor-row-seed-0-2026-09-01');
    });

    it('renders the confidential margin here, labelled, and never a fabricated zero', async () => {
        const stored = meal({ ordinal: 1, name: 'Freekeh bowl' });

        await renderStubScreen(<MealEditScreen meal={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getMeal: async () => stored,
                    listRecipes: async () => page(NO_RECIPES),
                },
            },
        });
        await untilVisible('kitchen-meal-confidential');

        // Labelled, because an unlabelled purchase-derived figure is one copy-paste from a
        // customer. `CostAmount` and everything computed from it live on this contract and on no
        // other, which is what makes a leak a compile error rather than a review finding.
        expect(screen.getByTestId('kitchen-meal-confidential-badge')).toBeTruthy();
        // The authored margin, stated exactly — not rounded away and not invented.
        expect(screen.getByTestId('kitchen-meal-margin')).toHaveTextContent(/42/);
        expect(screen.queryByTestId('kitchen-meal-margin-unknown')).toBeNull();
    });

    it('refuses to state a margin it cannot compute, rather than showing nought per cent', async () => {
        // `null` is the contract's answer when either side of the sum is missing: a margin over a
        // placeholder price is a fiction (plan §2.4), and a zero would be one with a number on it.
        const stored = meal({
            ordinal: 2,
            name: 'Market-priced bowl',
            overrides: { marginPercent: null },
        });

        await renderStubScreen(<MealEditScreen meal={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getMeal: async () => stored,
                    listRecipes: async () => page(NO_RECIPES),
                },
            },
        });

        await untilVisible('kitchen-meal-margin-unknown');
        expect(screen.getByTestId('kitchen-meal-confidential-badge')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-meal-margin')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------------------------------- */

describe('creating a meal', () => {
    /**
     * The create request, as the form holds it.
     *
     * Asserted on the *request* rather than on the record that comes back, because the record is
     * the server's answer and this is the only place the screen's own reading of the form is
     * visible. A bought-in meal — no recipe — is a legitimate draft: the picker's "not built from a
     * recipe" answer is an answer, and `recipeId` is therefore absent from the request rather than
     * sent as a null the contract does not describe.
     */
    it('sends the form it holds, and lands on the record the server answered with', async () => {
        let created: MealAdmin | null = null;

        const { repositories } = await renderStubScreen(<MealEditScreen meal="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: async () => page(NO_RECIPES),
                    createMeal: async (request) => {
                        created = meal({
                            ordinal: 9,
                            overrides: {
                                name: request.name,
                                description: request.description,
                                meta: meta({ status: 'draft', lockVersion: 0 }),
                                // Empty because the API stores no meal type for anybody: see the
                                // note on `publishBlockers` in `meal-edit-screen.tsx`.
                                mealTypes: [],
                                allergens: [],
                            },
                        });
                        return created;
                    },
                },
            },
        });
        await untilVisible('kitchen-meal-name-en-input');

        // Nothing that needs an identifier is offered yet, and that is the create form's promise.
        expect(screen.getByTestId('kitchen-meal-availability-unavailable')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-meal-publish')).toBeNull();

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meal-name-en-input'),
                'Charred aubergine bowl',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meal-name-ar-input'),
                'وعاء الباذنجان المشوي',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meal-description-en-input'),
                'Smoked, with tahini.',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-type-lunch'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-editor-screen-save'));
        });

        await untilVisible('kitchen-meal-created-toast');

        expect(repositories.kitchenAdmin.createMeal).toHaveBeenCalledTimes(1);
        expect(repositories.kitchenAdmin.createMeal).toHaveBeenCalledWith({
            name: { en: 'Charred aubergine bowl', ar: 'وعاء الباذنجان المشوي' },
            description: { en: 'Smoked, with tahini.', ar: '' },
            portionFactor: 1,
            mealTypes: ['lunch'],
            dietClassifications: [],
        });
        // Created as a draft, and moved onto its own address — the editor cannot go on calling
        // itself "New meal" over a record that exists.
        expect(repositories.kitchenAdmin.publishMeal).not.toHaveBeenCalled();
        expect(routerMock.__replace).toHaveBeenCalledWith(
            `/kitchen/meals/${String(mealIdentifier(9))}`,
        );
    });

    /**
     * The silent stall this suite exists to prevent.
     *
     * A create can fail for a reason the failure union does not carry — a mapper reading an
     * envelope the wrong way, a bug in an invalidation effect — and until `toFailure` learned to
     * project the uninterpretable onto `server`, such a rejection rendered *nothing*: no toast, no
     * alert, the heading still reading "Unsaved changes". Against the live API that is exactly what
     * a `TypeError` inside the meal read did to a save the server had already accepted.
     */
    it('says a create failed even when the failure is not one the contract describes', async () => {
        const { repositories } = await renderStubScreen(<MealEditScreen meal="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: async () => page(NO_RECIPES),
                    createMeal: () => {
                        throw new TypeError('allergens.map is not a function');
                    },
                },
            },
        });
        await untilVisible('kitchen-meal-name-en-input');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-meal-name-en-input'), 'Plain rice');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.createMeal).toHaveBeenCalledTimes(1);
        });

        await untilVisible('kitchen-meal-save-error');
        // …and nothing claims the write landed.
        expect(screen.queryByTestId('kitchen-meal-created-toast')).toBeNull();
        expect(routerMock.__replace).not.toHaveBeenCalled();
    });
});

describe('publishing a meal', () => {
    it('claims public visibility only once the server has answered published', async () => {
        let stored = meal({ ordinal: 3, name: 'Charred aubergine bowl' });

        const { repositories } = await renderStubScreen(
            <MealEditScreen meal={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getMeal: async () => stored,
                        listRecipes: async () => page(NO_RECIPES),
                        publishMeal: async (_id, request) => {
                            stored = {
                                ...stored,
                                meta: meta({
                                    status: 'published',
                                    lockVersion: request.lockVersion + 1,
                                }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-meal-publish');
        // A draft claims nothing: no published banner, and no route to a public page that does not
        // exist yet. That is the state publication changes.
        expect(screen.queryByTestId('kitchen-meal-published')).toBeNull();
        expect(screen.queryByTestId('kitchen-meal-view-public')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish'));
        });

        await untilVisible('kitchen-meal-publish-dialog');
        // The dialog states the consequence and the label before it asks.
        expect(screen.getByTestId('kitchen-meal-publish-consequence')).toBeTruthy();
        expect(screen.getByTestId('kitchen-meal-publish-allergens')).toBeTruthy();
        expect(screen.getByTestId('kitchen-meal-publish-allergen-gluten')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish-confirm'));
        });

        // Published at the version the editor was holding — a distinct lifecycle method, never a
        // status field on an update request.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.publishMeal).toHaveBeenCalledWith(stored.id, {
                lockVersion: 1,
            });
        });
        expect(repositories.kitchenAdmin.updateMeal).not.toHaveBeenCalled();

        // …and only now does the editor say it is public, and offer the way to go and look at it.
        await untilVisible('kitchen-meal-published');
        await untilVisible('kitchen-meal-view-public');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-view-public'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith(`/meals/${String(stored.id)}`);
        });
    });

    /**
     * The gate lists what a person can fix, and nothing they cannot.
     *
     * `MealAdmin.mealTypes` is empty for every meal this API can answer with — no column on
     * `catalogue_items` records whether a dish is a breakfast or a dinner, and the marketplace names
     * `meal_types` among the filters it accepts and cannot honour. A blocker on it was therefore a
     * reason nobody could clear, and it left the confirm button of every publish dialog in the
     * workspace permanently disabled.
     */
    it('does not withhold publication over a meal type this contract cannot store', async () => {
        let stored = meal({ ordinal: 7, name: 'Bought-in bowl', overrides: { mealTypes: [] } });

        const { repositories } = await renderStubScreen(
            <MealEditScreen meal={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getMeal: async () => stored,
                        listRecipes: async () => page(NO_RECIPES),
                        publishMeal: async (_id, request) => {
                            stored = {
                                ...stored,
                                meta: meta({
                                    status: 'published',
                                    lockVersion: request.lockVersion + 1,
                                }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-meal-publish');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish'));
        });
        await untilVisible('kitchen-meal-publish-dialog');

        expect(screen.queryByTestId('kitchen-meal-publish-blocked')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish-confirm'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.publishMeal).toHaveBeenCalledWith(stored.id, {
                lockVersion: 1,
            });
        });
        await untilVisible('kitchen-meal-published');
    });

    it('gives a new meal no allergen label it did not earn', async () => {
        // A meal with no recipe version behind it has nothing to derive a label from, and
        // `MealAdmin.allergens` is frozen at publication from that version. Inheriting a label from
        // anywhere else would publish a food-safety claim nobody made about this dish — so the
        // dialog that is about to make it public says plainly that there is none.
        const stored = meal({
            ordinal: 4,
            name: 'Plain rice',
            overrides: { allergens: [], recipeId: null, recipeVersionId: null },
        });

        await renderStubScreen(<MealEditScreen meal={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getMeal: async () => stored,
                    listRecipes: async () => page(NO_RECIPES),
                },
            },
        });

        await untilVisible('kitchen-meal-allergens-none');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish'));
        });
        await untilVisible('kitchen-meal-publish-dialog');

        expect(screen.getByTestId('kitchen-meal-publish-allergens-none')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-meal-publish-allergen-gluten')).toBeNull();
    });

    /**
     * The quarantine refusal, driven from the repository.
     *
     * What is genuinely this screen's job is rendering the server's structural refusal as a
     * quarantine rather than as a generic error, and leaving the meal unpublished. That is what a
     * `validation.failed` on `status` produces, and that is what is asserted here.
     */
    it('renders a refusal on `status` as a quarantine, and the meal stays unpublished', async () => {
        const stored = meal({ ordinal: 5, name: 'Contested tabbouleh' });

        await renderStubScreen(<MealEditScreen meal={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getMeal: async () => stored,
                    listRecipes: async () => page(NO_RECIPES),
                    publishMeal: async () =>
                        throwFailure(
                            validationFailure({
                                status: [
                                    'This meal is quarantined for review because its allergen ' +
                                        'information contradicts a published recipe.',
                                ],
                            }),
                        ),
                },
            },
        });

        await untilVisible('kitchen-meal-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish'));
        });
        await untilVisible('kitchen-meal-publish-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish-confirm'));
        });

        // A quarantine, not a red apology: the refusal is a fact about the record.
        await untilVisible('kitchen-meal-publish-refused-quarantine');
        expect(screen.queryByTestId('kitchen-meal-publish-failed')).toBeNull();

        // …and nothing about the record changed: it still offers publish, and claims no public page.
        expect(screen.getByTestId('kitchen-meal-editor-screen-status')).toHaveTextContent(/Draft/);
        expect(screen.queryByTestId('kitchen-meal-view-public')).toBeNull();
    });

    it('withdraws a published meal, and the editor stops claiming it is public', async () => {
        let stored = meal({
            ordinal: 6,
            name: 'Freekeh bowl',
            overrides: { meta: meta({ status: 'published', lockVersion: 4 }) },
        });

        const { repositories } = await renderStubScreen(
            <MealEditScreen meal={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        getMeal: async () => stored,
                        listRecipes: async () => page(NO_RECIPES),
                        retireMeal: async (_id, request) => {
                            stored = {
                                ...stored,
                                meta: meta({
                                    status: 'retired',
                                    lockVersion: request.lockVersion + 1,
                                }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-meal-retire');
        expect(screen.getByTestId('kitchen-meal-view-public')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-retire'));
        });
        await untilVisible('kitchen-meal-retire-dialog');
        expect(screen.getByTestId('kitchen-meal-retire-consequence')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-retire-confirm'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.retireMeal).toHaveBeenCalledWith(stored.id, {
                lockVersion: 4,
            });
        });

        // Retiring *is* the archive: nothing is deleted, the record comes back retired, and the
        // editor drops the claim that a customer can see it.
        await untilVisible('kitchen-meal-retired');
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-meal-view-public')).toBeNull();
        });
    });
});
