import type { PurchaseOrder } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { PurchaseOrderId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { usePurchaseOrdersQuery } from '../../../data/kitchen-ops-hooks.ts';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { PrintSheet, usePrintSheet } from '../print-sheet.tsx';

/**
 * `/kitchen/supply-orders/print?orders=…` — the Phase 1 export (SUP7, §7).
 *
 * ## Why this is a route and not a dialog
 *
 * `window.print()` prints the *document*, not a component. Everything the browser can see goes on
 * the paper, so a print preview rendered inside a modal over the order book would put the order
 * book on page one and the modal's backdrop over the rest. A route puts one thing in the document
 * and the print CSS hides the chrome around it — which is also why the sheets are reachable by URL,
 * shareable, refreshable and reprintable months later.
 *
 * ## One read, never one per order
 *
 * `orders=a,b,c` is a **batch**: `listPurchaseOrders({ ids })` is a single request whatever the
 * count, because the alternative — a query per identifier — is four round trips for one sheet of
 * paper and four independent loading states on a page that has to be complete or nothing. §6 built
 * `ids[]` for exactly this, capped at fifty server-side; the cap is applied here too so a
 * hand-edited URL naming ninety orders gets a truncated document rather than a 422.
 *
 * ## The order on the page is the order that was asked for
 *
 * The endpoint is a keyset list and answers newest-first; the query string is a *sequence somebody
 * chose*. So the response is indexed and replayed against the requested identifiers. A person who
 * issued four orders and printed them expects them in that order when they staple them.
 *
 * An identifier that comes back with nothing is **named**, not dropped: fewer sheets than orders
 * asked for is exactly how somebody ends up at a supplier's gate without the document, and a silent
 * omission is the one failure a person cannot see by counting the paper in their hand.
 *
 * ## Native renders the document and says where printing lives
 *
 * The kitchen area ships to the staff app as well as the browser, and §7 is explicit: on iOS and
 * Android, render the preview and explain that printing or saving a PDF is available from the web
 * app. Not a disabled button, not a toast on press — the sheets below are complete and readable,
 * and the notice says so rather than implying the screen is broken.
 */

/** §6's server-side cap on one batch read, mirrored here so a hand-typed URL truncates rather than 422s. */
const MAX_ORDERS = 50;

export interface SupplyOrderPrintScreenProps {
    /** The `orders` query parameter: comma-separated purchase-order identifiers. */
    readonly orders?: string | undefined;
}

export function SupplyOrderPrintScreen({ orders }: SupplyOrderPrintScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_ORDER_SUPPLIES_PERMISSION] }}
            testID="kitchen-supply-print"
        >
            <SupplyOrderPrint orders={orders} />
        </Gate>
    );
}

/**
 * The identifiers a query string names, in the order it names them.
 *
 * Deduplicated because the same order twice is one document, not two — a doubled identifier is a
 * copy-paste artefact rather than an instruction to print the same page again. Anything that is not
 * an identifier is dropped rather than rejected: a URL with one stale segment should still print
 * the three orders it names correctly, and the missing-orders notice below explains the shortfall.
 */
export function parseOrderIds(raw: string | undefined): readonly PurchaseOrderId[] {
    if (raw === undefined) return [];

    const seen = new Set<string>();
    const parsed: PurchaseOrderId[] = [];

    for (const segment of raw.split(',')) {
        const trimmed = segment.trim();
        if (trimmed === '' || seen.has(trimmed)) continue;
        seen.add(trimmed);

        const id = PurchaseOrderId.safeParse(trimmed);
        if (id === null) continue;

        parsed.push(id);
        if (parsed.length === MAX_ORDERS) break;
    }

    return parsed;
}

function SupplyOrderPrint({ orders }: SupplyOrderPrintScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const sheet = usePrintSheet();

    const ids = useMemo(() => parseOrderIds(orders), [orders]);

    const batch = usePurchaseOrdersQuery(
        // `limit` states what the request actually wants. The endpoint's default page is
        // twenty-five, so a batch of thirty would silently print five short without it.
        { ids, limit: Math.max(ids.length, 1) },
        ids.length > 0,
    );

    function back(): void {
        router.push('/kitchen/supply-orders' as never);
    }

    const backButton = (
        <Button
            testID="kitchen-supply-print-back"
            variant="secondary"
            label={t('kitchen:ops.supplyOrders.backToOrders')}
            onPress={back}
        />
    );

    /* ── nothing was asked for ───────────────────────────────────────────────────────────────── */

    if (ids.length === 0) {
        return (
            <Stack space="lg" testID="kitchen-supply-print-screen">
                <Callout
                    testID="kitchen-supply-print-nothing"
                    tone="warning"
                    // `alert`, not `note`: the person arrived here expecting a document and there
                    // is none, which is a state that has to interrupt rather than sit quietly.
                    role="alert"
                    title={t('kitchen:ops.supplyOrders.print.nothingToPrintTitle')}
                    body={t('kitchen:ops.supplyOrders.print.nothingToPrintBody')}
                    actions={backButton}
                />
            </Stack>
        );
    }

    if (batch.isPending) {
        return (
            <Stack space="sm" testID="kitchen-supply-print-loading">
                {Array.from({ length: Math.min(ids.length, 3) }, (_, index) => (
                    <Card key={index} padding="md">
                        <Skeleton
                            testID={`kitchen-supply-print-skeleton-${String(index + 1)}`}
                            heightClassName="h-5"
                        />
                    </Card>
                ))}
            </Stack>
        );
    }

    const failure = toFailure(batch.error);

    if (failure !== null) {
        return (
            <Stack space="lg" testID="kitchen-supply-print-screen">
                <ErrorState
                    testID="kitchen-supply-print-error"
                    failure={failure}
                    onRetry={() => {
                        void batch.refetch();
                    }}
                    retrying={batch.isFetching}
                />
                {backButton}
            </Stack>
        );
    }

    /* ── the document ────────────────────────────────────────────────────────────────────────── */

    const byId = new Map<string, PurchaseOrder>(
        (batch.data?.items ?? []).map((order) => [String(order.id), order]),
    );

    const sheets = ids
        .map((id) => byId.get(String(id)))
        .filter((order): order is PurchaseOrder => order !== undefined);

    const missing = ids.length - sheets.length;

    return (
        <Stack space="lg" testID="kitchen-supply-print-screen">
            {/*
             * Screen-only. The print block hides this whole block by test id, so the paper carries
             * the documents and nothing else — no page title, no button, no count.
             */}
            <Stack space="sm" testID="kitchen-supply-print-toolbar">
                <Heading level={1} testID="kitchen-supply-print-title">
                    {t('kitchen:ops.supplyOrders.print.title')}
                </Heading>

                <Inline space="sm" align="center" justify="between" wrap>
                    <Text tone="secondary" testID="kitchen-supply-print-count">
                        {t('kitchen:ops.supplyOrders.print.orderCount', { count: sheets.length })}
                    </Text>

                    <Inline space="sm" align="center" wrap>
                        {backButton}
                        {sheet.mode === 'browser' && sheets.length > 0 ? (
                            <Button
                                testID="kitchen-supply-print-action"
                                label={t('kitchen:ops.supplyOrders.print.printAction')}
                                onPress={sheet.print}
                            />
                        ) : null}
                    </Inline>
                </Inline>

                {sheet.mode === 'browser' ? null : (
                    /*
                     * §7: render the preview and explain where printing lives. The sheets below are
                     * complete — a person can read an order off the phone in their hand and ring
                     * the supplier from it — so the notice says that rather than apologising.
                     */
                    <Callout
                        testID="kitchen-supply-print-native-notice"
                        tone="info"
                        title={t('kitchen:ops.supplyOrders.print.nativeUnavailableTitle')}
                        body={t('kitchen:ops.supplyOrders.print.nativeUnavailableBody')}
                    />
                )}

                {missing === 0 || sheets.length === 0 ? null : (
                    // Suppressed when *nothing* was found: the empty state below already carries
                    // that news along with the way out, and two warnings for one fact is noise.
                    <Callout
                        testID="kitchen-supply-print-missing"
                        tone="warning"
                        role="alert"
                        title={t('kitchen:ops.supplyOrders.print.missingTitle')}
                        body={t('kitchen:ops.supplyOrders.print.missing', { count: missing })}
                    />
                )}
            </Stack>

            {sheets.length === 0 ? (
                <Callout
                    testID="kitchen-supply-print-nothing"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:ops.supplyOrders.print.nothingToPrintTitle')}
                    body={t('kitchen:ops.supplyOrders.print.nothingFoundBody')}
                    actions={backButton}
                />
            ) : (
                /*
                 * The sheets and **only** the sheets are children of this box: the print block ends
                 * each one with `break-after: page` and cancels it on `:last-child`, so a stray
                 * sibling here would either take the last break with it or leave a blank final page.
                 */
                <Stack space="lg" testID="kitchen-supply-print-sheets">
                    {sheets.map((order) => (
                        <PrintSheet key={String(order.id)} order={order} />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
