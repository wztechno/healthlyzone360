import type {
    LastPurchase,
    StockItem,
    SuppliedItem,
    Supplier,
    SupplierContact,
    SupplierDetail,
    SupplierFilter,
} from '@healthy360/api-client/contracts';
import {
    GoodsReceiptId,
    StockItemId,
    SupplierContactId,
    SupplierId,
} from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { kitchenManagerSession, testActiveContext } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    suppliedItemRowTestId,
    supplierContactRowTestId,
    supplierRowTestId,
} from './ops-format.ts';
import { SupplierDetailScreen } from './screens/supplier-detail-screen.tsx';
import { SuppliersScreen } from './screens/suppliers-screen.tsx';

/**
 * The supplier book and the supplier record (SUP1), against a world this file authors.
 *
 * Nothing here stubs a hook: every supplier below is declared in this file and handed to
 * `renderStubScreen`, so a repository method a screen reaches for and this file did not declare
 * rejects with `StubNotConfiguredError` naming it rather than rendering an empty state over a hole.
 *
 * Five things this file exists to prove:
 *
 * 1. **The book renders what a person needs to act on** — the name in their own language, the code
 *    under it, and who to call, taken from the row's own summary rather than a per-row fetch.
 * 2. **Search covers both languages and the code.** A manager reading Arabic types the English name
 *    off the invoice in front of them; a book that only searched the displayed name would hide
 *    exactly the supplier they were looking at.
 * 3. **The archive filter is a refetch, not a client-side hide.** The chip has to reach the
 *    repository with `includeArchived`, because the server excludes archived rows by default.
 * 4. **Contacts save once, for the whole set.** Adding a card, editing it and promoting it to
 *    primary must produce exactly one `replaceSupplierContacts` call carrying the whole set — a
 *    per-card save would delete the card beside it.
 * 5. **An archived supplier is read-only and offers Restore.** Locking the form is what stops a
 *    person from typing into a record the server would refuse to write.
 * 6. **The three price states stay three** (SUP2). Hidden, an actual price and *not bought here
 *    yet* are three different facts; collapsing the first two would tell somebody without the cost
 *    permission that a weekly supplier has never sold them anything.
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
        usePathname: () => '/kitchen/suppliers',
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
 * ---------------------------------------------------------------------------------------------- */

/** UUID-shaped, because the detail screen parses its route parameter with `SupplierId`. */
function supplierId(ordinal: number): SupplierId {
    return SupplierId.unsafe(`01935f6d-0000-7000-8000-00000000b00${String(ordinal)}`);
}

function contactId(ordinal: number): SupplierContactId {
    return SupplierContactId.unsafe(`01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`);
}

function supplier(ordinal: number, overrides: Partial<Supplier> = {}): Supplier {
    return {
        id: supplierId(ordinal),
        code: `SUP-0${String(ordinal)}`,
        name: { en: `Supplier ${String(ordinal)}`, ar: `مورّد ${String(ordinal)}` },
        currencyCode: 'USD',
        contactEmail: null,
        contactPhone: null,
        address: null,
        paymentTerms: null,
        leadTimeDays: null,
        notes: null,
        archivedAt: null,
        contactCount: 0,
        suppliedItemCount: 0,
        primaryContact: null,
        ...overrides,
    };
}

function stockItemId(ordinal: number): StockItemId {
    return StockItemId.unsafe(`01935f6d-0000-7000-8000-00000000d00${String(ordinal)}`);
}

function stockItem(ordinal: number, overrides: Partial<StockItem> = {}): StockItem {
    return {
        id: stockItemId(ordinal),
        code: `ITM-0${String(ordinal)}`,
        nameEn: `Item ${String(ordinal)}`,
        unitCode: 'kg',
        ingredientId: null,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: false,
        hasHistory: false,
        ...overrides,
    };
}

function lastPurchase(overrides: Partial<LastPurchase> = {}): LastPurchase {
    return {
        goodsReceiptId: GoodsReceiptId.unsafe('01935f6d-0000-7000-8000-00000000e001'),
        documentRef: 'DN-2001',
        receivedAt: '2026-08-10T09:00:00.000Z',
        quantity: '10.0000',
        unitId: null,
        unitCode: 'kg',
        unitPriceAmount: '2.500000',
        costCurrencyCode: 'USD',
        ...overrides,
    };
}

function suppliedItem(ordinal: number, overrides: Partial<SuppliedItem> = {}): SuppliedItem {
    return {
        stockItem: {
            id: stockItemId(ordinal),
            code: `ITM-0${String(ordinal)}`,
            nameEn: `Item ${String(ordinal)}`,
            unitCode: 'kg',
            backing: 'ingredient',
        },
        isPreferred: false,
        supplierItemRef: null,
        lastPurchase: null,
        ...overrides,
    };
}

function contact(ordinal: number, overrides: Partial<SupplierContact> = {}): SupplierContact {
    return {
        id: contactId(ordinal),
        name: `Contact ${String(ordinal)}`,
        roleTitle: null,
        email: null,
        phone: `+961 3 000 00${String(ordinal)}`,
        whatsappPhone: null,
        isPrimary: false,
        displayOrder: ordinal - 1,
        ...overrides,
    };
}

const GULF = supplier(1, {
    code: 'GULF-01',
    name: { en: 'Gulf Fresh Trading', ar: 'الخليج الطازج للتجارة' },
    paymentTerms: 'Net 30',
    leadTimeDays: 2,
    contactCount: 1,
    primaryContact: { name: 'Samir Haddad', phone: '+961 3 111 222' },
});

const BEKAA = supplier(2, {
    code: 'BEKAA-01',
    name: { en: 'Bekaa Farms', ar: 'مزارع البقاع' },
    contactPhone: '+961 8 500 400',
});

const RETIRED = supplier(3, {
    code: 'OLD-01',
    name: { en: 'Old Wholesaler', ar: 'تاجر الجملة السابق' },
    archivedAt: '2026-07-01T09:00:00.000Z',
});

const GULF_DETAIL: SupplierDetail = {
    ...GULF,
    address: 'Gate 4, behind the cold store',
    contacts: [contact(1, { name: 'Samir Haddad', phone: '+961 3 111 222', isPrimary: true })],
    suppliedItems: [],
    costsRedacted: false,
};

/**
 * The three price states in one detail, so one render can prove they render three different ways:
 * a priced preferred link, a link this supplier has never sold at a price, and a link whose money
 * the server redacted.
 */
const GULF_WITH_ITEMS: SupplierDetail = {
    ...GULF_DETAIL,
    suppliedItemCount: 3,
    suppliedItems: [
        suppliedItem(1, {
            isPreferred: true,
            supplierItemRef: 'GF-FLOUR-25',
            lastPurchase: lastPurchase(),
        }),
        suppliedItem(2),
        suppliedItem(3, {
            lastPurchase: lastPurchase({ unitPriceAmount: null, costCurrencyCode: null }),
        }),
    ],
};

/**
 * The list read, narrowed by the filter the screen actually sends — so a test asserting the archive
 * chip is asserting a round trip rather than a client-side filter that happens to look right.
 */
function listSuppliers(filter: SupplierFilter = {}): readonly Supplier[] {
    return filter.includeArchived === true ? [BEKAA, GULF, RETIRED] : [BEKAA, GULF];
}

function bookOverrides(extra: RepositoryOverrides['kitchenOps'] = {}): RepositoryOverrides {
    return {
        kitchenOps: {
            listSuppliers: async (filter?: SupplierFilter) => listSuppliers(filter ?? {}),
            ...extra,
        },
    };
}

/* ------------------------------------------------------------------------------------------------
 * The book
 * ---------------------------------------------------------------------------------------------- */

describe('suppliers list', () => {
    it('renders each supplier with its code and who to call', async () => {
        await renderStubScreen(<SuppliersScreen />, {
            session: kitchenManagerSession(),
            repositories: bookOverrides(),
        });

        await untilVisible('kitchen-suppliers-table');

        const gulf = supplierRowTestId(String(GULF.id));
        expect(screen.getByTestId(`${gulf}-name`)).toHaveTextContent('Gulf Fresh Trading');
        expect(screen.getByTestId(`${gulf}-code`)).toHaveTextContent('GULF-01');
        expect(screen.getByTestId(`${gulf}-contact-name`)).toHaveTextContent('Samir Haddad');

        // A supplier with no named person falls back to the office line rather than saying nothing.
        expect(screen.getByTestId(`${supplierRowTestId(String(BEKAA.id))}-contact`)).toBeTruthy();

        // Archived rows are absent until asked for.
        expect(screen.queryByTestId(`${supplierRowTestId(String(RETIRED.id))}-name`)).toBeNull();
    });

    it('searches the English name, the Arabic name and the code', async () => {
        await renderStubScreen(<SuppliersScreen />, {
            session: kitchenManagerSession(),
            repositories: bookOverrides(),
        });

        await untilVisible('kitchen-suppliers-table');
        const search = screen.getByTestId('kitchen-suppliers-search-input');

        fireEvent.changeText(search, 'bekaa');
        await waitFor(() => {
            expect(screen.queryByTestId(`${supplierRowTestId(String(GULF.id))}-name`)).toBeNull();
        });
        expect(screen.getByTestId(`${supplierRowTestId(String(BEKAA.id))}-name`)).toBeTruthy();

        // The Arabic name, typed by somebody reading the English interface.
        fireEvent.changeText(search, 'الخليج');
        await waitFor(() => {
            expect(screen.getByTestId(`${supplierRowTestId(String(GULF.id))}-name`)).toBeTruthy();
        });
        expect(screen.queryByTestId(`${supplierRowTestId(String(BEKAA.id))}-name`)).toBeNull();

        // And the code.
        fireEvent.changeText(search, 'GULF-01');
        await waitFor(() => {
            expect(screen.getByTestId(`${supplierRowTestId(String(GULF.id))}-name`)).toBeTruthy();
        });

        fireEvent.changeText(search, 'nothing matches this');
        await untilVisible('kitchen-suppliers-empty');
    });

    it('asks the repository for archived rows when the filter is turned on', async () => {
        const { repositories } = await renderStubScreen(<SuppliersScreen />, {
            session: kitchenManagerSession(),
            repositories: bookOverrides(),
        });

        await untilVisible('kitchen-suppliers-table');
        expect(repositories.kitchenOps.listSuppliers).toHaveBeenCalledWith({});

        fireEvent.press(screen.getByTestId('kitchen-suppliers-archived-filter'));

        await waitFor(() => {
            expect(repositories.kitchenOps.listSuppliers).toHaveBeenCalledWith({
                includeArchived: true,
            });
        });

        // The archived row arrives, and says so.
        await untilVisible(`${supplierRowTestId(String(RETIRED.id))}-archived`);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The record
 * ---------------------------------------------------------------------------------------------- */

describe('supplier detail', () => {
    it('renders both sections, seeded from the record', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(GULF.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getSupplier: async () => GULF_DETAIL } },
        });

        await untilVisible('kitchen-supplier-details');

        expect(screen.getByTestId('kitchen-supplier-name-en-input').props.value).toBe(
            'Gulf Fresh Trading',
        );
        expect(screen.getByTestId('kitchen-supplier-name-ar-input').props.value).toBe(
            'الخليج الطازج للتجارة',
        );
        expect(screen.getByTestId('kitchen-supplier-code-input').props.value).toBe('GULF-01');
        expect(screen.getByTestId('kitchen-supplier-payment-terms-input').props.value).toBe(
            'Net 30',
        );
        expect(screen.getByTestId('kitchen-supplier-lead-time-input').props.value).toBe('2');
        // Displayed, never picked — every purchase is booked in one currency.
        expect(screen.getByTestId('kitchen-supplier-currency-value')).toHaveTextContent('USD');

        expect(screen.getByTestId('kitchen-supplier-contacts')).toBeTruthy();
        const card = supplierContactRowTestId(String(contactId(1)));
        expect(screen.getByTestId(`${card}-name-input`).props.value).toBe('Samir Haddad');
        expect(screen.getByTestId(`${card}-primary-badge`)).toBeTruthy();
    });

    it('refuses a lead time the server would refuse, before the save is offered', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(GULF.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getSupplier: async () => GULF_DETAIL } },
        });

        await untilVisible('kitchen-supplier-details');

        fireEvent.changeText(screen.getByTestId('kitchen-supplier-lead-time-input'), '400');
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-supplier-screen-save').props.accessibilityState,
            ).toMatchObject({ disabled: true });
        });
    });

    it('saves the details section on its own', async () => {
        const { repositories } = await renderStubScreen(
            <SupplierDetailScreen supplier={String(GULF.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        getSupplier: async () => GULF_DETAIL,
                        updateSupplier: async () => ({ ...GULF, paymentTerms: 'Net 45' }),
                    },
                },
            },
        );

        await untilVisible('kitchen-supplier-details');

        fireEvent.changeText(screen.getByTestId('kitchen-supplier-payment-terms-input'), 'Net 45');
        fireEvent.press(screen.getByTestId('kitchen-supplier-screen-save'));

        await waitFor(() => {
            expect(repositories.kitchenOps.updateSupplier).toHaveBeenCalledWith(
                GULF.id,
                expect.objectContaining({ paymentTerms: 'Net 45', leadTimeDays: 2 }),
            );
        });

        // The contact set was not touched by a details save.
        expect(repositories.kitchenOps.replaceSupplierContacts).not.toHaveBeenCalled();
    });

    it('adds, edits and promotes a contact, then saves the whole set exactly once', async () => {
        const saved: readonly SupplierContact[] = [
            contact(1, { name: 'Samir Haddad', phone: '+961 3 111 222', isPrimary: false }),
            contact(2, { name: 'Nadia Aoun', phone: '+961 70 999 888', isPrimary: true }),
        ];

        const { repositories } = await renderStubScreen(
            <SupplierDetailScreen supplier={String(GULF.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        getSupplier: async () => GULF_DETAIL,
                        replaceSupplierContacts: async () => saved,
                    },
                },
            },
        );

        await untilVisible('kitchen-supplier-contacts');

        fireEvent.press(screen.getByTestId('kitchen-supplier-contacts-add'));

        const added = supplierContactRowTestId('new-1');
        await untilVisible(`${added}-name-input`);

        // A card with no channel is refused here, where it can still be fixed.
        fireEvent.changeText(screen.getByTestId(`${added}-name-input`), 'Nadia Aoun');
        await untilVisible(`${added}-error`);

        fireEvent.changeText(screen.getByTestId(`${added}-phone-input`), '+961 70 999 888');
        await waitFor(() => {
            expect(screen.queryByTestId(`${added}-error`)).toBeNull();
        });

        fireEvent.press(screen.getByTestId(`${added}-make-primary`));

        fireEvent.press(screen.getByTestId('kitchen-supplier-contacts-save'));

        await waitFor(() => {
            expect(repositories.kitchenOps.replaceSupplierContacts).toHaveBeenCalledTimes(1);
        });

        expect(repositories.kitchenOps.replaceSupplierContacts).toHaveBeenCalledWith(GULF.id, {
            contacts: [
                expect.objectContaining({
                    id: contactId(1),
                    name: 'Samir Haddad',
                    // Promoting the new card cleared the flag on the old one in the same edit: the
                    // server refuses a set with two primaries, so the screen must not build one.
                    isPrimary: false,
                    displayOrder: 0,
                }),
                expect.objectContaining({
                    name: 'Nadia Aoun',
                    phone: '+961 70 999 888',
                    isPrimary: true,
                    displayOrder: 1,
                }),
            ],
        });

        // And a details save was never fired by the contacts button.
        expect(repositories.kitchenOps.updateSupplier).not.toHaveBeenCalled();
    });

    it('locks an archived supplier and offers Restore instead of Save', async () => {
        const archivedDetail: SupplierDetail = {
            ...RETIRED,
            contacts: [contact(1)],
            suppliedItems: [],
            costsRedacted: false,
        };

        await renderStubScreen(<SupplierDetailScreen supplier={String(RETIRED.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getSupplier: async () => archivedDetail } },
        });

        await untilVisible('kitchen-supplier-archived');

        expect(screen.getByTestId('kitchen-supplier-restore')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-supplier-archive')).toBeNull();
        expect(screen.queryByTestId('kitchen-supplier-screen-save')).toBeNull();
        expect(screen.queryByTestId('kitchen-supplier-contacts-save')).toBeNull();
        expect(screen.queryByTestId('kitchen-supplier-contacts-add')).toBeNull();

        // Every field is locked rather than merely unsaveable.
        expect(screen.getByTestId('kitchen-supplier-code-input').props.editable).toBe(false);
    });

    it('shows the designed not-found state for a parameter that is not an identifier', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier="not-a-uuid" />, {
            session: kitchenManagerSession(),
        });

        await untilVisible('kitchen-supplier-not-found');
    });
});

/* ------------------------------------------------------------------------------------------------
 * What you buy here (SUP2)
 * ---------------------------------------------------------------------------------------------- */

describe('supplied items', () => {
    /** The links, the shelves the picker offers, and a stubbed upsert/delete pair. */
    function itemOverrides(extra: RepositoryOverrides['kitchenOps'] = {}): RepositoryOverrides {
        return {
            kitchenOps: {
                getSupplier: async () => GULF_WITH_ITEMS,
                listStockItems: async () => [
                    stockItem(1),
                    stockItem(2),
                    stockItem(3),
                    stockItem(4),
                ],
                ...extra,
            },
        };
    }

    it('renders the three price states as three different cells', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(GULF.id)} />, {
            session: kitchenManagerSession(),
            repositories: itemOverrides(),
        });

        await untilVisible('kitchen-supplier-items-table');

        // 1. A real price, with its currency and its unit — 2.50 alone is not a price.
        const priced = suppliedItemRowTestId(String(stockItemId(1)));
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent('2.50');
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent('USD');
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent('kg');
        expect(screen.getByTestId(`${priced}-preferred`)).toBeTruthy();
        expect(screen.getByTestId(`${priced}-ref`)).toHaveTextContent('GF-FLOUR-25');

        // 2. Linked but never bought here — not the same cell as hidden.
        const unbought = suppliedItemRowTestId(String(stockItemId(2)));
        expect(screen.getByTestId(`${unbought}-never-bought`)).toBeTruthy();
        expect(screen.queryByTestId(`${unbought}-price-hidden`)).toBeNull();

        // 3. Bought, but the money was redacted — the date survives, the amount does not.
        const hidden = suppliedItemRowTestId(String(stockItemId(3)));
        expect(screen.getByTestId(`${hidden}-price-hidden`)).toBeTruthy();
        expect(screen.queryByTestId(`${hidden}-price`)).toBeNull();
        expect(screen.queryByTestId(`${hidden}-never-bought`)).toBeNull();
    });

    it('offers Make preferred only where it would change something, and sends the flag', async () => {
        const { repositories } = await renderStubScreen(
            <SupplierDetailScreen supplier={String(GULF.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: itemOverrides({
                    upsertSupplierLink: async () => ({
                        supplierId: GULF.id,
                        stockItemId: stockItemId(2),
                        isPreferred: true,
                        supplierItemRef: null,
                    }),
                }),
            },
        );

        await untilVisible('kitchen-supplier-items-table');

        // The row that already holds the flag does not offer to set it again.
        expect(
            screen.queryByTestId(`${suppliedItemRowTestId(String(stockItemId(1)))}-make-preferred`),
        ).toBeNull();

        fireEvent.press(
            screen.getByTestId(`${suppliedItemRowTestId(String(stockItemId(2)))}-make-preferred`),
        );

        await waitFor(() => {
            expect(repositories.kitchenOps.upsertSupplierLink).toHaveBeenCalledWith({
                supplierId: GULF.id,
                stockItemId: stockItemId(2),
                isPreferred: true,
            });
        });

        // The reference was not touched: an omitted field is left alone, never cleared.
        expect(repositories.kitchenOps.upsertSupplierLink).not.toHaveBeenCalledWith(
            expect.objectContaining({ supplierItemRef: expect.anything() }),
        );
    });

    it('leaves already-linked items out of the picker and links the one chosen', async () => {
        const { repositories } = await renderStubScreen(
            <SupplierDetailScreen supplier={String(GULF.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: itemOverrides({
                    upsertSupplierLink: async () => ({
                        supplierId: GULF.id,
                        stockItemId: stockItemId(4),
                        isPreferred: false,
                        supplierItemRef: 'GF-4',
                    }),
                }),
            },
        );

        await untilVisible('kitchen-supplier-item-picker');

        fireEvent.press(screen.getByTestId('kitchen-supplier-item-picker'));

        // Items 1–3 are already linked; only the fourth is offerable.
        await waitFor(() => {
            expect(
                screen.getByTestId(`kitchen-supplier-item-picker-option-${String(stockItemId(4))}`),
            ).toBeTruthy();
        });
        expect(
            screen.queryByTestId(`kitchen-supplier-item-picker-option-${String(stockItemId(1))}`),
        ).toBeNull();

        fireEvent.press(
            screen.getByTestId(`kitchen-supplier-item-picker-option-${String(stockItemId(4))}`),
        );

        fireEvent.changeText(screen.getByTestId('kitchen-supplier-link-ref-input'), 'GF-4');
        fireEvent.press(screen.getByTestId('kitchen-supplier-item-link'));

        await waitFor(() => {
            expect(repositories.kitchenOps.upsertSupplierLink).toHaveBeenCalledWith({
                supplierId: GULF.id,
                stockItemId: stockItemId(4),
                supplierItemRef: 'GF-4',
            });
        });
    });

    it('unlinks only after the confirmation, and by the identifying pair', async () => {
        const { repositories } = await renderStubScreen(
            <SupplierDetailScreen supplier={String(GULF.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: itemOverrides({ deleteSupplierLink: async () => undefined }),
            },
        );

        await untilVisible('kitchen-supplier-items-table');

        fireEvent.press(
            screen.getByTestId(`${suppliedItemRowTestId(String(stockItemId(2)))}-unlink`),
        );

        await untilVisible('kitchen-supplier-unlink-dialog');
        expect(repositories.kitchenOps.deleteSupplierLink).not.toHaveBeenCalled();

        fireEvent.press(screen.getByTestId('kitchen-supplier-unlink-confirm'));

        await waitFor(() => {
            expect(repositories.kitchenOps.deleteSupplierLink).toHaveBeenCalledWith({
                supplierId: GULF.id,
                stockItemId: stockItemId(2),
            });
        });
    });

    it('hides the ledger link and the writes from a reader who holds neither code', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(GULF.id)} />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({
                    permissions: ['organisation.view_current', 'inventory.view_organisation'],
                }),
            }),
            repositories: { kitchenOps: { getSupplier: async () => GULF_WITH_ITEMS } },
        });

        await untilVisible('kitchen-supplier-items-table');

        // Read-only: no picker, no row actions, and no link into a ledger that would refuse them.
        expect(screen.queryByTestId('kitchen-supplier-item-picker')).toBeNull();
        expect(screen.queryByTestId('kitchen-supplier-item-link')).toBeNull();
        expect(screen.queryByTestId('kitchen-supplier-see-ledger')).toBeNull();
        expect(
            screen.queryByTestId(`${suppliedItemRowTestId(String(stockItemId(2)))}-unlink`),
        ).toBeNull();

        // And every price reads as hidden rather than as a price or as never bought.
        expect(
            screen.getByTestId(`${suppliedItemRowTestId(String(stockItemId(1)))}-price-hidden`),
        ).toBeTruthy();
    });
});
