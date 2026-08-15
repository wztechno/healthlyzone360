import { ApiError, apiFailure, conflictFailure } from '@healthy360/api-client';
import type {
    KitchenQuotation,
    KitchenQuotationLine,
    QuoteKitchenQuotationRequest,
} from '@healthy360/api-client/contracts';
import type { QuotationId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { QuotationsScreen } from './screens/quotations-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/quotations',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The quotation queue, against a queue this file writes.
 *
 * `createQuotationBook` enforces the contract's own machine — `submitted → quoted` and nothing else,
 * `If-Match` on the lock version, every line priced or none — and hands back the fresh record. That
 * is deliberate rather than a canned answer: the screen's claim that it seeds the mutation's
 * response into the detail entry only means something if the record it renders afterwards came from
 * the write.
 *
 * The list deliberately answers `lines: []` on every row, exactly as the wire does. A test whose
 * list carried lines would let a regression through in which the panel rendered from a list row.
 */

function quotationIdAt(ordinal: number): QuotationId {
    return `test-0000-quotation-000${String(ordinal)}` as QuotationId;
}

function quotationLine(
    ordinal: number,
    overrides: Partial<KitchenQuotationLine> = {},
): KitchenQuotationLine {
    return {
        id: `test-quotation-line-${String(ordinal)}`,
        lineNumber: ordinal,
        catalogueItemId: `test-catalogue-item-${String(ordinal)}`,
        catalogueItemVariantId: null,
        quantity: '12.0000',
        unitAmountMinor: null,
        lineTotalMinor: null,
        note: `Line ${String(ordinal)} note`,
        ...overrides,
    };
}

function quotation(overrides: Partial<KitchenQuotation> = {}): KitchenQuotation {
    return {
        id: quotationIdAt(1),
        buyerOrganisationId: 'test-0000-buyer-0001' as KitchenQuotation['buyerOrganisationId'],
        programmeId: 'test-0000-programme-0001' as KitchenQuotation['programmeId'],
        reference: 'QT-2026-0007',
        status: 'submitted',
        currencyCode: 'USD',
        notes: 'Weekly for the pilot floor.',
        declineReason: null,
        submittedAt: '2026-08-10T09:00:00Z',
        quotedAt: null,
        expiresAt: null,
        decidedAt: null,
        lockVersion: 2,
        lines: [quotationLine(1), quotationLine(2, { quantity: '4.0000' })],
        ...overrides,
    };
}

/**
 * Four quotations, newest first — the order the endpoint answers in. Two `submitted`, one `quoted`,
 * one `accepted`, which is what makes every metric and every filter assertion below a count of
 * something this file authored.
 */
function seedQuotations(): KitchenQuotation[] {
    return [
        quotation({ id: quotationIdAt(1), reference: 'QT-2026-0007' }),
        quotation({
            id: quotationIdAt(2),
            reference: 'QT-2026-0006',
            submittedAt: '2026-08-09T11:30:00Z',
            lines: [quotationLine(3, { quantity: '6.0000' })],
        }),
        quotation({
            id: quotationIdAt(3),
            reference: 'QT-2026-0005',
            status: 'quoted',
            quotedAt: '2026-08-08T14:00:00Z',
            expiresAt: '2026-08-15T14:00:00Z',
            lockVersion: 3,
            lines: [
                quotationLine(4, {
                    quantity: '10.0000',
                    unitAmountMinor: 1_800,
                    lineTotalMinor: 18_000,
                }),
            ],
        }),
        quotation({
            id: quotationIdAt(4),
            reference: 'QT-2026-0004',
            status: 'accepted',
            quotedAt: '2026-08-05T10:00:00Z',
            decidedAt: '2026-08-06T08:00:00Z',
            lockVersion: 4,
            lines: [quotationLine(5, { unitAmountMinor: 2_000, lineTotalMinor: 24_000 })],
        }),
    ];
}

interface QuotationBook {
    /** The live records, so a test can assert the transition itself and not merely the call. */
    readonly quotations: () => readonly KitchenQuotation[];
    readonly listQuotations: () => readonly KitchenQuotation[];
    readonly getQuotation: (id: QuotationId) => KitchenQuotation;
    readonly quoteQuotation: (request: QuoteKitchenQuotationRequest) => KitchenQuotation;
}

function createQuotationBook(seed: KitchenQuotation[] = seedQuotations()): QuotationBook {
    let records = seed;

    function requireQuotation(id: QuotationId): KitchenQuotation {
        const found = records.find((record) => record.id === id);
        if (found === undefined) throw new Error(`no quotation ${String(id)} in this test's book`);
        return found;
    }

    return {
        quotations: () => records,

        // The wire's own behaviour: a list is a navigation aid and carries no lines.
        listQuotations: () => records.map((record) => ({ ...record, lines: [] })),

        getQuotation: requireQuotation,

        quoteQuotation: (request) => {
            const current = requireQuotation(request.id);

            if (current.status !== 'submitted') {
                throw new ApiError(
                    apiFailure('b2b.quotation_state_invalid', {
                        message: `A quotation that is ${current.status} cannot become quoted.`,
                    }),
                );
            }
            if (current.lockVersion !== request.lockVersion) {
                throw new ApiError(conflictFailure({ currentLockVersion: current.lockVersion }));
            }

            const priced = new Map(
                request.prices.map((price) => [price.quotationLineId, price.unitAmountMinor]),
            );
            const missing = current.lines.filter((line) => !priced.has(line.id));
            if (missing.length > 0) {
                throw new Error('the screen sent a partial price set the server would refuse');
            }

            const next: KitchenQuotation = {
                ...current,
                status: 'quoted',
                quotedAt: '2026-08-11T10:00:00Z',
                expiresAt: '2026-08-18T10:00:00Z',
                lockVersion: current.lockVersion + 1,
                lines: current.lines.map((line) => {
                    const unit = priced.get(line.id) ?? 0;
                    return {
                        ...line,
                        unitAmountMinor: unit,
                        lineTotalMinor: Math.round(Number(line.quantity) * unit),
                    };
                }),
            };

            records = records.map((record) => (record.id === next.id ? next : record));
            return next;
        },
    };
}

/**
 * The list, once it has arrived.
 *
 * The 5 s ceiling covers cold module load under parallel jest workers, not anything slow in the
 * screen: every test here pays for the first render of a lazily-imported design system, and the 1 s
 * `waitFor` default is below that on a loaded machine.
 */
async function waitForTable() {
    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-quotations-table')).toBeTruthy();
        },
        { timeout: 5000 },
    );
}

/** The detail panel, once its lines have arrived. Same ceiling, same reason. */
async function waitForDetail() {
    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-quotations-detail-lines')).toBeTruthy();
        },
        { timeout: 5000 },
    );
}

async function renderQuotations(book: QuotationBook) {
    return renderStubScreen(<QuotationsScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenQuotations: {
                listQuotations: async () => book.listQuotations(),
                getQuotation: async (id) => book.getQuotation(id),
                quoteQuotation: async (request) => book.quoteQuotation(request),
            },
        },
    });
}

describe('kitchen quotations', () => {
    it('renders the authored queue with a status for every row', async () => {
        const book = createQuotationBook();
        await renderQuotations(book);

        await waitForTable();

        // Four authored: two submitted, one quoted, one accepted.
        expect(
            screen.getByTestId('kitchen-quotations-panel-metric-loaded-value'),
        ).toHaveTextContent('4');
        expect(
            screen.getByTestId('kitchen-quotations-panel-metric-awaiting-value'),
        ).toHaveTextContent('2');
        expect(
            screen.getByTestId('kitchen-quotations-panel-metric-quoted-value'),
        ).toHaveTextContent('1');

        expect(
            screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(1))}-reference`),
        ).toHaveTextContent('QT-2026-0007');
        expect(
            screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(1))}-currency`),
        ).toHaveTextContent('USD');
    });

    it('narrows the list without asking the endpoint for a view it does not offer', async () => {
        const book = createQuotationBook();
        const { repositories } = await renderQuotations(book);

        await waitForTable();

        fireEvent.press(screen.getByTestId('kitchen-quotations-filter-quoted'));

        await waitFor(() => {
            expect(
                screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(3))}-reference`),
            ).toBeTruthy();
        });
        expect(
            screen.queryByTestId(`kitchen-quotation-${String(quotationIdAt(1))}-reference`),
        ).toBeNull();

        // The list endpoint takes no filters, so filtering must not have caused a second read.
        expect(repositories.kitchenQuotations.listQuotations).toHaveBeenCalledTimes(1);

        // Metrics count the whole queue, not the filtered view — they answer "what is on my plate?"
        expect(
            screen.getByTestId('kitchen-quotations-panel-metric-loaded-value'),
        ).toHaveTextContent('4');
    });

    it('reads the quotation on its own, because the list carries no lines', async () => {
        const book = createQuotationBook();
        const { repositories } = await renderQuotations(book);

        await waitForTable();

        fireEvent.press(screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(1))}-open`));

        await waitForDetail();

        expect(repositories.kitchenQuotations.getQuotation).toHaveBeenCalledWith(quotationIdAt(1));

        // Both authored lines, unpriced, with a total that refuses to be a number yet.
        expect(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-1-name'),
        ).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-2-name'),
        ).toBeTruthy();
        expect(screen.getByTestId('kitchen-quotations-detail-total')).toHaveTextContent(
            'Not priced yet',
        );
    });

    it('offers no price fields on a quotation the kitchen may no longer move', async () => {
        const book = createQuotationBook();
        await renderQuotations(book);

        await waitForTable();

        // The `quoted` one: `submitted → quoted` is the only transition this side owns.
        fireEvent.press(screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(3))}-open`));
        await waitForDetail();

        expect(screen.queryByTestId('kitchen-quotations-send')).toBeNull();
        expect(
            screen.queryByTestId('kitchen-quotation-line-test-quotation-line-4-price'),
        ).toBeNull();
        expect(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-4-unit-price'),
        ).toBeTruthy();
    });

    it('refuses the whole screen to a kitchen hand who may not read quotations', async () => {
        const session = kitchenManagerSession();
        await renderStubScreen(<QuotationsScreen />, {
            session: {
                ...session,
                activeContext:
                    session.activeContext === null
                        ? null
                        : {
                              ...session.activeContext,
                              permissions: session.activeContext.permissions.filter(
                                  (code) => code !== 'b2b_quotation.view_organisation',
                              ),
                          },
            },
            repositories: {
                kitchenQuotations: {
                    listQuotations: async () => {
                        throw new Error('the gate should have refused before any read');
                    },
                },
            },
        });

        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-quotations-table')).toBeNull();
        });
        expect(screen.queryByTestId('kitchen-quotations-screen')).toBeNull();
    });
    /*
     * The two tests that actually write are last, and that ordering is load-bearing rather than
     * stylistic: a successful quote raises a toast, and something the toast leaves behind survives
     * this harness's between-test cleanup and starves the *next* screen's first render — the list
     * never arrives and the test that follows fails on a wait it should never have reached. Both
     * offenders pass in isolation and pass here in this order. The sibling order-book suite ends on
     * its two mutation tests as well, which is the same accommodation arrived at independently.
     *
     * This is a defect in the harness, not in either screen. Reordering contains it; it does not
     * fix it, and a suite that later needs a read-only test after a toast will hit it again.
     */
    it('tells a buyer who already decided apart from another tablet that priced first', async () => {
        // Authored as `accepted` while the list still calls it `submitted`, which is exactly the
        // race: the buyer decided between this screen's read and its write.
        const book = createQuotationBook([
            quotation({ id: quotationIdAt(1), status: 'submitted', lines: [quotationLine(1)] }),
        ]);
        const stale: QuotationBook = {
            ...book,
            quoteQuotation: () => {
                throw new ApiError(
                    apiFailure('b2b.quotation_state_invalid', {
                        message: 'A quotation that is accepted cannot become quoted.',
                    }),
                );
            },
        };
        await renderQuotations(stale);

        await waitForTable();
        fireEvent.press(screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(1))}-open`));
        await waitForDetail();

        fireEvent.changeText(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-1-price'),
            '18.00',
        );
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-quotations-send')).not.toBeDisabled();
        });
        fireEvent.press(screen.getByTestId('kitchen-quotations-send'));

        // The buyer's decision, not a concurrent edit — different copy, same re-read remedy.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-quotations-conflict')).toHaveTextContent(
                /The buyer has already decided/,
            );
        });
        expect(screen.getByTestId('kitchen-quotations-conflict-refresh')).toBeTruthy();
    });

    it('keeps the send control shut until every line parses, then prices them all at once', async () => {
        const book = createQuotationBook();
        await renderQuotations(book);

        await waitForTable();
        fireEvent.press(screen.getByTestId(`kitchen-quotation-${String(quotationIdAt(1))}-open`));
        await waitForDetail();

        const send = screen.getByTestId('kitchen-quotations-send');
        expect(send).toBeDisabled();

        // One line priced is still a partial set the server would refuse.
        fireEvent.changeText(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-1-price'),
            '18.00',
        );
        expect(screen.getByTestId('kitchen-quotations-send')).toBeDisabled();

        // A figure with more decimal places than the currency has is a typo, not half a cent.
        fireEvent.changeText(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-2-price'),
            '20.005',
        );
        expect(screen.getByTestId('kitchen-quotations-send')).toBeDisabled();

        fireEvent.changeText(
            screen.getByTestId('kitchen-quotation-line-test-quotation-line-2-price'),
            '20.00',
        );
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-quotations-send')).not.toBeDisabled();
        });

        fireEvent.press(screen.getByTestId('kitchen-quotations-send'));

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-quotations-detail-status')).toHaveTextContent(
                /Priced/,
            );
        });

        // Major units in the field, integer minor units on the wire — and the server's own
        // rounding of quantity × unit price coming back through the seeded response.
        const priced = book.quotations().find((record) => record.id === quotationIdAt(1));
        expect(priced?.status).toBe('quoted');
        expect(priced?.lockVersion).toBe(3);
        expect(priced?.lines[0]?.unitAmountMinor).toBe(1_800);
        expect(priced?.lines[0]?.lineTotalMinor).toBe(21_600);
        expect(priced?.lines[1]?.unitAmountMinor).toBe(2_000);
        expect(priced?.lines[1]?.lineTotalMinor).toBe(8_000);
    });
});
