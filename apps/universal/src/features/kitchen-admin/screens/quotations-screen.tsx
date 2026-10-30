import { QuotationId } from '@healthy360/domain-types';
import { KITCHEN_QUOTATION_STATUSES } from '@healthy360/api-client/contracts';
import type {
    KitchenQuotation,
    KitchenQuotationLine,
    KitchenQuotationStatus,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    FormSection,
    IssueTrayFrame,
    RecordSkeleton,
    RecordWindowFieldGrid,
    TableSkeleton,
    Text,
    useIssueTrayController,
    useToast,
} from '@healthy360/design-system';
import type { IssueCardItem, IssueTrayContent, MenuItem } from '@healthy360/design-system';
import type { CurrencyCode } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

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
import { useCataloguePort } from '../catalogue/catalogue-nav.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart, LensTone } from '../catalogue/lens-bar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { quotationLineColumns } from '../commercial/quotation-line-columns.tsx';
import {
    B2B_QUOTATION_QUOTE_PERMISSION,
    B2B_QUOTATION_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { displayName, parseMinorAmount } from '../format.ts';
import {
    canQuoteKitchenQuotation,
    kitchenQuotationRowTestId,
    kitchenQuotationStatusKey,
    kitchenQuotationStatusTone,
    kitchenQuotationTotalMinor,
} from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { focusField } from '../field-focus.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { useUnsavedGuardFor } from '../use-unsaved-guard.ts';
import { RecordSummaryAside } from '../record-summary-aside.tsx';
import { useNudgeOnRefusal } from '../tray-nudge.ts';
import { RECORD_NOT_FOUND, useViewedRecord } from '../use-viewed-record.ts';

/** The request `?view=` names, read on its own when the loaded page does not hold it. */
function useQuotationById(id: string | null) {
    const parsed = QuotationId.safeParse(id);
    const record = useKitchenQuotationQuery(parsed);
    return parsed === null ? RECORD_NOT_FOUND : record;
}

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
 * Major units in, minor units out through `parseMinorAmount`. **Every line, or none**: until every
 * line parses, Send takes the reader to the first that does not and the issue tray's card says why;
 * zero is accepted, empty is not. Currency is stated, never chosen. A conflict and a stale
 * quotation are answered with a re-read, told apart in the copy.
 *
 * ## Filtering and search happen here because the endpoint offers none
 *
 * `GET /b2b/kitchen/quotations` takes no parameters and no cursor, so the segments and the search
 * narrow rows already held, and there is no pager — there is no next page (§6.5).
 *
 * The same is what makes every header honest in memory: Reference and Submitted sort, Currency and
 * Status filter, and all four act on the whole queue because the whole queue is what was answered.
 */

/** The summary's fixed track, and the least the cards beside it keep before it drops under them. */
const ASIDE_WIDTH = 300;
const FORM_MIN_WIDTH = 620;
const COLUMN_GAP = 16;

/** The `requestFields` the request card shows; the rest live in the summary or their own card. */
const REQUEST_CARD_FIELDS: ReadonlySet<string> = new Set([
    'buyer',
    'contact',
    'requested-delivery',
    'schedule',
    'order',
]);

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

export function QuotationsScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [B2B_QUOTATION_VIEW_PERMISSION] }}
            testID="kitchen-quotations"
        >
            <Quotations view={view} />
        </Gate>
    );
}

function Quotations({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();

    const [filter, setFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [openId, setOpenId] = useState<QuotationId | null>(null);

    const quotations = useKitchenQuotationsQuery();
    const all: readonly KitchenQuotation[] = quotations.data ?? NO_QUOTATIONS;
    // The open request is an address, `?view=`, so Back and a refresh keep it open.
    const { viewing, setViewing } = useViewedRecord(
        view,
        all,
        (row) => String(row.id),
        quotations.isSuccess && !quotations.isFetching,
        { useLookup: useQuotationById },
    );

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
            key: 'buyer',
            role: 'meta',
            label: t('kitchen:ops.quotations.buyer'),
            width: 200,
            grow: true,
            priority: 90,
            value: (row) => row.buyerName ?? t('kitchen:common.notRecorded'),
            sort: (left, right, direction) =>
                compareText(left.buyerName ?? '', right.buyerName ?? '', direction),
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
            // One status at a time, all five — the figures fold three of them into Closed, and
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
    // The status figure, the search and the header filters all narrow the same held rows, so "unfiltered"
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
                fields={requestFields(viewing, t, formatter, locale)}
                primaryAction={{
                    label: t('kitchen:ops.quotations.open'),
                    icon: null,
                    // The request stays open underneath, so closing the quote comes back to it.
                    onPress: () => {
                        setOpenId(viewing.id);
                    },
                }}
            />
        );
    }

    // A failed read has no figures to state; the bar holds its placeholders over the error.
    const pending = quotations.isPending || listFailure !== null;
    const filterToken = t('kitchen:lens.token', {
        label: t('kitchen:toolbar.statusLabel'),
        value: t(`kitchen:ops.quotations.filter.${filter}`),
    });

    return (
        <Cascade space="md" testID="kitchen-quotations-screen">
            <LensBar
                testID="kitchen-quotations-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(all, pending, filter, t, (next) => {
                    setFilter(next);
                    setViewing(null);
                })}
                {...(pending ? {} : lensMix(all, filter, t))}
                search={search}
                onSearchChange={(next) => {
                    setSearch(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.quotations.columnReference')}
                tokens={
                    filter === 'all'
                        ? []
                        : [
                              {
                                  key: 'status',
                                  label: filterToken,
                                  removeLabel: t('kitchen:toolbar.removeFilter', {
                                      filter: filterToken,
                                  }),
                                  onRemove: () => {
                                      setFilter('all');
                                  },
                              },
                          ]
                }
                result={
                    pending
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: all.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered ? {} : { onClear: clearFilters })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
            />

            {quotations.isPending ? (
                <TableSkeleton testID="kitchen-quotations-loading" />
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
        </Cascade>
    );
}

/**
 * The pricing page, laid out as the supply order page is: the record-form opening with Back and
 * Send in it, the cards down the page, and beside them a sticky summary of the request.
 *
 * ```
 * Quotation H360-Q-0012  AWAITING A PRICE            [ Back to quotations ] [ Send prices ]
 * Test employee meals · submitted 20 Oct 2026
 * ┌ LINES  6 lines ───────────────────────────────┐  ┌ THIS QUOTATION ──────────┐
 * │ Line           Quantity  Unit price  Total    │  │ Programme   Employee ... │
 * └───────────────────────────────────────────────┘  │ Currency             USD │
 * ┌ THE REQUEST ──────────────────────────────────┐  │ Total            $56.00  │
 * │ Buyer · Reply to · Delivery · Schedule · Order│  │ Timeline                 │
 * └───────────────────────────────────────────────┘  └──────────────────────────┘
 * ┌ BUYER'S NOTE ─────────────────────────────────┐
 * └───────────────────────────────────────────────┘
 * ```
 */
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
    const { locale } = useLocale();
    const toast = useToast();
    const canQuote = useCan(B2B_QUOTATION_QUOTE_PERMISSION);

    /** Line id → the major-unit string typed. Empty on open: nothing is pre-filled. */
    const [prices, setPrices] = useState<Readonly<Record<string, string>>>({});
    const detail = useKitchenQuotationQuery(id);
    const quote = useQuoteQuotationMutation();
    const port = useCataloguePort();

    const quotation = detail.data ?? null;
    const lines: readonly KitchenQuotationLine[] = quotation?.lines ?? NO_LINES;
    const currency: CurrencyCode = quotation?.currencyCode ?? 'USD';
    const editable = quotation !== null && canQuote && canQuoteKitchenQuotation(quotation.status);
    // Prices typed and not sent: Back to quotations, the trail and the browser's Back ask first.
    const dirty = editable && Object.values(prices).some((value) => value.trim() !== '');
    const guard = useUnsavedGuardFor(dirty, { message: t('kitchen:unsaved.browserPrompt') });

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

    // The pricing page's issue tray; a refused send opens it.
    const issueTray = useIssueTrayController();
    const { nudge: nudgeTray } = issueTray;
    useNudgeOnRefusal(quote.error, nudgeTray);

    const lineColumns = quotationLineColumns({
        t,
        formatter,
        locale,
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

    /** The first line whose price does not parse yet — empty or mistyped. */
    const firstUnpriced = (): KitchenQuotationLine | undefined =>
        lines.find((line) => parseMinorAmount(prices[line.id] ?? '', currency) === null);

    function submitPrices() {
        if (quotation === null) return;
        if (parsedPrices === null) {
            // Every line needs a price: Send takes the reader to the first one that has none.
            const first = firstUnpriced();
            if (first !== undefined) focusField(`kitchen-quotation-line-${first.id}-price`);
            nudgeTray();
            return;
        }
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

    const backButton = (
        <Button
            testID="kitchen-quotations-back"
            variant="secondary"
            label={t('kitchen:ops.quotations.backToQuotations')}
            onPress={() => {
                guard.intercept(onBack);
            }}
        />
    );

    if (detail.isPending || detailFailure !== null || quotation === null) {
        return (
            <Cascade space="md" testID="kitchen-quotations-screen">
                <View className="flex-row">{backButton}</View>
                {detail.isPending ? (
                    <RecordSkeleton testID="kitchen-quotations-detail-loading" tiles={0} rows={4} />
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
                ) : null}
            </Cascade>
        );
    }

    const date = (value: string) => formatter.formatDate(value, { dateStyle: 'medium' });
    const programme =
        quotation.programmeName === null
            ? String(quotation.programmeId)
            : displayName(quotation.programmeName, locale).value;
    const sideBySide = port.width >= ASIDE_WIDTH + FORM_MIN_WIDTH + COLUMN_GAP;
    // Programme, currency and the dates are in the summary and the note has its own card, so the
    // request card keeps who asked and the delivery they asked for.
    const requestCard = requestFields(quotation, t, formatter, locale).filter((field) =>
        REQUEST_CARD_FIELDS.has(field.key),
    );
    // Where it stands, oldest first; a step that has not happened is left out rather than dashed.
    const timeline = [
        {
            key: 'submitted-at',
            label: t('kitchen:ops.quotations.submittedAt'),
            at: quotation.submittedAt,
        },
        { key: 'quoted-at', label: t('kitchen:ops.quotations.quotedAt'), at: quotation.quotedAt },
        {
            key: 'decided-at',
            label: t('kitchen:ops.quotations.decidedAt'),
            at: quotation.decidedAt,
        },
        {
            key: 'expires-at',
            label: t('kitchen:ops.quotations.expiresAt'),
            at: quotation.expiresAt,
        },
    ];

    /*
     * What stands between this request and sent prices, in the page's issue tray: a line still
     * without a price — the card ticks off once the last one parses — and a refused send. A
     * conflict and a stale quotation are told apart and both answered with a re-read; anything
     * else keeps the server's own words.
     */
    const unpriced = editable && parsedPrices === null ? firstUnpriced() : undefined;
    const saveCards: IssueCardItem[] = [
        ...(unpriced === undefined
            ? []
            : [
                  {
                      key: 'unpriced',
                      tone: 'warning' as const,
                      label: t('kitchen:ops.quotations.guidanceTitle'),
                      action: {
                          onPress: () => {
                              focusField(`kitchen-quotation-line-${unpriced.id}-price`);
                          },
                      },
                      testID: 'kitchen-quotations-price-guidance',
                  },
              ]),
        ...(quoteFailure === null
            ? []
            : isConflict || isStale
              ? [
                    {
                        key: 'conflict',
                        tone: 'warning' as const,
                        label: t(
                            isStale
                                ? 'kitchen:ops.quotations.staleTitle'
                                : 'kitchen:ops.quotations.conflictTitle',
                        ),
                        action: {
                            label: t('kitchen:ops.quotations.conflictRefresh'),
                            loading: detail.isFetching,
                            testID: 'kitchen-quotations-conflict-refresh',
                            onPress: () => {
                                quote.reset();
                                void detail.refetch();
                                onListChanged();
                            },
                        },
                        testID: 'kitchen-quotations-conflict',
                    },
                ]
              : [
                    {
                        key: 'send-error',
                        tone: 'danger' as const,
                        label: t('kitchen:editor.saveError'),
                        detail: quoteFailure.message,
                        testID: 'kitchen-quotations-action-error',
                    },
                ]),
    ];
    const trayContent: IssueTrayContent = {
        title: t('kitchen:tray.title'),
        testID: 'kitchen-quotations-detail-tray',
        groups: [{ key: 'save', title: t('kitchen:tray.groupSave'), items: saveCards }],
    };

    return (
        <IssueTrayFrame tray={trayContent} controller={issueTray}>
            <Cascade space="md" testID="kitchen-quotations-screen">
                {/*
                 * The way back first and the commit last; the summary beside the cards repeats
                 * neither.
                 */}
                <RecordFormOpening
                    testID="kitchen-quotations-detail"
                    title={t('kitchen:ops.quotations.detailTitle', {
                        reference: quotation.reference,
                    })}
                    dirty={dirty}
                    badges={
                        <Badge
                            variant="label"
                            testID="kitchen-quotations-detail-status"
                            tone={kitchenQuotationStatusTone(quotation.status)}
                            label={t(kitchenQuotationStatusKey(quotation.status))}
                        />
                    }
                    details={
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID="kitchen-quotations-detail-subtitle"
                        >
                            {t('kitchen:ops.quotations.detailSubtitle', {
                                programme,
                                date:
                                    quotation.submittedAt === null
                                        ? t('kitchen:common.notRecorded')
                                        : date(quotation.submittedAt),
                            })}
                        </Text>
                    }
                    actions={
                        <>
                            {backButton}
                            {editable ? (
                                <Button
                                    testID="kitchen-quotations-send"
                                    label={t('kitchen:ops.quotations.send')}
                                    loading={quote.isPending}
                                    disabled={quote.isPending || lines.length === 0}
                                    onPress={submitPrices}
                                />
                            ) : null}
                        </>
                    }
                />

                <View
                    ref={Platform.OS === 'web' ? port.ref : undefined}
                    onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
                    className={
                        sideBySide
                            ? 'z-auto flex-row items-start gap-base'
                            : 'z-auto flex-col gap-base'
                    }
                >
                    {/* The cards are the row's filler beside the fixed summary. */}
                    <View
                        testID="kitchen-quotations-detail-body"
                        className="z-auto min-w-0 flex-1 flex-col gap-base"
                    >
                        <FormSection
                            first
                            variant="card"
                            title={t('kitchen:ops.quotations.linesHeading')}
                            testID="kitchen-quotations-detail-lines-section"
                            aside={
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-quotations-detail-line-count"
                                >
                                    {t('kitchen:ops.quotations.lineCount', { count: lines.length })}
                                </Text>
                            }
                            actions={
                                lines.length === 0 ? undefined : (
                                    <ColumnPicker {...lineControls.picker} />
                                )
                            }
                        >
                            {lines.length === 0 ? (
                                <Text testID="kitchen-quotations-detail-no-lines" tone="secondary">
                                    {t('kitchen:ops.quotations.noLines')}
                                </Text>
                            ) : (
                                <CatalogueList<KitchenQuotationLine>
                                    testID="kitchen-quotations-detail-lines"
                                    label={t('kitchen:ops.quotations.linesHeading')}
                                    columns={lineControls.columns}
                                    rows={lineControls.rows}
                                    rowKey={(line) => line.id}
                                    density="sm"
                                    rowActionsLabel={t('kitchen:list.rowActions')}
                                />
                            )}
                        </FormSection>

                        <FormSection
                            first
                            variant="card"
                            title={t('kitchen:ops.quotations.requestHeading')}
                            testID="kitchen-quotations-detail-request"
                        >
                            <RecordWindowFieldGrid
                                testID="kitchen-quotations-detail-request-fields"
                                fields={requestCard}
                            />
                        </FormSection>

                        <FormSection
                            first
                            variant="card"
                            title={t('kitchen:ops.quotations.notes')}
                            testID="kitchen-quotations-detail-notes"
                        >
                            <Text
                                tone={quotation.notes === null ? 'secondary' : 'primary'}
                                testID="kitchen-quotations-detail-notes-text"
                            >
                                {quotation.notes ?? t('kitchen:ops.quotations.noNotes')}
                            </Text>
                        </FormSection>

                        {quotation.declineReason === null ? null : (
                            <FormSection
                                first
                                variant="card"
                                title={t('kitchen:ops.quotations.declineHeading')}
                                testID="kitchen-quotations-detail-decline"
                            >
                                <Text testID="kitchen-quotations-detail-decline-reason">
                                    {quotation.declineReason}
                                </Text>
                            </FormSection>
                        )}
                    </View>

                    {/*
                     * The request in a few facts, its total and where it stands. While pricing,
                     * the total follows what is typed; `null` is not zero — a partly priced set
                     * has none.
                     */}
                    <RecordSummaryAside
                        testID="kitchen-quotations-detail-summary"
                        title={t('kitchen:ops.quotations.summaryTitle')}
                        width={sideBySide ? ASIDE_WIDTH : null}
                        rows={[
                            {
                                key: 'programme',
                                label: t('kitchen:ops.quotations.programme'),
                                value: programme,
                            },
                            {
                                key: 'currency',
                                label: t('kitchen:ops.quotations.currency'),
                                value: quotation.currencyCode,
                            },
                            {
                                key: 'lines',
                                label: t('kitchen:ops.quotations.linesHeading'),
                                value: formatter.formatNumber(lines.length),
                            },
                        ]}
                        total={{
                            label: t('kitchen:ops.quotations.total'),
                            value:
                                total === null
                                    ? t('kitchen:ops.quotations.notPricedYet')
                                    : formatMoney(formatter, { amount: total, currency }),
                        }}
                        list={{
                            title: t('kitchen:ops.quotations.timelineHeading'),
                            empty: t('kitchen:common.notRecorded'),
                            testID: 'kitchen-quotations-detail-timeline',
                            emptyTestID: 'kitchen-quotations-detail-timeline-empty',
                            items: timeline.flatMap((entry) =>
                                entry.at === null
                                    ? []
                                    : [
                                          {
                                              key: entry.key,
                                              testID: `kitchen-quotations-detail-timeline-${entry.key}`,
                                              name: entry.label,
                                              value: date(entry.at),
                                          },
                                      ],
                            ),
                        }}
                    />
                </View>
                <EditorGuardDialogs guard={guard} testID="kitchen-quotations-detail" />
            </Cascade>
        </IssueTrayFrame>
    );
}

const FILTER_TONES: Readonly<Record<Exclude<StatusFilter, 'all'>, LensTone>> = {
    awaiting: 'warning',
    quoted: 'info',
    closed: 'neutral',
};

/** How many held quotations each segment of the queue holds. The three partition it. */
function filterCount(all: readonly KitchenQuotation[], filter: StatusFilter): number {
    const allowed = FILTER_STATUSES[filter];
    return allowed.length === 0
        ? all.length
        : all.filter((row) => allowed.includes(row.status)).length;
}

/**
 * The Lens bar's figures: All, then Awaiting a price · Priced · Closed. The whole queue is held, so
 * every figure counts all of it, whatever is in force.
 */
function lensFigures(
    all: readonly KitchenQuotation[],
    pending: boolean,
    filter: StatusFilter,
    t: TFunction,
    setFilter: (next: StatusFilter) => void,
): readonly LensFigure[] {
    return FILTERS.map((value, index): LensFigure => {
        const label = t(`kitchen:ops.quotations.filter.${value}`);
        return {
            key: value,
            label: value === 'all' ? t('kitchen:lens.allQuotations') : label,
            value: pending ? null : filterCount(all, value),
            ...(value === 'all' ? {} : { tone: FILTER_TONES[value] }),
            separated: index === 1,
            active: filter === value,
            onPress: () => {
                setFilter(value);
            },
            accessibilityLabel:
                value === 'all'
                    ? t('kitchen:lens.allAction')
                    : t('kitchen:lens.showOnlyStatus', { status: label }),
        };
    });
}

/** How the queue divides between the three, and the same in words. */
function lensMix(
    all: readonly KitchenQuotation[],
    filter: StatusFilter,
    t: TFunction,
): { readonly mix: readonly LensMixPart[]; readonly mixLabel: string } {
    return {
        mix: (['awaiting', 'quoted', 'closed'] as const).map((value) => ({
            key: value,
            value: filterCount(all, value),
            tone: FILTER_TONES[value],
            dimmed: filter !== 'all' && filter !== value,
        })),
        mixLabel: t('kitchen:lens.quotationsMix', {
            awaiting: filterCount(all, 'awaiting'),
            quoted: filterCount(all, 'quoted'),
            closed: filterCount(all, 'closed'),
        }),
    };
}

function submittedText(row: KitchenQuotation, t: TFunction, formatter: Formatter): string {
    return row.submittedAt === null
        ? t('kitchen:common.notRecorded')
        : formatter.formatDate(row.submittedAt);
}

/** The request as read-only pairs: programme, currency (stated, never chosen), dates, the note. */
function requestFields(
    quotation: KitchenQuotation,
    t: TFunction,
    formatter: Formatter,
    locale: string,
) {
    const date = (value: string | null) =>
        value === null ? t('kitchen:common.notRecorded') : formatter.formatDate(value);
    return [
        ...(quotation.buyerName === null
            ? []
            : [
                  {
                      key: 'buyer',
                      label: t('kitchen:ops.quotations.buyer'),
                      value: quotation.buyerName,
                  },
              ]),
        {
            key: 'programme',
            label: t('kitchen:ops.quotations.programme'),
            value:
                quotation.programmeName === null
                    ? String(quotation.programmeId)
                    : displayName(quotation.programmeName, locale).value,
            mono: quotation.programmeName === null,
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
            key: 'requested-delivery',
            label: t('kitchen:ops.quotations.requestedDelivery'),
            value: date(quotation.requestedDeliveryDate),
            mono: true,
        },
        {
            key: 'schedule',
            label: t('kitchen:ops.quotations.schedule'),
            value: quotation.recurring
                ? t('kitchen:ops.quotations.recurring')
                : t('kitchen:ops.quotations.oneOff'),
        },
        ...(quotation.contactName === null && quotation.contactEmail === null
            ? []
            : [
                  {
                      key: 'contact',
                      label: t('kitchen:ops.quotations.contact'),
                      value: [quotation.contactName, quotation.contactEmail]
                          .filter((part): part is string => part !== null)
                          .join(' · '),
                  },
              ]),
        ...(quotation.orderNumber === null
            ? []
            : [
                  {
                      key: 'order',
                      label: t('kitchen:ops.quotations.order'),
                      // A repeating quotation placed a run: every order, with its day.
                      value:
                          quotation.orders.length > 1
                              ? quotation.orders
                                    .map(
                                        (order) =>
                                            `${order.orderNumber ?? '—'} (${formatter.formatDate(order.deliveryDate)})`,
                                    )
                                    .join(', ')
                              : quotation.orderNumber,
                      mono: true,
                  },
              ]),
        {
            key: 'notes',
            label: t('kitchen:ops.quotations.notes'),
            value: quotation.notes ?? t('kitchen:ops.quotations.noNotes'),
        },
        ...(quotation.declineReason === null
            ? []
            : [
                  {
                      key: 'decline-reason',
                      label: t('kitchen:ops.quotations.declineReason'),
                      value: quotation.declineReason,
                  },
              ]),
    ];
}
