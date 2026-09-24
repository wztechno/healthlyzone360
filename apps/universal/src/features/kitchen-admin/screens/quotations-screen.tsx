import { KITCHEN_QUOTATION_STATUSES } from '@healthy360/api-client/contracts';
import type {
    KitchenQuotation,
    KitchenQuotationLine,
    KitchenQuotationStatus,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    DataList,
    EmptyState,
    ErrorState,
    FormSection,
    Icon,
    RecordWindowFieldGrid,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { CurrencyCode, QuotationId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useKitchenQuotationQuery,
    useKitchenQuotationsQuery,
    useQuoteQuotationMutation,
} from '../../../data/kitchen-quotations-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { quotationLineColumns } from '../commercial/quotation-line-columns.tsx';
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
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker, WithColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/quotations` — what corporate buyers have asked this kitchen to price (B4), as
 * `Commercial.dc.html` draws it (§3.2).
 *
 * ```
 * ┌ LOADED ┐ ┌ AWAITING A PRICE ┐ ┌ PRICED ┐
 * [ ⌕ reference ]  [ All | Awaiting | Priced | Closed ]
 * REFERENCE       CURRENCY   SUBMITTED    STATUS          ◉ ✎
 * ```
 *
 * The Catalogue list's parts. The row body — or ✎ — opens the **pricing page** in place of the list;
 * ◉ opens the read-only `RecordWindow`.
 *
 * ## The pricing page replaces the list, it is not a route or a drawer
 *
 * The side drawer is retired (Workbench §0). The editor takes the page the way the ingredient
 * detail does: the list's filter survives Back because it is state, not a navigation, and pricing is
 * work done against a list — somebody compares what they quoted one buyer with the next.
 *
 * `listQuotations` answers `lines: []` on every row by the wire's contract, so the list has no Lines
 * or Total column to show honestly (§3.2's spec names them; the endpoint cannot fill them). The page
 * re-reads the quotation to get its lines.
 *
 * ## Pricing rules kept verbatim
 *
 * Major units in, minor units out through `parseMinorAmount`. **Every line, or none**: Send stays
 * disabled until every line parses; zero is accepted, empty is not, and the sentence beside the
 * button says so. Currency is stated, never chosen. A conflict and a stale quotation are answered
 * with a re-read, told apart in the copy.
 *
 * ## Filtering and search happen here because the endpoint offers none
 *
 * `GET /b2b/kitchen/quotations` takes no parameters and no cursor, so the segments and the search
 * narrow rows already held, and there is no pager — there is no next page (§6.5).
 *
 * The same is what makes every header honest in memory: Reference and Submitted sort, Currency and
 * Status filter, and all four act on the whole queue because the whole queue is what was answered.
 */

const NO_QUOTATIONS: readonly KitchenQuotation[] = [];
const NO_LINES: readonly KitchenQuotationLine[] = [];

type StatusFilter = 'all' | 'awaiting' | 'quoted' | 'closed';
const FILTERS: readonly StatusFilter[] = ['all', 'awaiting', 'quoted', 'closed'];
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

function Quotations() {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const [filter, setFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [openId, setOpenId] = useState<QuotationId | null>(null);
    const [viewing, setViewing] = useState<KitchenQuotation | null>(null);

    const quotations = useKitchenQuotationsQuery();
    const all: readonly KitchenQuotation[] = quotations.data ?? NO_QUOTATIONS;

    const rows = useMemo(() => {
        const allowed = FILTER_STATUSES[filter];
        const needle = search.trim().toLowerCase();
        return all.filter(
            (row) =>
                (allowed.length === 0 || allowed.includes(row.status)) &&
                (needle === '' || row.reference.toLowerCase().includes(needle)),
        );
    }, [all, filter, search]);

    const columns: readonly ControlledColumn<
        KitchenQuotation,
        CatalogueColumn<KitchenQuotation>
    >[] = [
        {
            key: 'reference',
            role: 'title',
            label: t('kitchen:ops.quotations.columnReference'),
            width: 200,
            priority: 100,
            value: (row) => row.reference,
            sort: (left, right, direction) =>
                compareText(left.reference, right.reference, direction),
            render: (row) => (
                <Text
                    variant="mono"
                    className="font-semibold"
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-reference`}
                >
                    {row.reference}
                </Text>
            ),
        },
        {
            key: 'currency',
            role: 'meta',
            label: t('kitchen:ops.quotations.columnCurrency'),
            width: 90,
            priority: 70,
            value: (row) => row.currencyCode,
            // The currencies the queue actually carries: a code is its own label, and offering
            // one no quotation is in would be a choice that can only ever empty the list.
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.currencyCode))].map((code) => ({
                        key: code,
                        label: code,
                    })),
                match: (row, value) => row.currencyCode === value,
            },
            render: (row) => (
                <Text
                    variant="mono"
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-currency`}
                >
                    {row.currencyCode}
                </Text>
            ),
        },
        {
            key: 'submitted',
            role: 'meta',
            label: t('kitchen:ops.quotations.columnSubmitted'),
            width: 130,
            priority: 75,
            value: (row) => submittedText(row, t, formatter),
            sort: (left, right, direction) =>
                compareText(left.submittedAt ?? '', right.submittedAt ?? '', direction),
            render: (row) => (
                <Text
                    variant="mono"
                    tone="secondary"
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-submitted`}
                >
                    {submittedText(row, t, formatter)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:ops.quotations.columnStatus'),
            width: 120,
            priority: 85,
            value: (row) => t(kitchenQuotationStatusKey(row.status)),
            // One status at a time, all five — the segments fold three of them into Closed, and
            // this is where "only the declined ones" is asked.
            filter: {
                values: () =>
                    KITCHEN_QUOTATION_STATUSES.map((status) => ({
                        key: status,
                        label: t(kitchenQuotationStatusKey(status)),
                    })),
                match: (row, value) => row.status === value,
            },
            render: (row) => (
                <Badge
                    testID={`${kitchenQuotationRowTestId(String(row.id))}-status`}
                    tone={kitchenQuotationStatusTone(row.status)}
                    label={t(kitchenQuotationStatusKey(row.status))}
                />
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-quotations');
    const listFailure = toFailure(quotations.error);
    // The segment, the search and the header filters all narrow the same held rows, so "unfiltered"
    // and Clear have to answer for all three.
    const unfiltered = filter === 'all' && search === '' && !controls.filtered;
    const clearFilters = () => {
        setFilter('all');
        setSearch('');
        controls.clearFilters();
    };

    if (openId !== null) {
        return (
            <QuotationPricing
                id={openId}
                onBack={() => {
                    setOpenId(null);
                }}
                onListChanged={() => {
                    void quotations.refetch();
                }}
            />
        );
    }

    const loaded = quotations.isPending ? null : all.length;
    const awaiting = all.filter((row) => row.status === 'submitted').length;
    const quoted = all.filter((row) => row.status === 'quoted').length;

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-quotations-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={viewing.reference}
                kind={t('kitchen:ops.quotations.viewKind')}
                status={{
                    label: t(kitchenQuotationStatusKey(viewing.status)),
                    tone: kitchenQuotationStatusTone(viewing.status),
                }}
                fields={requestFields(viewing, t, formatter)}
                primaryAction={{
                    label: t('kitchen:ops.quotations.open'),
                    icon: null,
                    onPress: () => {
                        const id = viewing.id;
                        setViewing(null);
                        setOpenId(id);
                    },
                }}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-quotations-screen">
            {loaded === null || listFailure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-quotations-panel-metric"
                    cards={[
                        {
                            key: 'loaded',
                            label: t('kitchen:ops.quotations.metrics.loaded'),
                            value: String(loaded),
                            unit: t('kitchen:list.statRecords'),
                            caption: t('kitchen:ops.quotations.statLoadedCaption'),
                            mark: 'list',
                            tone: 'brand',
                            onPress: clearFilters,
                            accessibilityLabel: t('kitchen:ops.quotations.clearFilter'),
                        },
                        {
                            key: 'awaiting',
                            label: t('kitchen:ops.quotations.metrics.awaiting'),
                            value: String(awaiting),
                            unit: t('kitchen:list.statRecords'),
                            caption: t('kitchen:ops.quotations.statAwaitingCaption'),
                            mark: 'clock',
                            tone: awaiting === 0 ? 'default' : 'warning',
                            onPress: () => {
                                setFilter('awaiting');
                            },
                            accessibilityLabel: t('kitchen:ops.quotations.filter.awaiting'),
                        },
                        {
                            key: 'quoted',
                            label: t('kitchen:ops.quotations.metrics.quoted'),
                            value: String(quoted),
                            unit: t('kitchen:list.statRecords'),
                            caption: t('kitchen:ops.quotations.statQuotedCaption'),
                            mark: 'circleCheck',
                        },
                    ]}
                />
            )}

            <CatalogueToolbar<StatusFilter>
                testID="kitchen-quotations-toolbar"
                search={search}
                onSearchChange={(next) => {
                    setSearch(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.quotations.columnReference')}
                statusLabel={t('kitchen:ops.quotations.filterLabel')}
                statusSegments={FILTERS.map((value) => ({
                    value,
                    label: t(`kitchen:ops.quotations.filter.${value}`),
                }))}
                status={filter}
                onStatusChange={(next) => {
                    setFilter(next);
                    setViewing(null);
                }}
            >
                <ColumnPicker {...controls.picker} />
            </CatalogueToolbar>

            {quotations.isPending ? (
                <Stack space="xs" testID="kitchen-quotations-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-row-sm" />
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
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-quotations-empty"
                    title={t(
                        unfiltered
                            ? 'kitchen:ops.quotations.emptyTitle'
                            : 'kitchen:ops.quotations.filteredEmptyTitle',
                    )}
                    body={t(
                        unfiltered
                            ? 'kitchen:ops.quotations.emptyBody'
                            : 'kitchen:ops.quotations.filteredEmptyBody',
                    )}
                    actions={
                        unfiltered ? undefined : (
                            <Button
                                testID="kitchen-quotations-clear"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:ops.quotations.clearFilter')}
                                onPress={clearFilters}
                            />
                        )
                    }
                />
            ) : (
                <CatalogueList<KitchenQuotation>
                    testID="kitchen-quotations-table"
                    label={t('kitchen:ops.quotations.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => String(row.id)}
                    density="sm"
                    onRowPress={(row) => {
                        setOpenId(row.id);
                    }}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    rowActions={(row): readonly MenuItem[] => [
                        {
                            key: 'view',
                            label: t('kitchen:list.view'),
                            icon: CATALOGUE_ROW_ICONS.view,
                            testID: `${kitchenQuotationRowTestId(String(row.id))}-view`,
                            onSelect: () => {
                                setViewing(row);
                            },
                        },
                        {
                            key: 'edit',
                            label: t('kitchen:catalogue.edit'),
                            icon: CATALOGUE_ROW_ICONS.edit,
                            testID: `${kitchenQuotationRowTestId(String(row.id))}-open`,
                            onSelect: () => {
                                setOpenId(row.id);
                            },
                        },
                    ]}
                />
            )}
        </Stack>
    );
}

/** The pricing page: the request, the lines with their price inputs, the totals and Send. */
function QuotationPricing({
    id,
    onBack,
    onListChanged,
}: {
    readonly id: QuotationId;
    readonly onBack: () => void;
    readonly onListChanged: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const canQuote = useCan(B2B_QUOTATION_QUOTE_PERMISSION);

    /** Line id → the major-unit string typed. Empty on open: nothing is pre-filled. */
    const [prices, setPrices] = useState<Readonly<Record<string, string>>>({});
    const detail = useKitchenQuotationQuery(id);
    const quote = useQuoteQuotationMutation();

    const quotation = detail.data ?? null;
    const lines: readonly KitchenQuotationLine[] = quotation?.lines ?? NO_LINES;
    const currency: CurrencyCode = quotation?.currencyCode ?? 'USD';
    const editable = quotation !== null && canQuote && canQuoteKitchenQuotation(quotation.status);

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
    const detailFailure = toFailure(detail.error);

    const lineColumns = quotationLineColumns({
        t,
        formatter,
        currency,
        prices: editable ? prices : undefined,
        onPrice: (lineId, value) => {
            setPrices((current) => ({ ...current, [lineId]: value }));
            quote.reset();
        },
    });
    // The detail read carries every line, so sorting them here is the whole answer.
    const lineControls = useColumnControls(lines, lineColumns, 'kitchen-quotations-detail-lines');

    // While editing, the total follows what is typed; otherwise it is the record's own sum.
    const total = editable
        ? parsedPrices === null
            ? null
            : lines.reduce(
                  (sum, line) =>
                      sum +
                      Math.round(
                          Number(line.quantity) *
                              (parsedPrices.find((price) => price.quotationLineId === line.id)
                                  ?.unitAmountMinor ?? 0),
                      ),
                  0,
              )
        : kitchenQuotationTotalMinor(lines);

    function submitPrices() {
        if (quotation === null || parsedPrices === null) return;
        quote.mutate(
            { id: quotation.id, lockVersion: quotation.lockVersion, prices: parsedPrices },
            {
                onSuccess: (next) => {
                    setPrices({});
                    onListChanged();
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

    return (
        <Stack space="md" testID="kitchen-quotations-screen">
            <View className="flex-row">
                <Button
                    testID="kitchen-quotations-back"
                    variant="ghost"
                    size="sm"
                    iconStart={<Icon name="chevronStart" size="sm" />}
                    label={t('kitchen:common.back')}
                    onPress={onBack}
                />
            </View>

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
                <Stack space="md" testID="kitchen-quotations-detail-body">
                    <CataloguePageHeader
                        testID="kitchen-quotations-detail-header"
                        title={t('kitchen:ops.quotations.detailTitle', {
                            reference: quotation.reference,
                        })}
                        titleAside={
                            <Badge
                                testID="kitchen-quotations-detail-status"
                                tone={kitchenQuotationStatusTone(quotation.status)}
                                label={t(kitchenQuotationStatusKey(quotation.status))}
                            />
                        }
                    />

                    {editable ? (
                        <Callout
                            testID="kitchen-quotations-price-guidance"
                            tone="info"
                            title={t('kitchen:ops.quotations.guidanceTitle')}
                            body={t('kitchen:ops.quotations.guidanceBody', { currency })}
                        />
                    ) : null}

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
                                        onListChanged();
                                    }}
                                />
                            }
                        />
                    ) : (
                        <Text testID="kitchen-quotations-action-error" tone="danger">
                            {quoteFailure.message}
                        </Text>
                    )}

                    <FormSection
                        first
                        title={t('kitchen:ops.quotations.requestHeading')}
                        testID="kitchen-quotations-detail-request"
                    >
                        <RecordWindowFieldGrid
                            testID="kitchen-quotations-detail"
                            fields={requestFields(quotation, t, formatter)}
                        />
                    </FormSection>

                    <FormSection
                        title={t('kitchen:ops.quotations.linesHeading')}
                        testID="kitchen-quotations-detail-lines-section"
                    >
                        {lines.length === 0 ? (
                            <Text testID="kitchen-quotations-detail-no-lines" tone="secondary">
                                {t('kitchen:ops.quotations.noLines')}
                            </Text>
                        ) : (
                            <WithColumnPicker picker={lineControls.picker}>
                                <DataList<KitchenQuotationLine>
                                    testID="kitchen-quotations-detail-lines"
                                    label={t('kitchen:ops.quotations.linesHeading')}
                                    columns={lineControls.columns}
                                    rows={lineControls.rows}
                                    rowKey={(line) => line.id}
                                />
                            </WithColumnPicker>
                        )}
                        <View
                            testID="kitchen-quotations-detail-totals"
                            className="flex-row items-baseline justify-end gap-snug border-t border-stroke-subtle pt-tight"
                        >
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:ops.quotations.total')}
                            </Text>
                            {/* `null` is not zero: a partly priced set has no total. */}
                            <Text
                                variant="strong"
                                tone={total === null ? 'danger' : 'brand'}
                                className="tabular-nums"
                                testID="kitchen-quotations-detail-total"
                            >
                                {total === null
                                    ? t('kitchen:ops.quotations.notPricedYet')
                                    : formatMoney(formatter, { amount: total, currency })}
                            </Text>
                        </View>
                    </FormSection>

                    {quotation.declineReason === null ? null : (
                        <FormSection
                            title={t('kitchen:ops.quotations.declineHeading')}
                            testID="kitchen-quotations-detail-decline"
                        >
                            <Text testID="kitchen-quotations-detail-decline-reason">
                                {quotation.declineReason}
                            </Text>
                        </FormSection>
                    )}

                    {editable ? (
                        <View className="flex-row flex-wrap items-center justify-end gap-snug border-t border-stroke-subtle pt-snug">
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.quotations.sendRule')}
                            </Text>
                            <Button
                                testID="kitchen-quotations-send"
                                label={t('kitchen:ops.quotations.send')}
                                loading={quote.isPending}
                                disabled={quote.isPending || parsedPrices === null}
                                onPress={submitPrices}
                            />
                        </View>
                    ) : null}
                </Stack>
            )}
        </Stack>
    );
}

function submittedText(row: KitchenQuotation, t: TFunction, formatter: Formatter): string {
    return row.submittedAt === null
        ? t('kitchen:common.notRecorded')
        : formatter.formatDate(row.submittedAt);
}

/** The request as read-only pairs: programme, currency (stated, never chosen), dates, the note. */
function requestFields(quotation: KitchenQuotation, t: TFunction, formatter: Formatter) {
    const date = (value: string | null) =>
        value === null ? t('kitchen:common.notRecorded') : formatter.formatDate(value);
    return [
        {
            key: 'programme',
            label: t('kitchen:ops.quotations.programme'),
            value: String(quotation.programmeId),
            mono: true,
        },
        {
            key: 'currency',
            label: t('kitchen:ops.quotations.currency'),
            value: quotation.currencyCode,
            mono: true,
        },
        {
            key: 'submitted-at',
            label: t('kitchen:ops.quotations.submittedAt'),
            value: date(quotation.submittedAt),
            mono: true,
        },
        {
            key: 'expires-at',
            label: t('kitchen:ops.quotations.expiresAt'),
            value: date(quotation.expiresAt),
            mono: true,
        },
        ...(quotation.quotedAt === null
            ? []
            : [
                  {
                      key: 'quoted-at',
                      label: t('kitchen:ops.quotations.quotedAt'),
                      value: date(quotation.quotedAt),
                      mono: true,
                  },
              ]),
        ...(quotation.decidedAt === null
            ? []
            : [
                  {
                      key: 'decided-at',
                      label: t('kitchen:ops.quotations.decidedAt'),
                      value: date(quotation.decidedAt),
                      mono: true,
                  },
              ]),
        {
            key: 'notes',
            label: t('kitchen:ops.quotations.notes'),
            value: quotation.notes ?? t('kitchen:ops.quotations.noNotes'),
        },
    ];
}
