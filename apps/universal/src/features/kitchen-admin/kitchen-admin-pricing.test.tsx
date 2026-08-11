import {
    apiFailure,
    conflictFailure,
    isPriceEntryConsistent,
    throwFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CatalogueItemRef,
    CursorPage,
    MealAdmin,
    PriceListAdmin,
    PriceListAdminFilter,
    PriceListEntry,
} from '@healthy360/api-client/contracts';
import { KitchenId, MealId, PriceListId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import KitchenPriceListsRoute from '../../../app/kitchen/price-lists/index.tsx';
import {
    ORGANISATION_OWNER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    isAgreementPriced,
    minorAmountToInput,
    parseMinorAmount,
    priceItemBaseKey,
    priceItemKey,
    summarisePriceEntries,
} from './format.ts';
import {
    emptyPriceEntry,
    priceEntryDraft,
    priceEntryErrors,
    priceEntryRequest,
    withPriceStatus,
} from './price-row-editors.tsx';
import type { PriceEntryDraft } from './price-row-editors.tsx';
import { PriceListEditScreen } from './screens/price-list-edit-screen.tsx';
import { PriceListsScreen } from './screens/price-lists-screen.tsx';

/**
 * The pricing half of the kitchen workspace, against a world this file declares (K1.5).
 *
 * Nothing here stubs a hook, and nothing here signs into somebody else's fixture world: every price
 * list, every entry and every rejection below is authored in this file and handed to
 * `renderStubScreen`, so a count assertion is a statement about what the test wrote. A repository
 * method a screen reaches for and this file did not declare rejects loudly with
 * `StubNotConfiguredError` naming it, rather than rendering an empty state over a hole in the test.
 *
 * Six things this file exists to prove:
 *
 * 1. **The `CHECK` cannot be broken through the interface.** Switching a row to `placeholder` or
 *    `market_priced` clears its amount and disables the field in the same gesture, and switching
 *    back to `confirmed` blocks the save until a number is typed. The rule is asserted twice — once
 *    on the pure function, once through the rendered control — because the pure function is what a
 *    future editor will reuse and the control is what a person actually touches.
 * 2. **Money round-trips.** `5.50` in the field is `550` on the wire and `5.50` again on reload, by
 *    string arithmetic rather than by `× 100`, and a third decimal place in a two-decimal currency
 *    is refused rather than rounded.
 * 3. **Publishing says what it will not do.** The dialog counts the confirmed entries and names the
 *    placeholder and market-priced ones as excluded, and it is refused — with the reason — while
 *    anything is unsaved or inconsistent.
 * 4. **The list tells the truth about what it cannot do.** No create control, because the contract
 *    publishes no `createPriceList`; no publish from a row, because the consequence needs the
 *    editor's context.
 * 5. **The row machinery keeps its promises here too** — add, move with an announcement, remove,
 *    undo to the row's own position.
 * 6. **The route-level split still renders.** `app/kitchen/price-lists/index.tsx` is a `React.lazy`
 *    boundary; the screen behind it arrives under `waitFor`, which is the property the export-budget
 *    work depends on and the one a stubbed hook would hide.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/kitchen/price-lists',
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

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 *
 * Every builder is typed against its contract shape, so a contract that grows a required field
 * fails the typecheck here rather than producing a record the screen cannot render.
 * ---------------------------------------------------------------------------------------------- */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000a001');

/** UUID-shaped, because `PriceListEditScreen` parses the route parameter with `PriceListId`. */
function priceListId(ordinal: number): PriceListId {
    return PriceListId.unsafe(`01935f6d-0000-7000-8000-00000000d00${String(ordinal)}`);
}

function mealId(ordinal: number): MealId {
    return MealId.unsafe(`01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`);
}

function mealRef(ordinal: number): CatalogueItemRef {
    return { kind: 'meal', mealId: mealId(ordinal) };
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

function meal(ordinal: number, overrides: Partial<MealAdmin> = {}): MealAdmin {
    return {
        id: mealId(ordinal),
        meta: meta({ status: 'published' }),
        name: { en: `Meal ${String(ordinal)}`, ar: `وجبة ${String(ordinal)}` },
        description: { en: `Meal ${String(ordinal)} description.`, ar: `وصف ${String(ordinal)}` },
        kitchenId: KITCHEN_ID,
        recipeId: null,
        recipeVersionId: null,
        portionFactor: 1,
        mealTypes: ['lunch'],
        dietClassifications: [],
        allergens: [],
        channelAvailability: [],
        availability: [],
        imagePlaceholderId: `meal-${String(ordinal)}`,
        marginPercent: null,
        ...overrides,
    };
}

/** Everything this kitchen can put a price on. Four meals; no products and no plans. */
const MEALS: readonly MealAdmin[] = [1, 2, 3, 4].map((ordinal) => meal(ordinal));

function priceEntry(
    item: CatalogueItemRef,
    overrides: Partial<PriceListEntry> = {},
): PriceListEntry {
    return {
        item,
        priceStatus: 'confirmed',
        amountMinor: 1250,
        effectiveFrom: '2026-07-27',
        effectiveUntil: null,
        note: null,
        ...overrides,
    };
}

/**
 * A draft list whose entries all carry confirmed amounts — the meal menu.
 *
 * Two entries and not one: the row machinery below moves the second above the first, and a
 * one-entry list would make the move a no-op the test could not tell from a broken control.
 */
const CONFIRMED_LIST: PriceListAdmin = {
    id: priceListId(1),
    meta: meta({ lockVersion: 3 }),
    name: { en: 'Verdant Kitchen meal menu', ar: 'قائمة وجبات مطبخ فيردانت' },
    currency: 'USD',
    kitchenId: KITCHEN_ID,
    channels: ['b2c', 'marketplace'],
    entries: [
        priceEntry(mealRef(1), { amountMinor: 1250 }),
        priceEntry(mealRef(2), { amountMinor: 990 }),
    ],
};

/**
 * A draft list with no confirmed amount in it at all — the retail packs, sold under a negotiated
 * agreement. `b2b` is what makes it confidential; see `isAgreementPriced`.
 */
const UNPRICED_LIST: PriceListAdmin = {
    id: priceListId(2),
    meta: meta({ lockVersion: 1 }),
    name: { en: 'Verdant Kitchen retail packs', ar: 'عبوات التجزئة لمطبخ فيردانت' },
    currency: 'USD',
    kitchenId: KITCHEN_ID,
    channels: ['b2b'],
    entries: [
        priceEntry(mealRef(3), { priceStatus: 'placeholder', amountMinor: null }),
        priceEntry(mealRef(4), { priceStatus: 'market_priced', amountMinor: null }),
    ],
};

/**
 * The price-list listing, answering the filters the list screen actually sends.
 *
 * `query` and `statuses` are real server filters (`PriceListAdminFilter`), and the search box and
 * the status chips both depend on them behaving. Reading a getter rather than a captured array is
 * what lets a test move the world on mid-flight and assert the refetch.
 */
function priceListListing(
    read: () => readonly PriceListAdmin[],
): (filter?: PriceListAdminFilter) => Promise<CursorPage<PriceListAdmin>> {
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

/**
 * The three catalogue listings the editor's item picker is built from.
 *
 * Declared on every editor render, including the not-found one: the three queries are started
 * before the screen decides the route parameter is not an identifier, so a test that omitted them
 * would fail on a `StubNotConfiguredError` rather than on the state it meant to assert.
 */
function catalogueReads() {
    return {
        listProducts: async () => page([]),
        listMeals: async () => page(MEALS),
        listPlans: async () => page([]),
    };
}

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
                roles: [{ id: 'test-0000-role-0002', key: 'organisation_owner', name: 'Owner' }],
            }),
        ],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

/** Everything the editor reads for one list, over a record the test can move on mid-flight. */
function editorReads(read: () => PriceListAdmin): RepositoryOverrides {
    return {
        kitchenAdmin: {
            ...catalogueReads(),
            getPriceList: async () => read(),
        },
    };
}

/* ------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

function entry(overrides: Partial<PriceEntryDraft> = {}): PriceEntryDraft {
    return {
        key: 'a',
        item: { kind: 'meal', mealId: '01935f6d-0000-7000-8000-00000000c000' as never },
        priceStatus: 'confirmed',
        amount: '5.50',
        effectiveFrom: '2026-07-27',
        effectiveUntil: null,
        note: '',
        ...overrides,
    };
}

const MESSAGES = {
    itemRequired: 'item required',
    itemDuplicate: 'item duplicate',
    amountRequired: 'amount required',
    amountInvalid: 'amount invalid',
    datesReversed: 'dates reversed',
};

describe('money, in the two directions it has to survive', () => {
    it('reads a 0.5 kg pack at $5.50 as 550 minor units, and writes it back as “5.50”', () => {
        expect(parseMinorAmount('5.50', 'USD')).toBe(550);
        expect(minorAmountToInput(550, 'USD')).toBe('5.50');
        expect(minorAmountToInput(parseMinorAmount('5.50', 'USD') ?? -1, 'USD')).toBe('5.50');
    });

    it('does not go through floating point, which is where 5.55 would go wrong', () => {
        // `5.55 * 100` is 554.9999999999999. The string path is not allowed to care.
        expect(parseMinorAmount('5.55', 'USD')).toBe(555);
        expect(parseMinorAmount('0.07', 'USD')).toBe(7);
        expect(parseMinorAmount('1234.05', 'USD')).toBe(123_405);
        expect(minorAmountToInput(7, 'USD')).toBe('0.07');
        expect(minorAmountToInput(0, 'USD')).toBe('0.00');
    });

    it('honours the three-decimal currencies rather than assuming two', () => {
        expect(parseMinorAmount('1.250', 'KWD')).toBe(1250);
        expect(minorAmountToInput(1250, 'KWD')).toBe('1.250');
        // …and 1250 in a two-decimal currency is a different number entirely.
        expect(minorAmountToInput(1250, 'USD')).toBe('12.50');
    });

    it('refuses more precision than the currency has, rather than rounding it away', () => {
        expect(parseMinorAmount('5.505', 'USD')).toBeNull();
        expect(parseMinorAmount('', 'USD')).toBeNull();
        expect(parseMinorAmount('.', 'USD')).toBeNull();
        expect(parseMinorAmount('five', 'USD')).toBeNull();
        expect(parseMinorAmount('-1.00', 'USD')).toBeNull();
        // Eastern-Arabic digits are display, never input: the value goes to an integer column.
        expect(parseMinorAmount('٥٫٥٠', 'USD')).toBeNull();
    });
});

describe('the consistency rule, as a pure function', () => {
    it('clears the amount when a row stops being a confirmed price', () => {
        const confirmed = entry({ amount: '5.50' });
        expect(withPriceStatus(confirmed, 'placeholder').amount).toBe('');
        expect(withPriceStatus(confirmed, 'market_priced').amount).toBe('');
        // …and keeps whatever is there when it becomes one again.
        expect(
            withPriceStatus(entry({ priceStatus: 'placeholder', amount: '' }), 'confirmed').amount,
        ).toBe('');
    });

    it('is the same rule the contract states, in both directions', () => {
        const built = priceEntryRequest([entry({ amount: '5.50' })], 'USD');
        expect(built[0]?.amountMinor).toBe(550);
        expect(isPriceEntryConsistent(built[0]!)).toBe(true);

        const pending = priceEntryRequest(
            [entry({ priceStatus: 'placeholder', amount: '' })],
            'USD',
        );
        expect(pending[0]?.amountMinor).toBeNull();
        expect(isPriceEntryConsistent(pending[0]!)).toBe(true);
    });

    it('refuses a row with nothing chosen, a duplicate item, a bad amount or reversed dates', () => {
        expect(priceEntryErrors([entry({ item: null })], 'USD', MESSAGES).get('a')).toBe(
            'item required',
        );

        const duplicates = priceEntryErrors(
            [entry({ key: 'a' }), entry({ key: 'b' })],
            'USD',
            MESSAGES,
        );
        expect(duplicates.get('a')).toBeUndefined();
        expect(duplicates.get('b')).toBe('item duplicate');

        expect(priceEntryErrors([entry({ amount: '' })], 'USD', MESSAGES).get('a')).toBe(
            'amount required',
        );
        expect(priceEntryErrors([entry({ amount: '5.505' })], 'USD', MESSAGES).get('a')).toBe(
            'amount invalid',
        );
        expect(
            priceEntryErrors(
                [entry({ priceStatus: 'market_priced', amount: '5.50' })],
                'USD',
                MESSAGES,
            ).get('a'),
        ).toBe('amount invalid');
        expect(
            priceEntryErrors([entry({ effectiveUntil: '2026-07-01' })], 'USD', MESSAGES).get('a'),
        ).toBe('dates reversed');

        expect(priceEntryErrors([entry()], 'USD', MESSAGES).size).toBe(0);
    });

    it('counts two packs of one product as two prices and two rows for one pack as a duplicate', () => {
        const productId = '01935f6d-0000-7000-8000-00000000b000' as never;
        const trayRow = entry({
            key: 'a',
            item: { kind: 'product', productId, packCode: 'TRAY' },
        });
        const singleRow = entry({
            key: 'b',
            item: { kind: 'product', productId, packCode: 'SINGLE' },
        });
        expect(priceEntryErrors([trayRow, singleRow], 'USD', MESSAGES).size).toBe(0);

        const again = entry({ key: 'c', item: { kind: 'product', productId, packCode: 'TRAY' } });
        expect(priceEntryErrors([trayRow, again], 'USD', MESSAGES).get('c')).toBe('item duplicate');

        // The *base* key ignores the pack, which is what the first picker is addressed by.
        expect(priceItemBaseKey(trayRow.item!)).toBe(priceItemBaseKey(singleRow.item!));
        expect(priceItemKey(trayRow.item!)).not.toBe(priceItemKey(singleRow.item!));
    });

    it('summarises a set the way the list column and the publish dialog both read it', () => {
        const summary = summarisePriceEntries(
            priceEntryRequest(
                [
                    entry({ key: 'a' }),
                    entry({
                        key: 'b',
                        item: { kind: 'meal', mealId: 'm2' as never },
                        priceStatus: 'placeholder',
                        amount: '',
                    }),
                    entry({
                        key: 'c',
                        item: { kind: 'meal', mealId: 'm3' as never },
                        priceStatus: 'market_priced',
                        amount: '',
                    }),
                ],
                'USD',
            ),
        );
        expect(summary).toEqual({
            total: 3,
            confirmed: 1,
            placeholder: 1,
            marketPriced: 1,
            inconsistent: 0,
        });
    });

    it('reads a server entry back into the field it came from', () => {
        const draft = priceEntryDraft(
            {
                item: { kind: 'meal', mealId: 'm1' as never },
                priceStatus: 'confirmed',
                amountMinor: 550,
                effectiveFrom: '2026-07-27',
                effectiveUntil: null,
                note: null,
            },
            'USD',
            0,
        );
        expect(draft.amount).toBe('5.50');
        expect(draft.note).toBe('');
        expect(priceEntryRequest([draft], 'USD')[0]?.amountMinor).toBe(550);
    });

    it('calls a list confidential exactly when a channel carries private pricing', () => {
        expect(isAgreementPriced(['b2c', 'marketplace'])).toBe(false);
        expect(isAgreementPriced(['b2b', 'pos'])).toBe(true);
        expect(isAgreementPriced(['corporate'])).toBe(true);
        expect(isAgreementPriced([])).toBe(false);
    });

    it('starts a new row as a confirmed price with today already filled in', () => {
        const blank = emptyPriceEntry('entry-1', '2026-08-02');
        expect(blank.priceStatus).toBe('confirmed');
        expect(blank.item).toBeNull();
        expect(blank.effectiveFrom).toBe('2026-08-02');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the price-list list', () => {
    it('renders skeletons, then the authored rows with their currency, channels and entry split', async () => {
        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });

        await untilVisible('kitchen-price-lists-loading');
        await untilVisible('kitchen-price-lists-table');

        const base = `kitchen-price-list-${String(CONFIRMED_LIST.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-currency`)).toHaveTextContent(CONFIRMED_LIST.currency);
        expect(screen.getByTestId(`${base}-channels`)).toBeTruthy();
        // Two entries, both confirmed: the split is the arithmetic on what this file authored.
        expect(screen.getByTestId(`${base}-entries-total`)).toHaveTextContent(/2/);
        expect(screen.getByTestId(`${base}-entries-confirmed`)).toHaveTextContent(/2/);
        expect(screen.getByTestId(`${base}-entries-placeholder`)).toHaveTextContent(/0/);
        expect(screen.getByTestId(`${base}-entries-market`)).toHaveTextContent(/0/);
        expect(screen.getByTestId(`${base}-status`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
    });

    it('states the split for a list with nothing confirmed in it, rather than only a total', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');

        const base = `kitchen-price-list-${String(UNPRICED_LIST.id)}`;
        const summary = summarisePriceEntries(UNPRICED_LIST.entries);
        expect(summary.confirmed).toBe(0);
        // The zero is rendered rather than hidden — it is the most important thing on the row.
        expect(screen.getByTestId(`${base}-entries-confirmed`)).toHaveTextContent(/0/);
        expect(screen.getByTestId(`${base}-entries-total`)).toHaveTextContent(/2/);
    });

    it('offers no create control and no row publish, because neither is this screen’s to offer', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');

        expect(screen.queryByTestId('kitchen-price-lists-toolbar-create')).toBeNull();

        const base = `kitchen-price-list-${String(CONFIRMED_LIST.id)}`;
        expect(screen.getByTestId(`${base}-open`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-publish`)).toBeNull();
    });

    it('marks the agreement-priced list and explains what that means', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');

        // Authored, not discovered: the retail-packs list sells through `b2b`, which is one of the
        // channels `hasPrivatePricing` calls contract-private.
        expect(isAgreementPriced(UNPRICED_LIST.channels)).toBe(true);
        expect(isAgreementPriced(CONFIRMED_LIST.channels)).toBe(false);

        expect(screen.getByTestId('kitchen-price-lists-confidential')).toBeTruthy();
        expect(
            screen.getByTestId(`kitchen-price-list-${String(UNPRICED_LIST.id)}-agreement`),
        ).toBeTruthy();
        expect(
            screen.queryByTestId(`kitchen-price-list-${String(CONFIRMED_LIST.id)}-agreement`),
        ).toBeNull();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-price-lists-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-price-lists-empty');
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: async () =>
                        throwFailure(apiFailure('server', { message: 'Boom.' })),
                },
            },
        });

        await untilVisible('kitchen-price-lists-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        // No repository overrides at all: the gate refuses before the table can ask for anything, so
        // a screen that fetched here would fail loudly with StubNotConfiguredError.
        await renderStubScreen(<PriceListsScreen />, { session: organisationOwnerSession() });

        await untilVisible('kitchen-price-lists-forbidden');
        expect(screen.queryByTestId('kitchen-price-lists-table')).toBeNull();
    });

    /**
     * The route file, not the screen — the property the export-budget work depends on.
     *
     * `app/kitchen/price-lists/index.tsx` resolves its screen through `React.lazy`, so the first
     * frame is the labelled fallback and the screen arrives a microtask later. Rendering the route
     * rather than the screen is what proves the boundary is wired; asserting on the fallback's test
     * id is what proves it is the one `src/shell/lazy-screen.tsx` renders.
     */
    it('renders through the lazy route boundary', async () => {
        await renderStubScreen(<KitchenPriceListsRoute />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The editor
 * ---------------------------------------------------------------------------------------------- */

describe('editing a price list', () => {
    it('states the currency and the channels as facts, with no control to change them', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await untilVisible('kitchen-price-list-facts');

        expect(screen.getByTestId('kitchen-price-list-currency')).toHaveTextContent(
            new RegExp(CONFIRMED_LIST.currency),
        );
        expect(screen.getByTestId('kitchen-price-list-readonly-note')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-price-list-currency-trigger')).toBeNull();
    });

    it('shows a not-found state for an identifier that is not one', async () => {
        // The three catalogue queries start before the route parameter is judged, so they are
        // declared here as well — a hole in the test would otherwise reject before the state under
        // test could render.
        await renderStubScreen(<PriceListEditScreen priceList="not-a-uuid" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: catalogueReads() },
        });
        await untilVisible('kitchen-price-list-not-found');
    });

    it('renders every entry with its amount in major units', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;
        expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe(
            minorAmountToInput(first.amountMinor ?? 0, CONFIRMED_LIST.currency),
        );
        expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('12.50');
        expect(screen.getByTestId(`${row}-badge`)).toBeTruthy();
    });

    it('clears the amount and takes the field away when a row stops being a confirmed price', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        expect(screen.getByTestId(`${row}-amount-input`).props.value).not.toBe('');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-status-placeholder`));
        });

        // The field is removed rather than greyed — see the note in `../price-row-editors.tsx`.
        await waitFor(() => {
            expect(screen.queryByTestId(`${row}-amount-input`)).toBeNull();
        });
        expect(screen.getByTestId(`${row}-amount-absent`)).toBeTruthy();
        // …and the honest badge and explainer take the number's place.
        expect(screen.getByTestId(`${row}-no-amount`)).toBeTruthy();

        // Confirmed again, and the value it used to hold is gone rather than restored.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-status-confirmed`));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('');
        });
    });

    it('blocks the save when a row is confirmed again and left without an amount', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-status-market_priced`));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-status-confirmed`));
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-price-list-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-amount-input`), '5.50');
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-price-list-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(false);
        });
    });

    it('saves a changed amount as minor units, and reads it back in major ones', async () => {
        // The record as the server holds it. The write rule below is the server's own: an accepted
        // write replaces the entry set and answers with the record at its *next* version.
        let stored: PriceListAdmin = CONFIRMED_LIST;

        const { repositories } = await renderStubScreen(
            <PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...catalogueReads(),
                        getPriceList: async () => stored,
                        setPriceListEntries: async (_id, request) => {
                            stored = {
                                ...stored,
                                entries: request.entries,
                                meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-amount-input`), '5.50');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-save'));
        });

        // The write is the assertion: minor units, at the version the editor opened with.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setPriceListEntries).toHaveBeenCalledWith(
                CONFIRMED_LIST.id,
                expect.objectContaining({ lockVersion: 3 }),
            );
        });

        await waitFor(() => {
            const saved = stored.entries.find(
                (candidate) => priceItemKey(candidate.item) === priceItemKey(first.item),
            );
            expect(saved?.amountMinor).toBe(550);
        });

        // …and the field reads the record back in major units rather than keeping the local draft.
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('5.50');
        });
    });

    it('writes a placeholder as a NULL amount rather than as a stale number', async () => {
        let stored: PriceListAdmin = CONFIRMED_LIST;

        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...catalogueReads(),
                    getPriceList: async () => stored,
                    setPriceListEntries: async (_id, request) => {
                        stored = {
                            ...stored,
                            entries: request.entries,
                            meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                        };
                        return stored;
                    },
                },
            },
        });
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-status-placeholder`));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-save'));
        });

        await waitFor(() => {
            const saved = stored.entries.find(
                (candidate) => priceItemKey(candidate.item) === priceItemKey(first.item),
            );
            expect(saved?.priceStatus).toBe('placeholder');
            expect(saved?.amountMinor).toBeNull();
            expect(isPriceEntryConsistent(saved!)).toBe(true);
        });
    });

    it('adds a row, moves one with an announcement, removes one and undoes it in place', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await untilVisible('kitchen-price-list-add-entry');

        const first = CONFIRMED_LIST.entries[0]!;
        const second = CONFIRMED_LIST.entries[1]!;
        const firstRow = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;
        const secondRow = `kitchen-price-list-entries-row-seed-1-${priceItemKey(second.item)}`;

        // Move: the second row becomes the first, and the live region says where it landed.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${secondRow}-move-up`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-price-list-entries-announcer')).toHaveTextContent(
                /1/,
            );
        });

        // Remove and undo: the row returns to the position it left, not to the end.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${firstRow}-remove`));
        });
        expect(screen.queryByTestId(firstRow)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-entries-removed-bar-undo'));
        });
        await untilVisible(firstRow);

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        expect(screen.getByTestId('kitchen-price-list-entries-row-entry-1')).toBeTruthy();
        // A new row prices nothing yet, so the save is blocked until something is chosen.
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-price-list-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });
    });

    it('offers reload-or-keep when somebody else has moved the list on', async () => {
        let stored: PriceListAdmin = CONFIRMED_LIST;

        const { repositories } = await renderStubScreen(
            <PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...catalogueReads(),
                        getPriceList: async () => stored,
                        setPriceListEntries: async (_id, request) => {
                            // The server's rule: a stale `lockVersion` is refused rather than
                            // applied over whatever landed in between.
                            if (request.lockVersion !== stored.meta.lockVersion) {
                                throwFailure(
                                    conflictFailure({
                                        currentLockVersion: stored.meta.lockVersion,
                                    }),
                                );
                            }
                            stored = {
                                ...stored,
                                entries: request.entries,
                                meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        // Somebody else saves the same row, dropping the second entry. The editor now holds a
        // version the server has already superseded — the state `If-Match` exists to detect.
        stored = {
            ...stored,
            entries: stored.entries.slice(0, 1),
            meta: { ...stored.meta, lockVersion: stored.meta.lockVersion + 1 },
        };

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-amount-input`), '9.99');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-save'));
        });

        await untilVisible('kitchen-price-list-editor-screen-conflict-dialog');

        // The other tab's write stands: one attempt, refused, and nothing was overwritten.
        expect(repositories.kitchenAdmin.setPriceListEntries).toHaveBeenCalledTimes(1);
        expect(stored.entries).toHaveLength(1);

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-conflict-reload'));
        });

        // Reloading rebases onto the server's version — the row the other tab removed is gone.
        await waitFor(() => {
            expect(
                screen.queryByTestId(
                    `kitchen-price-list-entries-row-seed-1-${priceItemKey(
                        CONFIRMED_LIST.entries[1]!.item,
                    )}`,
                ),
            ).toBeNull();
        });
    });

    it('asks before throwing away an unsaved entry', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await untilVisible('kitchen-price-list-add-entry');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-back'));
        });

        await untilVisible('kitchen-price-list-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalledWith('/kitchen/price-lists');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-unsaved-discard'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/price-lists');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Publishing
 * ---------------------------------------------------------------------------------------------- */

describe('publishing a price list', () => {
    it('counts the confirmed entries and names the ones that will never reach a customer', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(UNPRICED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => UNPRICED_LIST),
        });
        await untilVisible('kitchen-price-list-entries');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-publish'));
        });
        await untilVisible('kitchen-price-list-publish-dialog');

        // Two entries, neither of them a number: the dialog leads with the zero rather than with
        // the total, which is the whole point of the count.
        const summary = summarisePriceEntries(UNPRICED_LIST.entries);
        expect(summary.confirmed).toBe(0);
        expect(screen.getByTestId('kitchen-price-list-publish-consequence')).toHaveTextContent(
            new RegExp(String(summary.confirmed)),
        );
        expect(screen.getByTestId('kitchen-price-list-publish-excluded')).toBeTruthy();
    });

    it('refuses to publish while there are unsaved changes, and says so', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(UNPRICED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => UNPRICED_LIST),
        });
        await untilVisible('kitchen-price-list-add-entry');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-publish'));
        });
        await untilVisible('kitchen-price-list-publish-dialog');

        expect(screen.getByTestId('kitchen-price-list-publish-blocked')).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-price-list-publish-confirm').props.accessibilityState
                ?.disabled,
        ).toBe(true);
    });

    it('publishes a draft list, and the record says so afterwards', async () => {
        let stored: PriceListAdmin = UNPRICED_LIST;

        const { repositories } = await renderStubScreen(
            <PriceListEditScreen priceList={String(UNPRICED_LIST.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...catalogueReads(),
                        getPriceList: async () => stored,
                        publishPriceList: async (_id, request) => {
                            stored = {
                                ...stored,
                                meta: {
                                    ...stored.meta,
                                    status: 'published',
                                    lockVersion: request.lockVersion + 1,
                                },
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-price-list-entries');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-publish'));
        });
        await untilVisible('kitchen-price-list-publish-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-publish-confirm'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.publishPriceList).toHaveBeenCalledWith(
                UNPRICED_LIST.id,
                { lockVersion: UNPRICED_LIST.meta.lockVersion },
            );
        });
        await waitFor(() => {
            expect(stored.meta.status).toBe('published');
        });

        await untilVisible('kitchen-price-list-published');
        // A published list has no second publish control to press.
        expect(screen.queryByTestId('kitchen-price-list-publish')).toBeNull();
    });

    it('renders the server’s refusal when an inconsistent entry reaches publication', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(UNPRICED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...catalogueReads(),
                    getPriceList: async () => UNPRICED_LIST,
                    publishPriceList: async () =>
                        throwFailure(
                            validationFailure(
                                { entries: ['Two entries disagree with their status.'] },
                                { message: 'Refused.' },
                            ),
                        ),
                },
            },
        });
        await untilVisible('kitchen-price-list-entries');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-publish'));
        });
        await untilVisible('kitchen-price-list-publish-dialog');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-publish-confirm'));
        });

        await untilVisible('kitchen-price-list-publish-error');
    });
});
