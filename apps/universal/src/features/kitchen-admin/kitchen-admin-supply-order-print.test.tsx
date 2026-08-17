import type {
    CursorPage,
    PurchaseOrder,
    PurchaseOrderFilter,
    PurchaseOrderLine,
    RecipientSnapshot,
} from '@healthy360/api-client/contracts';
import { Text } from '@healthy360/design-system';
import { BranchId, PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { printSheetTestId } from './ops-format.ts';
import { usePrintSheet } from './print-sheet.tsx';
import { SupplyOrderPrintScreen } from './screens/supply-order-print-screen.tsx';

/**
 * `/kitchen/supply-orders/print?orders=…` — the Phase 1 export (SUP7, §7), against a world this
 * file authors.
 *
 * Nothing here stubs a hook. Every order below is declared in this file and handed to
 * `renderStubScreen`, so a repository method the screen reaches for and this file did not declare
 * rejects with `StubNotConfiguredError` naming it rather than quietly rendering an empty document.
 *
 * Seven things this file exists to prove:
 *
 * 1. **One sheet per order, in the order the link asked for.** The endpoint answers newest-first
 *    and the query string is a sequence somebody chose; the page follows the person.
 * 2. **One read, whatever the count.** The batch is a single `listPurchaseOrders({ ids })` call —
 *    a waterfall of one query per identifier is the failure this asserts against.
 * 3. **A draft is marked, and says the recipient is not frozen yet.** §3.5's "clear Draft marker".
 * 4. **An issued sheet reads the snapshot, not the live supplier.** The fixture deliberately gives
 *    the two different names and a different address: the sheet must show the frozen one, because
 *    the supplier is holding a copy of the frozen one.
 * 5. **Contacts print primary-first**, in the order the snapshot froze them.
 * 6. **The general office contact stands in when nobody is named** (§3.1's documented fallback).
 * 7. **A link naming nothing is a state, not a blank page** — and native says where printing lives
 *    instead of showing a button that would do nothing.
 *
 * And the standing rule underneath all seven: **no money renders**. The last test greps the whole
 * document for a price shape, which is the assertion §3.5's structural boundary exists to make
 * cheap.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace: jest.fn(),
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/supply-orders/print',
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

const BRANCH = BranchId.unsafe(String(TEST_BRANCH_ID));

function itemId(ordinal: number): StockItemId {
    return StockItemId.unsafe(`01935f6d-0000-7000-8000-00000000e00${String(ordinal)}`);
}

function purchaseOrderId(ordinal: number): PurchaseOrderId {
    return PurchaseOrderId.unsafe(`01935f6d-0000-7000-8000-00000000d00${String(ordinal)}`);
}

function orderLine(ordinal: number, overrides: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine {
    return {
        id: `01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`,
        stockItemId: itemId(ordinal),
        itemCode: `ITM-0${String(ordinal)}`,
        itemNameEn: `Item ${String(ordinal)}`,
        itemNameAr: null,
        quantity: '4.0000',
        receivedQuantity: '0.0000',
        outstandingQuantity: '4.0000',
        unitCode: 'kg',
        supplierItemRef: null,
        notes: null,
        displayOrder: ordinal - 1,
        ...overrides,
    };
}

/**
 * The recipient as it stood at issue — and deliberately **unlike** the live supplier below.
 *
 * "Supplier 1 as it was" against a live "Supplier 1 renamed since" is the whole point of the
 * snapshot: a supplier that changes its name or moves premises must not rewrite the document
 * somebody is already holding a copy of (§3.5).
 */
const SNAPSHOT: RecipientSnapshot = {
    supplierId: SupplierId.unsafe('01935f6d-0000-7000-8000-00000000f001'),
    code: 'SUP-01',
    nameEn: 'Supplier 1 as it was',
    nameAr: 'المورّد كما كان',
    address: 'Gate 4, behind the cold store',
    paymentTerms: 'Net 30',
    leadTimeDays: 2,
    contactEmail: 'office@supplier.test',
    contactPhone: '+96170000000',
    contacts: [
        {
            name: 'Samir',
            roleTitle: 'Sales',
            email: null,
            phone: '+96171111111',
            whatsappPhone: null,
            isPrimary: true,
        },
        {
            name: 'Rania',
            roleTitle: 'Accounts',
            email: 'rania@supplier.test',
            phone: null,
            whatsappPhone: '+96172222222',
            isPrimary: false,
        },
    ],
};

function purchaseOrder(ordinal: number, overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
    return {
        id: purchaseOrderId(ordinal),
        number: `PO-ABCDEF0${String(ordinal)}`,
        status: 'draft',
        branch: { id: BRANCH, name: 'Main kitchen' },
        supplier: {
            id: SupplierId.unsafe('01935f6d-0000-7000-8000-00000000f001'),
            code: 'SUP-01',
            // The *live* record, renamed since the order was issued. An issued sheet must never
            // show this; a draft preview shows exactly this.
            nameEn: 'Supplier 1 renamed since',
            nameAr: null,
            archivedAt: null,
        },
        recipientSnapshot: null,
        notes: null,
        lineCount: 1,
        issuedAt: null,
        receivedAt: null,
        closedAt: null,
        closeShortReason: null,
        cancelledAt: null,
        createdAt: '2026-08-17T09:00:00+00:00',
        lines: [orderLine(ordinal)],
        receipts: [],
        ...overrides,
    };
}

/** An issued order carrying the frozen document. */
function issuedOrder(ordinal: number, overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
    return purchaseOrder(ordinal, {
        status: 'issued',
        issuedAt: '2026-08-17T10:00:00+00:00',
        recipientSnapshot: SNAPSHOT,
        ...overrides,
    });
}

function page(orders: readonly PurchaseOrder[]): CursorPage<PurchaseOrder> {
    return { items: orders, nextCursor: null, hasMore: false, totalCount: null };
}

/**
 * The batch read, wired to answer **newest-first** rather than in request order.
 *
 * That is what the endpoint actually does — it is a keyset list — so a fixture that handed the
 * orders back in the requested sequence would make the screen's re-ordering untestable and let a
 * regression through unseen.
 */
function printOverrides(orders: readonly PurchaseOrder[], spy?: jest.Mock): RepositoryOverrides {
    return {
        kitchenOps: {
            listPurchaseOrders: async (filter?: PurchaseOrderFilter) => {
                spy?.(filter);
                const wanted = new Set((filter?.ids ?? []).map((id) => String(id)));
                const matched = orders.filter((order) => wanted.has(String(order.id)));
                return page([...matched].reverse());
            },
        },
    };
}

/**
 * The order numbers on the page, in the order they are laid out.
 *
 * Read off the `-number` field rather than off the sheet roots, because a sheet's own test id and
 * every id inside it share a prefix — `startsWith` would match the title, the branch and the rest,
 * and the "one sheet per order" claim would then be true of a page with no sheets on it at all.
 */
function sheetNumbers(): readonly string[] {
    return screen
        .getAllByTestId(/^kitchen-supply-print-sheet-.+-number$/)
        .map((node) => String(node.props.children));
}

/* ------------------------------------------------------------------------------------------------
 * The document
 * ---------------------------------------------------------------------------------------------- */

describe('supply order print', () => {
    it('renders one sheet per order, in the order the link asked for, from one read', async () => {
        const spy = jest.fn();
        const first = issuedOrder(1);
        const second = issuedOrder(2, { number: 'PO-ABCDEF02' });
        const third = issuedOrder(3, { number: 'PO-ABCDEF03' });

        await renderStubScreen(
            <SupplyOrderPrintScreen
                orders={[first, second, third].map((order) => String(order.id)).join(',')}
            />,
            {
                session: kitchenManagerSession(),
                repositories: printOverrides([first, second, third], spy),
            },
        );

        await untilVisible('kitchen-supply-print-sheets');

        // One sheet per order, keyed by the order rather than by the supplier — all three are for
        // the same supplier here, which is exactly the case a supplier-keyed id would collide on.
        expect(sheetNumbers()).toEqual([first.number, second.number, third.number]);
        expect(screen.getByTestId(printSheetTestId(String(second.id)))).toBeTruthy();

        // One request, not three. The fixture answered newest-first, so the sequence above is the
        // screen's re-ordering rather than the repository's.
        expect(spy).toHaveBeenCalledTimes(1);
        expect(
            (spy.mock.calls[0]?.[0] as PurchaseOrderFilter | undefined)?.ids?.map(String),
        ).toEqual([String(first.id), String(second.id), String(third.id)]);

        expect(screen.getByTestId('kitchen-supply-print-count')).toBeTruthy();
    });

    it('marks a draft and says the recipient is captured at issue', async () => {
        const draft = purchaseOrder(1);

        await renderStubScreen(<SupplyOrderPrintScreen orders={String(draft.id)} />, {
            session: kitchenManagerSession(),
            repositories: printOverrides([draft]),
        });

        await untilVisible('kitchen-supply-print-sheets');

        const sheet = printSheetTestId(String(draft.id));

        // §3.5's "clear Draft marker" — a word in a box, not a rotated watermark overlay.
        expect(screen.getByTestId(`${sheet}-draft`)).toBeTruthy();
        expect(screen.getByTestId(`${sheet}-supplier-live`)).toBeTruthy();

        // A draft is addressed to nobody yet, so there is no frozen address or contact set to
        // reproduce — and the sheet says so rather than printing a document detail that does not
        // exist until Issue is pressed.
        expect(screen.queryByTestId(`${sheet}-supplier-address`)).toBeNull();
        expect(screen.queryByTestId(`${sheet}-contacts`)).toBeNull();

        // The live record is what a draft shows, name and all.
        expect(screen.getByTestId(`${sheet}-supplier-name`).props.children).toBe(
            'Supplier 1 renamed since',
        );
    });

    it('prints the snapshot on an issued order even after the supplier is renamed', async () => {
        const order = issuedOrder(1);

        await renderStubScreen(<SupplyOrderPrintScreen orders={String(order.id)} />, {
            session: kitchenManagerSession(),
            repositories: printOverrides([order]),
        });

        await untilVisible('kitchen-supply-print-sheets');

        const sheet = printSheetTestId(String(order.id));

        // The frozen name wins over the live one. This is the whole of §3.5 in one assertion: the
        // supplier is holding a copy of the February document, and February is what it says.
        expect(screen.getByTestId(`${sheet}-supplier-name`).props.children).toBe(
            'Supplier 1 as it was',
        );
        expect(screen.getByTestId(`${sheet}-supplier-address`).props.children).toBe(
            'Gate 4, behind the cold store',
        );
        expect(screen.getByTestId(`${sheet}-payment-terms`).props.children).toBe('Net 30');

        // No Draft marker, and no "as recorded now" note: this *is* the document.
        expect(screen.queryByTestId(`${sheet}-draft`)).toBeNull();
        expect(screen.queryByTestId(`${sheet}-supplier-live`)).toBeNull();
    });

    it('prints contacts primary-first, labelling a WhatsApp-only number', async () => {
        const order = issuedOrder(1);

        await renderStubScreen(<SupplyOrderPrintScreen orders={String(order.id)} />, {
            session: kitchenManagerSession(),
            repositories: printOverrides([order]),
        });

        await untilVisible('kitchen-supply-print-sheets');

        const sheet = printSheetTestId(String(order.id));

        // The order the snapshot froze them in, which the server froze primary-first (§7). Nothing
        // re-sorts it: the person meant to be rung first is the first line on the page.
        expect(String(screen.getByTestId(`${sheet}-contact-0`).props.children)).toContain('Samir');
        const second = String(screen.getByTestId(`${sheet}-contact-1`).props.children);
        expect(second).toContain('Rania');
        // A number a supplier only answers on WhatsApp is still a number to call — labelled, so
        // somebody dialling it off paper knows why it did not ring (§3.2 keeps the two apart).
        expect(second).toContain('WhatsApp');
    });

    it('falls back to the general office contact when nobody is named', async () => {
        const order = issuedOrder(1, {
            recipientSnapshot: { ...SNAPSHOT, contacts: [] },
        });

        await renderStubScreen(<SupplyOrderPrintScreen orders={String(order.id)} />, {
            session: kitchenManagerSession(),
            repositories: printOverrides([order]),
        });

        await untilVisible('kitchen-supply-print-sheets');

        const sheet = printSheetTestId(String(order.id));

        // §3.1: `contact_email` / `contact_phone` are the general office details and the documented
        // print fallback. A sheet with a Contacts heading and nothing under it would be worse.
        expect(screen.queryByTestId(`${sheet}-contacts`)).toBeNull();
        const general = String(screen.getByTestId(`${sheet}-supplier-general`).props.children);
        expect(general).toContain('+96170000000');
        expect(general).toContain('office@supplier.test');
    });

    it('names the shortfall when a requested order cannot be found', async () => {
        const present = issuedOrder(1);
        const absent = purchaseOrderId(9);

        await renderStubScreen(
            <SupplyOrderPrintScreen orders={`${String(present.id)},${String(absent)}`} />,
            {
                session: kitchenManagerSession(),
                repositories: printOverrides([present]),
            },
        );

        await untilVisible('kitchen-supply-print-sheets');

        // Fewer sheets than orders asked for is how somebody ends up at a supplier's gate without
        // the document. A silent omission is the one failure a person cannot see by counting paper.
        expect(screen.getByTestId('kitchen-supply-print-missing')).toBeTruthy();
        expect(sheetNumbers()).toEqual([present.number]);
    });

    it('says there is nothing to print when the link names nothing usable', async () => {
        await renderStubScreen(<SupplyOrderPrintScreen orders="  ,not-an-identifier, " />, {
            session: kitchenManagerSession(),
            // Deliberately empty: a link naming no identifiers must not reach the repository at
            // all, and a stub with no `listPurchaseOrders` throws by name if it does.
            repositories: { kitchenOps: {} },
        });

        await untilVisible('kitchen-supply-print-nothing');
        expect(screen.queryByTestId('kitchen-supply-print-sheets')).toBeNull();
        expect(screen.getByTestId('kitchen-supply-print-back')).toBeTruthy();
    });

    it('carries no money anywhere on a sheet', async () => {
        const order = issuedOrder(1, {
            notes: 'Deliver before 07:00 through gate 4.',
            lines: [
                orderLine(1, { supplierItemRef: 'SUP-REF-11', quantity: '2.5000' }),
                orderLine(2, { itemNameAr: 'صنف اثنان' }),
            ],
            lineCount: 2,
        });

        await renderStubScreen(<SupplyOrderPrintScreen orders={String(order.id)} />, {
            session: kitchenManagerSession(),
            repositories: printOverrides([order]),
        });

        await untilVisible('kitchen-supply-print-sheets');

        const sheet = screen.getByTestId(printSheetTestId(String(order.id)));

        // The quantity, the unit and the supplier's own reference are on the page…
        expect(
            within(sheet).getByTestId(
                `${printSheetTestId(String(order.id))}-line-${String(itemId(1))}-ref`,
            ).props.children,
        ).toBe('SUP-REF-11');

        /*
         * …and no price is, at any depth. There is nothing to render — the wire shape carries no
         * amount, currency or total on an order, a line or a snapshot (§3.5) — so this is a guard
         * against a future field arriving quietly rather than against today's markup.
         *
         * Queried over the rendered text rather than by serialising the tree: a React element holds
         * an `_owner` back-reference, so `JSON.stringify` on one throws on the circular structure
         * long before it could match anything.
         */
        expect(screen.queryAllByText(/\$|USD|price|total|amount/i)).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The platform branch
 *
 * §7: on iOS and Android, render the preview and explain that printing lives in the web app — never
 * a button that does nothing. Two assertions cover it without pretending to switch platforms:
 * `usePrintSheet` must answer whatever `Platform.OS` says, and the screen must render exactly one
 * of the button and the notice according to that answer. Together they hold on either platform,
 * which is what makes them worth running under a suite that only ever executes on one.
 *
 * Mocking `Platform` module-wide was tried and rejected: `jest.mock` hoists to the top of the file
 * and would take the browser cases with it, and `jest.doMock` after a static import changes nothing
 * because the component already holds the real module.
 * ---------------------------------------------------------------------------------------------- */

describe('the print capability', () => {
    it('answers whatever the platform is, and nothing else', async () => {
        function Probe() {
            const sheet = usePrintSheet();
            return <Text testID="probe-mode">{sheet.mode}</Text>;
        }

        await renderStubScreen(<Probe />);

        expect(screen.getByTestId('probe-mode').props.children).toBe(
            Platform.OS === 'web' ? 'browser' : 'unavailable',
        );
    });

    it('renders exactly one of the print control and the notice', async () => {
        const order = issuedOrder(1);

        await renderStubScreen(<SupplyOrderPrintScreen orders={String(order.id)} />, {
            session: kitchenManagerSession(),
            repositories: printOverrides([order]),
        });

        await untilVisible('kitchen-supply-print-sheets');

        const hasAction = screen.queryByTestId('kitchen-supply-print-action') !== null;
        const hasNotice = screen.queryByTestId('kitchen-supply-print-native-notice') !== null;

        expect(hasAction).toBe(Platform.OS === 'web');
        expect(hasNotice).toBe(!hasAction);

        // Either way the sheets themselves are complete: a person can read the order off the phone
        // in their hand and ring the supplier from it.
        expect(
            screen.getByTestId(`${printSheetTestId(String(order.id))}-supplier-name`),
        ).toBeTruthy();
    });
});
