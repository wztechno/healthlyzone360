import type {
    KitchenQuotation,
    KitchenQuotationLine,
    KitchenQuotationStatus,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Drawer,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    SegmentedControl,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { CurrencyCode, QuotationId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useKitchenQuotationQuery,
    useKitchenQuotationsQuery,
    useQuoteQuotationMutation,
} from '../../../data/kitchen-quotations-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import {
    B2B_QUOTATION_QUOTE_PERMISSION,
    B2B_QUOTATION_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { parseMinorAmount } from '../format.ts';
import {
    canQuoteKitchenQuotation,
    kitchenQuotationRowTestId,
    kitchenQuotationStatusKey,
    kitchenQuotationStatusTone,
    kitchenQuotationTotalMinor,
} from '../ops-format.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';

/**
 * `/kitchen/quotations` — what corporate buyers have asked this kitchen to price (B4).
 *
 * The seller's half of the surface `/corporate/quotations` is the buyer's half of. A buyer drafts
 * lines against a programme and submits; this screen is where somebody names a figure against each
 * line and sends it back, which is the one move in the quotation's life that neither the buyer nor
 * the platform makes on the kitchen's behalf.
 *
 * ## Why the detail is a slide-in and not a route
 *
 * The order book's argument (`./orders-screen.tsx`), and it lands harder here: pricing is *work
 * done against a list*, and the person doing it is comparing what they just quoted one buyer with
 * what they are about to quote the next. A route would put a navigation and a back press either side
 * of every quotation and lose the filter on the way in.
 *
 * ## Why the panel re-reads, and why it *must* here
 *
 * On the order book the re-read is about freshness. Here it is about existence: `listQuotations`
 * answers `lines: []` on every row by the wire's own contract, so the list literally cannot render
 * the thing being priced. The panel reads the quotation on its own, and the mutation's response is
 * seeded straight back into that entry by the hook, so the badge and the totals settle without a
 * round trip.
 *
 * ## Filtering happens here because the endpoint offers none
 *
 * `GET /b2b/kitchen/quotations` takes no query parameters and no cursor — it answers every non-draft
 * quotation, newest first. So the segmented control narrows rows already held rather than issuing a
 * request, and there is no paging control: there is no next page to ask for. That is stated in
 * `data/kitchen-quotations-hooks.ts` too, because a filter argument on a hook whose endpoint has
 * none is how a client-side sieve gets mistaken for a server-side view.
 *
 * ## Prices are entered in major units and sent in minor ones
 *
 * `parseMinorAmount` / `minorAmountToInput` (`../format.ts`), the same pair the price-list editor
 * uses, and string arithmetic for the same reason: `Number('5.50') * 100` is not reliably `550`, and
 * this figure ends up in an integer column somebody reconciles an invoice against. A price with more
 * decimal places than the currency has is refused rather than rounded.
 *
 * **Every line, or none.** The server refuses a partial set with the outstanding identifiers in
 * `details.fields.prices.missing_quotation_line_ids`, so the button stays disabled until every line
 * parses. Sending a short set to discover which lines were missed would be asking the server to do
 * arithmetic the screen can do before anybody waits on a request.
 *
 * ## Two refusals, two different remedies, and neither is retried
 *
 * `resource.conflict` means another tablet priced this quotation between this screen's read and its
 * write. `b2b.quotation_state_invalid` means the **buyer** moved it — accepted, declined, or let the
 * seven-day clock run out — while it sat open. Both are answered with a re-read rather than a retry,
 * and they are told apart in the copy because "somebody else priced this" and "the buyer has already
 * decided" are different things for a person to do next.
 */

/**
 * Stable empties for the two "not loaded yet" cases.
 *
 * `?? []` would mint a fresh array on every render, and both of these feed a `useMemo` dependency —
 * so the filtered rows and the parsed prices would recompute every frame, and the price parser in
 * particular runs over every line of the open quotation.
 */
const NO_QUOTATIONS: readonly KitchenQuotation[] = [];
const NO_LINES: readonly KitchenQuotationLine[] = [];

type StatusFilter = 'all' | 'awaiting' | 'quoted' | 'closed';

const FILTERS: readonly StatusFilter[] = ['all', 'awaiting', 'quoted', 'closed'];

/** Which statuses each filter admits. `all` admits everything, so it holds no list. */
const FILTER_STATUSES: Readonly<Record<StatusFilter, readonly KitchenQuotationStatus[]>> = {
    all: [],
    awaiting: ['submitted'],
    quoted: ['quoted'],
    closed: ['accepted', 'declined', 'expired'],
};

export function QuotationsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [B2B_QUOTATION_VIEW_PERMISSION] }}
            testID="kitchen-quotations"
        >
            <Quotations />
        </Gate>
    );
}

/** One labelled fact in the detail panel. Never a table: these are pairs, not a dataset. */
function DetailRow({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        <Inline space="sm" align="start" justify="between" wrap>
            <Text tone="secondary" variant="caption">
                {label}
            </Text>
            <Text testID={testID}>{value}</Text>
        </Inline>
    );
}

function Quotations() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const canQuote = useCan(B2B_QUOTATION_QUOTE_PERMISSION);

    const [filter, setFilter] = useState<StatusFilter>('all');
    const [selectedId, setSelectedId] = useState<QuotationId | null>(null);
    /** Line identifier → the major-unit string that line's field holds. Reset with the panel. */
    const [prices, setPrices] = useState<Readonly<Record<string, string>>>({});

    const quotations = useKitchenQuotationsQuery();
    const detail = useKitchenQuotationQuery(selectedId);
    const quote = useQuoteQuotationMutation();

    const all: readonly KitchenQuotation[] = quotations.data ?? NO_QUOTATIONS;
    const rows = useMemo(() => {
        const allowed = FILTER_STATUSES[filter];
        if (allowed.length === 0) return all;
        return all.filter((row) => allowed.includes(row.status));
    }, [all, filter]);

    const quotation = detail.data ?? null;
    const lines: readonly KitchenQuotationLine[] = quotation?.lines ?? NO_LINES;
    const currency: CurrencyCode = quotation?.currencyCode ?? 'USD';
    const editable = quotation !== null && canQuote && canQuoteKitchenQuotation(quotation.status);

    const metrics: readonly OpsMetric[] = [
        {
            key: 'loaded',
            labelKey: 'kitchen:ops.quotations.metrics.loaded',
            value: quotations.isPending ? null : all.length,
        },
        {
            key: 'awaiting',
            labelKey: 'kitchen:ops.quotations.metrics.awaiting',
            value: quotations.isPending
                ? null
                : all.filter((row) => row.status === 'submitted').length,
        },
        {
            key: 'quoted',
            labelKey: 'kitchen:ops.quotations.metrics.quoted',
            value: quotations.isPending
                ? null
                : all.filter((row) => row.status === 'quoted').length,
        },
    ];

    /**
     * Every line's price as integer minor units, or `null` when any one of them does not parse.
     *
     * All-or-nothing on purpose: the server refuses a partial set anyway, and a button that stayed
     * enabled while a field held `5.505` would send a request whose only outcome is a validation
     * error the screen already had enough information to prevent.
     */
    const parsedPrices = useMemo(() => {
        if (lines.length === 0) return null;
        const parsed: { readonly quotationLineId: string; readonly unitAmountMinor: number }[] = [];
        for (const line of lines) {
            const amount = parseMinorAmount(prices[line.id] ?? '', currency);
            if (amount === null) return null;
            parsed.push({ quotationLineId: line.id, unitAmountMinor: amount });
        }
        return parsed;
    }, [lines, prices, currency]);

    const quoteFailure = toFailure(quote.error);
    const isConflict = quoteFailure?.code === 'resource.conflict';
    const isStale = quoteFailure?.code === 'b2b.quotation_state_invalid';

    function closeDetail() {
        setSelectedId(null);
        setPrices({});
        quote.reset();
    }

    /**
     * Opens the panel with empty fields, which is the only honest starting state.
     *
     * There is nothing to seed them from: `submitted` is the one status that may be priced, and a
     * submitted quotation carries `null` on every line by definition — the absence *is* the
     * statement that no price has been named. Pre-filling zeros would put a figure nobody typed in
     * front of somebody about to commit to it.
     */
    function openDetail(row: KitchenQuotation) {
        quote.reset();
        setPrices({});
        setSelectedId(row.id);
    }

    function submitPrices() {
        if (quotation === null || parsedPrices === null) return;
        quote.mutate(
            {
                id: quotation.id,
                lockVersion: quotation.lockVersion,
                prices: parsedPrices,
            },
            {
                onSuccess: (next) => {
                    setPrices({});
                    toast.show({
                        testID: 'kitchen-quotations-quoted-toast',
                        tone: 'success',
                        message: t('kitchen:ops.quotations.quotedToast', {
                            reference: next.reference,
                        }),
                    });
                },
            },
        );
    }

    const columns: readonly TableColumn<KitchenQuotation>[] = [
        {
            key: 'reference',
            header: t('kitchen:ops.quotations.columnReference'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-reference`}
                >
                    {row.reference}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:ops.quotations.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-status`}
                    tone={kitchenQuotationStatusTone(row.status)}
                    label={t(kitchenQuotationStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'submitted',
            header: t('kitchen:ops.quotations.columnSubmitted'),
            render: (row) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-submitted`}
                >
                    {row.submittedAt === null
                        ? t('kitchen:common.notRecorded')
                        : formatter.formatDate(row.submittedAt)}
                </Text>
            ),
        },
        {
            key: 'currency',
            header: t('kitchen:ops.quotations.columnCurrency'),
            render: (row) => (
                <Text testID={`${kitchenQuotationRowTestId(String(row.id))}-currency`}>
                    {row.currencyCode}
                </Text>
            ),
        },
    ];

    /**
     * The line table's columns.
     *
     * Built inside the component rather than hoisted because the price cell closes over the
     * quotation's currency, whether the panel is editable, and the draft prices — three things that
     * change with the selection.
     */
    const lineColumns: readonly TableColumn<KitchenQuotationLine>[] = [
        {
            key: 'line',
            header: t('kitchen:ops.quotations.lineColumn'),
            rowHeader: true,
            flex: 2,
            render: (line) => (
                <Stack space="none">
                    <Text variant="bodyStrong" testID={`kitchen-quotation-line-${line.id}-name`}>
                        {/*
                         * The wire carries no article name on a quotation line — only the buyer's
                         * own note and the catalogue identifier. The note is what a person wrote and
                         * is therefore the better label when there is one; the identifier is shown
                         * beneath either way, because it is the only thing that ties the line back
                         * to something in this kitchen's catalogue.
                         */}
                        {line.note ?? t('kitchen:ops.quotations.lineUnnamed')}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {line.catalogueItemId}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.quotations.lineQuantity'),
            numeric: true,
            render: (line) => (
                <Text testID={`kitchen-quotation-line-${line.id}-quantity`}>
                    {formatter.formatNumber(Number(line.quantity))}
                </Text>
            ),
        },
        {
            key: 'unitPrice',
            header: t('kitchen:ops.quotations.lineUnitPrice'),
            numeric: true,
            flex: 2,
            render: (line) =>
                editable ? (
                    <TextInputField
                        testID={`kitchen-quotation-line-${line.id}-price`}
                        id={`kitchen-quotation-line-${line.id}-price`}
                        label={t('kitchen:ops.quotations.linePriceLabel', {
                            line: line.lineNumber,
                        })}
                        hint={t('kitchen:ops.quotations.linePriceHint', { currency })}
                        value={prices[line.id] ?? ''}
                        onChangeText={(next) => {
                            setPrices((current) => ({ ...current, [line.id]: next }));
                            quote.reset();
                        }}
                        inputMode="decimal"
                        autoCapitalize="none"
                        autoCorrect={false}
                        error={
                            (prices[line.id] ?? '') !== '' &&
                            parseMinorAmount(prices[line.id] ?? '', currency) === null
                                ? t('kitchen:ops.quotations.linePriceInvalid')
                                : undefined
                        }
                    />
                ) : (
                    <Text
                        tone={line.unitAmountMinor === null ? 'secondary' : undefined}
                        testID={`kitchen-quotation-line-${line.id}-unit-price`}
                    >
                        {line.unitAmountMinor === null
                            ? t('kitchen:ops.quotations.lineNotPriced')
                            : formatMoney(formatter, {
                                  amount: line.unitAmountMinor,
                                  currency,
                              })}
                    </Text>
                ),
        },
        {
            key: 'lineTotal',
            header: t('kitchen:ops.quotations.lineTotal'),
            numeric: true,
            render: (line) => (
                <Text
                    tone={line.lineTotalMinor === null ? 'secondary' : undefined}
                    testID={`kitchen-quotation-line-${line.id}-total`}
                >
                    {line.lineTotalMinor === null
                        ? t('kitchen:ops.quotations.lineNotPriced')
                        : formatMoney(formatter, { amount: line.lineTotalMinor, currency })}
                </Text>
            ),
        },
    ];

    const listFailure = toFailure(quotations.error);
    const detailFailure = toFailure(detail.error);
    const total = kitchenQuotationTotalMinor(lines);

    return (
        <Stack space="lg" testID="kitchen-quotations-screen">
            <OpsPanel
                testID="kitchen-quotations-panel"
                titleKey="kitchen:ops.quotations.title"
                subtitleKey="kitchen:ops.quotations.subtitle"
                metrics={metrics}
                emptyTitleKey="kitchen:ops.quotations.emptyTitle"
                emptyBodyKey="kitchen:ops.quotations.emptyBody"
            >
                <Stack space="md" testID="kitchen-quotations-content">
                    <SegmentedControl<StatusFilter>
                        testID="kitchen-quotations-filter"
                        label={t('kitchen:ops.quotations.filterLabel')}
                        block
                        value={filter}
                        onChange={setFilter}
                        items={FILTERS.map((candidate) => ({
                            value: candidate,
                            label: t(`kitchen:ops.quotations.filter.${candidate}`),
                            testID: `kitchen-quotations-filter-${candidate}`,
                        }))}
                    />

                    {quotations.isPending ? (
                        <Stack space="sm" testID="kitchen-quotations-loading">
                            {Array.from({ length: 4 }, (_, index) => (
                                <Skeleton key={index} heightClassName="h-10" />
                            ))}
                        </Stack>
                    ) : listFailure !== null ? (
                        <ErrorState
                            testID="kitchen-quotations-error"
                            title={t('kitchen:ops.quotations.loadErrorTitle')}
                            failure={listFailure}
                            onRetry={() => {
                                void quotations.refetch();
                            }}
                            retrying={quotations.isFetching}
                        />
                    ) : rows.length === 0 ? (
                        <EmptyState
                            testID="kitchen-quotations-empty"
                            title={t(
                                filter === 'all'
                                    ? 'kitchen:ops.quotations.emptyTitle'
                                    : 'kitchen:ops.quotations.filteredEmptyTitle',
                            )}
                            body={t(
                                filter === 'all'
                                    ? 'kitchen:ops.quotations.emptyBody'
                                    : 'kitchen:ops.quotations.filteredEmptyBody',
                            )}
                            actions={
                                filter === 'all' ? undefined : (
                                    <Button
                                        testID="kitchen-quotations-clear"
                                        variant="secondary"
                                        label={t('kitchen:ops.quotations.clearFilter')}
                                        onPress={() => {
                                            setFilter('all');
                                        }}
                                    />
                                )
                            }
                        />
                    ) : (
                        <Table<KitchenQuotation>
                            testID="kitchen-quotations-table"
                            caption={t('kitchen:ops.quotations.caption')}
                            captionHidden
                            columns={columns}
                            rows={rows}
                            rowKey={(row) => String(row.id)}
                            rowAction={{
                                header: t('kitchen:ops.quotations.columnActions'),
                                render: (row) => (
                                    <Button
                                        testID={`${kitchenQuotationRowTestId(String(row.id))}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t(
                                            canQuoteKitchenQuotation(row.status) && canQuote
                                                ? 'kitchen:ops.quotations.price'
                                                : 'kitchen:ops.quotations.open',
                                        )}
                                        onPress={() => {
                                            openDetail(row);
                                        }}
                                    />
                                ),
                            }}
                        />
                    )}
                </Stack>
            </OpsPanel>

            <Drawer
                testID="kitchen-quotations-detail"
                placement="end"
                open={selectedId !== null}
                onClose={closeDetail}
                title={
                    quotation === null
                        ? t('kitchen:ops.quotations.title')
                        : t('kitchen:ops.quotations.detailTitle', {
                              reference: quotation.reference,
                          })
                }
                className="w-[560px]"
                footer={
                    !editable ? undefined : (
                        <Inline space="sm" wrap justify="end">
                            <Button
                                testID="kitchen-quotations-send"
                                label={t('kitchen:ops.quotations.send')}
                                loading={quote.isPending}
                                disabled={quote.isPending || parsedPrices === null}
                                onPress={submitPrices}
                            />
                        </Inline>
                    )
                }
            >
                {detail.isPending ? (
                    <Skeleton testID="kitchen-quotations-detail-loading" heightClassName="h-40" />
                ) : detailFailure !== null ? (
                    <ErrorState
                        testID="kitchen-quotations-detail-error"
                        title={t('kitchen:ops.quotations.detailLoadErrorTitle')}
                        failure={detailFailure}
                        onRetry={() => {
                            void detail.refetch();
                        }}
                        retrying={detail.isFetching}
                    />
                ) : quotation === null ? null : (
                    <Stack space="lg" testID="kitchen-quotations-detail-body">
                        <Inline space="sm" align="center" wrap>
                            <Badge
                                testID="kitchen-quotations-detail-status"
                                tone={kitchenQuotationStatusTone(quotation.status)}
                                label={t(kitchenQuotationStatusKey(quotation.status))}
                            />
                        </Inline>

                        {quoteFailure === null ? null : isConflict || isStale ? (
                            <Callout
                                testID="kitchen-quotations-conflict"
                                tone="warning"
                                role="alert"
                                title={t(
                                    isStale
                                        ? 'kitchen:ops.quotations.staleTitle'
                                        : 'kitchen:ops.quotations.conflictTitle',
                                )}
                                body={t(
                                    isStale
                                        ? 'kitchen:ops.quotations.staleBody'
                                        : 'kitchen:ops.quotations.conflictBody',
                                )}
                                actions={
                                    <Button
                                        testID="kitchen-quotations-conflict-refresh"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:ops.quotations.conflictRefresh')}
                                        loading={detail.isFetching}
                                        onPress={() => {
                                            quote.reset();
                                            void detail.refetch();
                                            void quotations.refetch();
                                        }}
                                    />
                                }
                            />
                        ) : (
                            <Text testID="kitchen-quotations-action-error" tone="danger">
                                {quoteFailure.message}
                            </Text>
                        )}

                        {editable ? (
                            <Callout
                                testID="kitchen-quotations-price-guidance"
                                tone="info"
                                title={t('kitchen:ops.quotations.guidanceTitle')}
                                body={t('kitchen:ops.quotations.guidanceBody', { currency })}
                            />
                        ) : null}

                        <Stack space="sm">
                            <Heading level={3} testID="kitchen-quotations-detail-lines-heading">
                                {t('kitchen:ops.quotations.linesHeading')}
                            </Heading>
                            {lines.length === 0 ? (
                                <Text testID="kitchen-quotations-detail-no-lines" tone="secondary">
                                    {t('kitchen:ops.quotations.noLines')}
                                </Text>
                            ) : (
                                <Table<KitchenQuotationLine>
                                    testID="kitchen-quotations-detail-lines"
                                    caption={t('kitchen:ops.quotations.linesHeading')}
                                    captionHidden
                                    columns={lineColumns}
                                    rows={lines}
                                    rowKey={(line) => line.id}
                                />
                            )}
                        </Stack>

                        <Stack space="xs" testID="kitchen-quotations-detail-totals">
                            <Heading level={3}>{t('kitchen:ops.quotations.totalsHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-quotations-detail-currency"
                                label={t('kitchen:ops.quotations.currency')}
                                value={quotation.currencyCode}
                            />
                            <DetailRow
                                testID="kitchen-quotations-detail-total"
                                label={t('kitchen:ops.quotations.total')}
                                // `null` is not zero. A partly-priced set has no total, and saying
                                // so is the whole reason the sum is computed rather than defaulted.
                                value={
                                    total === null
                                        ? t('kitchen:ops.quotations.notPricedYet')
                                        : formatMoney(formatter, { amount: total, currency })
                                }
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-quotations-detail-request">
                            <Heading level={3}>
                                {t('kitchen:ops.quotations.requestHeading')}
                            </Heading>
                            <DetailRow
                                testID="kitchen-quotations-detail-programme"
                                label={t('kitchen:ops.quotations.programme')}
                                value={String(quotation.programmeId)}
                            />
                            <DetailRow
                                testID="kitchen-quotations-detail-notes"
                                label={t('kitchen:ops.quotations.notes')}
                                value={quotation.notes ?? t('kitchen:ops.quotations.noNotes')}
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-quotations-detail-timeline">
                            <Heading level={3}>
                                {t('kitchen:ops.quotations.timelineHeading')}
                            </Heading>
                            <DetailRow
                                testID="kitchen-quotations-detail-submitted-at"
                                label={t('kitchen:ops.quotations.submittedAt')}
                                value={
                                    quotation.submittedAt === null
                                        ? t('kitchen:common.notRecorded')
                                        : formatter.formatDate(quotation.submittedAt)
                                }
                            />
                            {quotation.quotedAt === null ? null : (
                                <DetailRow
                                    testID="kitchen-quotations-detail-quoted-at"
                                    label={t('kitchen:ops.quotations.quotedAt')}
                                    value={formatter.formatDate(quotation.quotedAt)}
                                />
                            )}
                            {quotation.expiresAt === null ? null : (
                                <DetailRow
                                    testID="kitchen-quotations-detail-expires-at"
                                    label={t('kitchen:ops.quotations.expiresAt')}
                                    value={formatter.formatDate(quotation.expiresAt)}
                                />
                            )}
                            {quotation.decidedAt === null ? null : (
                                <DetailRow
                                    testID="kitchen-quotations-detail-decided-at"
                                    label={t('kitchen:ops.quotations.decidedAt')}
                                    value={formatter.formatDate(quotation.decidedAt)}
                                />
                            )}
                        </Stack>

                        {quotation.declineReason === null ? null : (
                            <Stack space="xs" testID="kitchen-quotations-detail-decline">
                                <Heading level={3}>
                                    {t('kitchen:ops.quotations.declineHeading')}
                                </Heading>
                                <Text testID="kitchen-quotations-detail-decline-reason">
                                    {quotation.declineReason}
                                </Text>
                            </Stack>
                        )}
                    </Stack>
                )}
            </Drawer>
        </Stack>
    );
}
