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
    PriceStatus,
} from '@healthy360/api-client/contracts';
import { KitchenId, MealId, PriceListId, RoleId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import KitchenPriceListsRoute from '../../../app/kitchen/price-lists/index.tsx';
import {
    MEMBER_PERMISSIONS,
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
    adjustConfirmedPrices,
    emptyPriceEntry,
    priceEntryDraft,
    priceEntryProblems,
    priceEntryRequest,
    priceRoundingStep,
    summarisePriceChanges,
    uncoveredUnits,
    withPriceStatus,
} from './price-row-editors.tsx';
import type { PriceEntryDraft, PriceItemOption } from './price-row-editors.tsx';
import { PriceListEditScreen } from './screens/price-list-edit-screen.tsx';
import { PriceListsScreen } from './screens/price-lists-screen.tsx';

/*
 * The Commercial lists are desk surfaces: above  a row draws every column the spec declares.
 * Jest's default window is phone-sized, where the same list collapses to two-line rows, so these
 * suites render at the width the screens are built for.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

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
 *    `market_priced` clears its amount and disables the field in the same gesture, switching back
 *    to `confirmed` restores the saved amount, and a confirmed row left without one is named when
 *    Save is pressed and not sent. The rule is asserted twice — once on the pure function, once
 *    through the rendered control — because the pure function is what a future editor will reuse
 *    and the control is what a person actually touches.
 * 2. **Money round-trips.** `5.50` in the field is `550` on the wire and `5.50` again on reload, by
 *    string arithmetic rather than by `× 100`, and a third decimal place in a two-decimal currency
 *    is refused rather than rounded.
 * 3. **Publishing says what it will not do.** The dialog counts the confirmed entries and names the
 *    placeholder and market-priced ones as excluded, and it is refused — with the reason — while
 *    anything is unsaved or inconsistent.
 * 4. **The list tells the truth about what it cannot do.** No create control, because the contract
 *    publishes no `createPriceList`; no publish from a row, because the consequence needs the
 *    editor's context.
 * 5. **The grid keeps count of what changed** — add, remove, edit and a percentage change are all
 *    counted against the list as it was read, the *Changed* filter and the save bar agree, and
 *    *Discard changes* puts every row back.
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

/**
 * Waits for the price list editor's Entries card. The editor is one page — the opening, the
 * entries and the save bar — so there is no step to open, only the card to arrive.
 */
async function openEntriesStep() {
    await untilVisible('kitchen-price-list-entries-card');
}

/** Sets a row's price status through its *How it's priced* segments. */
async function chooseStatus(row: string, status: PriceStatus) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(`${row}-basis-${status}`));
    });
}

/** Presses the save bar's Save. The bar is only there while something differs from the list. */
async function pressSave() {
    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-price-list-editor-screen-save'));
    });
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
 * `query`, `statuses` and `channels` are real server filters (`PriceListAdminFilter`), and the
 * search box, the status chips and the Channels header all depend on them behaving. Reading a
 * getter rather than a captured array is what lets a test move the world on mid-flight and assert
 * the refetch.
 */
function priceListListing(
    read: () => readonly PriceListAdmin[],
): (filter?: PriceListAdminFilter) => Promise<CursorPage<PriceListAdmin>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const channels = filter?.channels;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';

        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (channels === undefined ||
                        row.channels.some((channel) => channels.includes(channel))) &&
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

/**
 * Somebody who belongs to an organisation and may do nothing in it — the registry's `member` role.
 *
 * This was `organisationOwnerSession`, built from a nine-code `ORGANISATION_OWNER_PERMISSIONS` that
 * happened to lack every catalogue code. An owner holds all forty-three, so the fixture was wrong
 * and the refusal it proved was an accident of the wrongness. `member` is the role that genuinely
 * cannot open a kitchen screen, which is what these tests were always reaching for.
 */
function organisationMemberSession() {
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
                        key: 'member',
                        name: 'Member',
                    },
                ],
            }),
        ],
        activeContext: testActiveContext({ permissions: MEMBER_PERMISSIONS }),
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

/** The kinds of problem each row has, keyed by row — what the note under the row lists. */
function problemKinds(rows: readonly PriceEntryDraft[]): Record<string, readonly string[]> {
    return Object.fromEntries(
        [...priceEntryProblems(rows, 'USD')].map(([key, list]) => [
            key,
            list.map((problem) => problem.kind),
        ]),
    );
}

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
        // …and becoming one again puts back the amount the row was saved with, never a stale one.
        expect(
            withPriceStatus(entry({ priceStatus: 'placeholder', amount: '' }), 'confirmed').amount,
        ).toBe('');
        expect(
            withPriceStatus(entry({ priceStatus: 'placeholder', amount: '' }), 'confirmed', '5.50')
                .amount,
        ).toBe('5.50');
        // A figure typed since is the person's, and stays.
        expect(withPriceStatus(entry({ amount: '6.00' }), 'confirmed', '5.50').amount).toBe('6.00');
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

    it('refuses a row with nothing chosen, no amount, a bad amount or reversed dates', () => {
        expect(problemKinds([entry({ item: null })])).toEqual({ a: ['noItem'] });
        expect(problemKinds([entry({ amount: '' })])).toEqual({ a: ['noAmount'] });
        // A confirmed price of nothing is not a price.
        expect(problemKinds([entry({ amount: '0.00' })])).toEqual({ a: ['noAmount'] });
        expect(problemKinds([entry({ amount: '5.505' })])).toEqual({ a: ['badAmount'] });
        expect(problemKinds([entry({ priceStatus: 'market_priced', amount: '5.50' })])).toEqual({
            a: ['amountNotAllowed'],
        });
        expect(problemKinds([entry({ effectiveUntil: '2026-07-01' })])).toEqual({
            a: ['reversed'],
        });

        // Every reason a row has, in the order its note reads them.
        expect(
            problemKinds([entry({ item: null, amount: '', effectiveUntil: '2026-07-01' })]),
        ).toEqual({ a: ['noItem', 'noAmount', 'reversed'] });

        expect(priceEntryProblems([entry()], 'USD').size).toBe(0);
    });

    it('counts two packs of one product as two prices, and one pack twice as an overlap', () => {
        const productId = '01935f6d-0000-7000-8000-00000000b000' as never;
        const trayRow = entry({
            key: 'a',
            item: { kind: 'product', productId, packCode: 'TRAY' },
        });
        const singleRow = entry({
            key: 'b',
            item: { kind: 'product', productId, packCode: 'SINGLE' },
        });
        expect(priceEntryProblems([trayRow, singleRow], 'USD').size).toBe(0);

        // Both open-ended from the same day: each row names the other.
        const again = entry({ key: 'c', item: { kind: 'product', productId, packCode: 'TRAY' } });
        expect(problemKinds([trayRow, again])).toEqual({ a: ['overlap'], c: ['overlap'] });

        // A hand-over is not an overlap: the old price ends the day before the new one starts.
        expect(
            priceEntryProblems(
                [
                    { ...trayRow, effectiveUntil: '2026-10-31' },
                    { ...again, effectiveFrom: '2026-11-01' },
                ],
                'USD',
            ).size,
        ).toBe(0);
        // …and starting on the old price's last day is.
        expect(
            problemKinds([
                { ...trayRow, effectiveUntil: '2026-10-31' },
                { ...again, effectiveFrom: '2026-10-31' },
            ]),
        ).toEqual({ a: ['overlap'], c: ['overlap'] });

        // The *base* key ignores the pack; the exact key is what an overlap compares.
        expect(priceItemBaseKey(trayRow.item!)).toBe(priceItemBaseKey(singleRow.item!));
        expect(priceItemKey(trayRow.item!)).not.toBe(priceItemKey(singleRow.item!));
    });

    it('counts edits, additions and removals against the list as it was read', () => {
        const saved = [
            entry({ key: 'a', amount: '5.50' }),
            entry({ key: 'b', item: { kind: 'meal', mealId: 'm2' as never } }),
        ];
        const baseline = new Map(saved.map((row) => [row.key, row]));

        // Retyping a figure as the same figure is not a change.
        expect(
            summarisePriceChanges([entry({ key: 'a', amount: '5.5' }), saved[1]!], baseline, 'USD'),
        ).toEqual({ edited: 0, added: 0, removed: 0, total: 0 });

        expect(
            summarisePriceChanges(
                [entry({ key: 'a', amount: '6.00' }), entry({ key: 'c', item: null })],
                baseline,
                'USD',
            ),
        ).toEqual({ edited: 1, added: 1, removed: 1, total: 3 });
    });

    it('moves the selected confirmed prices by a percentage, to the nearest 0.05', () => {
        const rows = [
            entry({ key: 'a', amount: '2.50' }),
            entry({ key: 'b', priceStatus: 'placeholder', amount: '' }),
            entry({ key: 'c', amount: '3.00' }),
        ];

        const raised = adjustConfirmedPrices(rows, new Set(['a', 'b']), 10, 'USD');
        // Only the confirmed row moves; the pending one has no figure, the unselected one is left.
        expect(raised.changed).toBe(1);
        expect(raised.rows.map((row) => row.amount)).toEqual(['2.75', '', '3.00']);

        // 2.50 × 1.07 is 2.675, which rounds to 2.70 rather than to a figure nobody would charge.
        expect(adjustConfirmedPrices(rows, new Set(['a']), 7, 'USD').rows[0]?.amount).toBe('2.70');
        expect(adjustConfirmedPrices(rows, new Set(['c']), -5, 'USD').rows[2]?.amount).toBe('2.85');

        expect(priceRoundingStep('USD')).toBe(5);
        expect(priceRoundingStep('KWD')).toBe(50);
    });

    it('names what is on sale without an entry, counting a whole-product row as covering its packs', () => {
        const productId = '01935f6d-0000-7000-8000-00000000b000' as never;
        const pack = (code: string) => ({
            key: priceItemKey({ kind: 'product', productId, packCode: code }),
            label: code,
            item: { kind: 'product' as const, productId, packCode: code },
        });
        const sauce: PriceItemOption = {
            key: priceItemBaseKey({ kind: 'product', productId, packCode: null }),
            kind: 'product',
            group: 'sauce',
            label: 'Garlic Mayo',
            code: 'PRD-0105',
            defaultItem: { kind: 'product', productId, packCode: null },
            variants: [pack('250 g'), pack('500 g')],
            onSale: true,
        };
        const retired: PriceItemOption = {
            key: priceItemBaseKey(mealRef(9)),
            kind: 'meal',
            group: 'meal',
            label: 'Retired meal',
            code: null,
            defaultItem: mealRef(9),
            variants: [],
            onSale: false,
        };

        // One pack priced: the other is still missing. The meal is not on sale, so it is not.
        expect(
            uncoveredUnits(
                [sauce, retired],
                [entry({ item: { kind: 'product', productId, packCode: '250 g' } })],
            ).map((unit) => unit.pack),
        ).toEqual(['500 g']);

        // A price on the product as a whole covers every pack.
        expect(
            uncoveredUnits(
                [sauce],
                [entry({ item: { kind: 'product', productId, packCode: null } })],
            ),
        ).toEqual([]);
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
        // Two entries, both confirmed: "2 entries · 2 confirmed", the two facts the cell carries.
        expect(screen.getByTestId(`${base}-entries`)).toHaveTextContent(/2 entries · 2 confirmed/);
        expect(screen.getByTestId(`${base}-status`)).toBeTruthy();
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
        expect(screen.getByTestId(`${base}-entries`)).toHaveTextContent(/2 entries · 0 confirmed/);
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

    it('puts a sort or a filter on every column header', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');

        for (const key of ['name', 'currency', 'channels', 'entries', 'status', 'updatedAt']) {
            expect(screen.getByTestId(`kitchen-price-lists-column-${key}-trigger`)).toBeTruthy();
        }
    });

    it('filters by channel from the Channels header, through the request', async () => {
        const listPriceLists = jest.fn(priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]));
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listPriceLists } },
        });
        await untilVisible('kitchen-price-lists-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-lists-column-channels-trigger'));
        });
        // Every channel the platform declares, not only the three on the loaded page.
        await untilVisible('kitchen-price-lists-column-channels-pos');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-lists-column-channels-b2b'));
        });

        await waitFor(() => {
            // `some`: the earlier, unfiltered query key is still live and may refetch.
            expect(
                listPriceLists.mock.calls.some(
                    ([sent]) => sent?.channels?.includes('b2b') === true,
                ),
            ).toBe(true);
        });
        // One wait for both: the refetch passes through a loading frame with no rows at all.
        await waitFor(
            () => {
                expect(
                    screen.getByTestId(`kitchen-price-list-${String(UNPRICED_LIST.id)}-name`),
                ).toBeTruthy();
                expect(
                    screen.queryByTestId(`kitchen-price-list-${String(CONFIRMED_LIST.id)}-name`),
                ).toBeNull();
            },
            { timeout: 10_000 },
        );
    });

    it('sorts by confirmed prices from the Entries header', async () => {
        await renderStubScreen(<PriceListsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPriceLists: priceListListing(() => [CONFIRMED_LIST, UNPRICED_LIST]),
                },
            },
        });
        await untilVisible('kitchen-price-lists-table');

        const names = () =>
            screen
                .getAllByTestId(/^kitchen-price-list-.+-name$/)
                .map((node) => node.props.children as string);

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-lists-column-entries-trigger'));
        });
        await waitFor(() => {
            expect(names()).toEqual([UNPRICED_LIST.name.en, CONFIRMED_LIST.name.en]);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-lists-column-entries-trigger'));
        });
        await waitFor(() => {
            expect(names()).toEqual([CONFIRMED_LIST.name.en, UNPRICED_LIST.name.en]);
        });
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
        await renderStubScreen(<PriceListsScreen />, { session: organisationMemberSession() });

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

        expect(screen.getByTestId('kitchen-price-list-fact-currency-value')).toHaveTextContent(
            new RegExp(CONFIRMED_LIST.currency),
        );
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
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;
        expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe(
            minorAmountToInput(first.amountMinor ?? 0, CONFIRMED_LIST.currency),
        );
        expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('12.50');
    });

    it('clears and disables the amount when a row stops being a confirmed price', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('12.50');

        await chooseStatus(row, 'placeholder');

        // Emptied and closed in the same press, with the reason under it in words.
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('');
        });
        expect(screen.getByTestId(`${row}-amount-input`).props.editable).toBe(false);
        expect(screen.getByTestId(`${row}-no-amount`)).toHaveTextContent(/not on sale/i);

        await chooseStatus(row, 'market_priced');
        expect(screen.getByTestId(`${row}-no-amount`)).toHaveTextContent(/counter/i);

        // Confirmed again: the amount the list holds comes back, not a blank to retype.
        await chooseStatus(row, 'confirmed');
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('12.50');
        });
        expect(screen.getByTestId(`${row}-amount-input`).props.editable).not.toBe(false);
    });

    it('names an entry left without an amount when Save is pressed, and saves once it has one', async () => {
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
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        // Nothing is wrong until a save is tried: a field being emptied is a field being edited.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-amount-input`), '');
        });
        expect(screen.queryByTestId(`${row}-problems`)).toBeNull();

        await pressSave();

        await untilVisible('kitchen-price-list-editor-screen-issues-errors');
        expect(
            screen.getByTestId('kitchen-price-list-editor-screen-issues-errors'),
        ).toHaveTextContent(/1 entry needs fixing/i);
        expect(screen.getByTestId(`${row}-problems`)).toHaveTextContent(/needs an amount/i);
        expect(repositories.kitchenAdmin.setPriceListEntries).not.toHaveBeenCalled();

        // Fixed, and the note follows the edit rather than waiting for the next press.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-amount-input`), '5.50');
        });
        await waitFor(() => {
            expect(screen.queryByTestId(`${row}-problems`)).toBeNull();
        });

        await pressSave();
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setPriceListEntries).toHaveBeenCalledTimes(1);
        });
    });

    it('marks what changed, says what it was, and filters to it', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const [first, second] = CONFIRMED_LIST.entries;
        const firstRow = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first!.item)}`;
        const secondRow = `kitchen-price-list-entries-row-seed-1-${priceItemKey(second!.item)}`;

        expect(screen.queryByTestId('kitchen-price-list-save-bar')).toBeNull();

        // 12.50 → 13.75 is ten percent: the warning ink, not yet the red of fifteen.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${firstRow}-amount-input`), '13.75');
        });
        await untilVisible(`${firstRow}-changed`);
        expect(screen.getByTestId(`${firstRow}-was`)).toHaveTextContent('was 12.50 · +10%');
        // The figure is kept out of the tab's spoken name, so it is found among hidden elements.
        expect(
            screen.getByTestId('kitchen-price-list-filter-changed-count', {
                includeHiddenElements: true,
            }),
        ).toHaveTextContent('1');
        expect(screen.getByTestId('kitchen-price-list-changes-title')).toHaveTextContent(
            /1 change not saved/i,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-filter-changed'));
        });
        expect(screen.getByTestId(firstRow)).toBeTruthy();
        expect(screen.queryByTestId(secondRow)).toBeNull();

        // Typed back to what it was, it is no longer a change, and the bar goes with it.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${firstRow}-amount-input`), '12.5');
        });
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-price-list-save-bar')).toBeNull();
        });
    });

    it('changes the selected confirmed prices by a percentage', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => CONFIRMED_LIST),
        });
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-select-control`));
        });
        // The toolbar becomes the bulk bar while anything is selected.
        await untilVisible('kitchen-price-list-selected-count');
        expect(screen.queryByTestId('kitchen-price-list-add-entry')).toBeNull();

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-price-list-bulk-percent-input'), '10');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-bulk-apply'));
        });

        await waitFor(() => {
            expect(screen.getByTestId(`${row}-amount-input`).props.value).toBe('13.75');
        });
        // The selection is spent, and the toolbar is the toolbar again.
        await untilVisible('kitchen-price-list-add-entry');
    });

    it('offers what is on sale and unpriced, and adds it as pending', async () => {
        const onSale = (ordinal: number) =>
            meal(ordinal, {
                channelAvailability: [
                    {
                        channel: 'b2c',
                        isAvailable: true,
                        availableFrom: null,
                        availableUntil: null,
                    },
                ],
            });

        await renderStubScreen(<PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...catalogueReads(),
                    // Meals 1 and 2 are on the list; 3 and 4 are sold on its channel and are not.
                    listMeals: async () => page([1, 2, 3, 4].map(onSale)),
                    getPriceList: async () => CONFIRMED_LIST,
                },
            },
        });
        await openEntriesStep();

        await untilVisible('kitchen-price-list-gaps');
        expect(screen.getByTestId('kitchen-price-list-gaps-title')).toHaveTextContent(
            /2 items on sale have no entry/i,
        );
        expect(screen.getByTestId('kitchen-price-list-gaps-names')).toHaveTextContent(
            /Meal 3, Meal 4/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-gaps-add'));
        });

        // Two pending rows, no invented price, and nothing left to offer.
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-price-list-gaps')).toBeNull();
        });
        expect(
            screen.getByTestId('kitchen-price-list-filter-placeholder-count', {
                includeHiddenElements: true,
            }),
        ).toHaveTextContent('2');
        expect(screen.getByTestId('kitchen-price-list-changes-title')).toHaveTextContent(
            /2 changes not saved/i,
        );
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
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-amount-input`), '5.50');
        });
        await pressSave();

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
        await openEntriesStep();
        await untilVisible('kitchen-price-list-entries');

        const first = CONFIRMED_LIST.entries[0]!;
        const row = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await chooseStatus(row, 'placeholder');
        await pressSave();

        await waitFor(() => {
            const saved = stored.entries.find(
                (candidate) => priceItemKey(candidate.item) === priceItemKey(first.item),
            );
            expect(saved?.priceStatus).toBe('placeholder');
            expect(saved?.amountMinor).toBeNull();
            expect(isPriceEntryConsistent(saved!)).toBe(true);
        });
    });

    it('adds a row, removes one, and Discard puts the list back as it was read', async () => {
        const { repositories } = await renderStubScreen(
            <PriceListEditScreen priceList={String(CONFIRMED_LIST.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: editorReads(() => CONFIRMED_LIST),
            },
        );
        await openEntriesStep();
        await untilVisible('kitchen-price-list-add-entry');

        const first = CONFIRMED_LIST.entries[0]!;
        const firstRow = `kitchen-price-list-entries-row-seed-0-${priceItemKey(first.item)}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${firstRow}-remove`));
        });
        expect(screen.queryByTestId(firstRow)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        // A new row sits in its own group at the top, with a picker instead of a name.
        expect(screen.getByTestId('kitchen-price-list-entries-group-unchosen')).toBeTruthy();
        expect(screen.getByTestId('kitchen-price-list-entries-row-entry-1-item')).toBeTruthy();
        expect(screen.getByTestId('kitchen-price-list-changes-body')).toHaveTextContent(
            /1 added · 1 removed/,
        );

        // It prices nothing yet, so saving names it rather than sending a price for nothing.
        await pressSave();
        await untilVisible('kitchen-price-list-entries-row-entry-1-problems');
        expect(repositories.kitchenAdmin.setPriceListEntries).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-discard'));
        });
        await untilVisible(firstRow);
        expect(screen.queryByTestId('kitchen-price-list-entries-row-entry-1')).toBeNull();
        expect(screen.queryByTestId('kitchen-price-list-save-bar')).toBeNull();
        expect(screen.queryByTestId('kitchen-price-list-editor-screen-issues-errors')).toBeNull();
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
        await openEntriesStep();
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
        await pressSave();

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
        await openEntriesStep();
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
        await openEntriesStep();
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
        await openEntriesStep();
        await untilVisible('kitchen-price-list-add-entry');

        expect(
            screen.getByTestId('kitchen-price-list-publish').props.accessibilityState?.disabled,
        ).not.toBe(true);

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        // Publish waits for the save bar: it would publish what the server holds, not the screen.
        await untilVisible('kitchen-price-list-save-bar');
        expect(
            screen.getByTestId('kitchen-price-list-publish').props.accessibilityState?.disabled,
        ).toBe(true);
    });

    it('says a draft is not charged yet, and saves it as a draft', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(UNPRICED_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: editorReads(() => UNPRICED_LIST),
        });
        await openEntriesStep();
        await untilVisible('kitchen-price-list-draft-note');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        expect(screen.getByTestId('kitchen-price-list-editor-screen-save')).toHaveTextContent(
            /save draft/i,
        );
        expect(screen.getByTestId('kitchen-price-list-changes-body')).toHaveTextContent(
            /stays a draft/i,
        );
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
        await openEntriesStep();
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

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-price-list-status')).toHaveTextContent(/published/i);
        });
        // A published list has no second publish control to press, and no draft notice.
        expect(screen.queryByTestId('kitchen-price-list-publish')).toBeNull();
        expect(screen.queryByTestId('kitchen-price-list-draft-note')).toBeNull();

        // Its save now charges customers, and the button says so.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-price-list-add-entry'));
        });
        expect(screen.getByTestId('kitchen-price-list-editor-screen-save')).toHaveTextContent(
            /save and charge/i,
        );
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
        await openEntriesStep();
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
