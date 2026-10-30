import type { PriceListAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    Inline,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { PriceListId, SALES_CHANNELS } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    KITCHEN_PAGE_SIZE,
    pagesInResult,
    usePriceListPageQuery,
    usePriceListWholeSetQuery,
    usePriceListQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { statusLensFigures, statusLensMix, statusLensTokens } from '../catalogue/lens-status.ts';
import type { StatusLensSource } from '../catalogue/lens-status.ts';
import { inStatuses, statusTally, withoutStatuses } from '../catalogue/use-catalogue-filters.ts';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { CATALOGUE_VIEW_PERMISSION, PRICE_LIST_MANAGE_PERMISSION } from '../entity-registry.ts';
import {
    PRICE_LIST_STATUS_FILTERS,
    channelKey,
    displayName,
    isAgreementPriced,
    priceListRowTestId,
    statusShortKey,
    statusTone,
    summarisePriceEntries,
} from '../format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { NewPriceListDialog } from '../new-price-list-dialog.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedPage,
    useRememberedQuery,
    useRestoredPageFallback,
} from '../list-memory.ts';
import { RECORD_NOT_FOUND, useViewedRecord } from '../use-viewed-record.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';

/** Frozen empty, so "no rows yet" keeps one identity across renders. */
const NO_ROWS: readonly PriceListAdmin[] = [];

/** The price list `?view=` names, read on its own when the loaded page does not hold it. */
function usePriceListById(id: string | null) {
    const parsed = PriceListId.safeParse(id);
    const record = usePriceListQuery(parsed);
    return parsed === null ? RECORD_NOT_FOUND : record;
}

/**
 * `/kitchen/price-lists` — what this kitchen charges, and how much of it is actually decided
 * (Commercial handoff §3.1).
 *
 * ```
 * (All price lists 40) │ ● Published ● Draft ● Review │ ● Nothing priced ● Agreement   [+ New]
 * [ ⌕ search ] [Status: Draft ×]                                    18 of 40  Clear │ ▤
 * ◉ Negotiated prices are on this screen …
 * PRICE LIST          CURRENCY  CHANNELS      ENTRIES                     STATUS  UPDATED   ◉ ✎
 * Showing 1–25 of 40                                                          [ ‹ 1 2 › ]
 * ```
 *
 * The Catalogue list's parts, with nothing rebuilt: `LensBar`, `CatalogueList` with a column spec,
 * `CataloguePager`, and the `RecordWindow` behind View.
 *
 * ## Create, but no archive
 *
 * *New price list* opens `NewPriceListDialog` — name, code, currency and who it prices — and the
 * draft it creates opens in the editor, where its prices are added. `KitchenAdminRepository` has no
 * `retirePriceList`, so no row offers Archive (§6.1). Publish lives in the editor, where the
 * entries being decided about are on screen.
 *
 * ## The entry split is the column this screen exists for
 *
 * "12 entries · 10 confirmed", and a list pricing nothing reads `Nothing priced yet`, never `0` —
 * a price list of forty rows of which three are confirmed is not forty prices.
 *
 * ## The confidential banner
 *
 * Any list on a contract-private channel is negotiated paperwork inside one buyer relationship, so
 * the banner sits above the list whenever one is on the page, and the row carries `Agreement`.
 */
export function PriceListsScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-price-lists"
        >
            <PriceListsList view={view} />
        </Gate>
    );
}

type StatusSegmentValue = PublishableStatus | 'all';

function PriceListsList({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const canManage = useCan(PRICE_LIST_MANAGE_PERMISSION);
    const [creating, setCreating] = useState(false);

    // Search, filters, page and the row last opened survive leaving the list for a price list.
    const memory = useListMemory('kitchen.price-lists');
    const [query, setQuery] = useRememberedQuery(memory);
    const [status, setStatus] = useRememberedFilter<StatusSegmentValue>(memory, 'status', 'all');
    const [channel, setChannel] = useRememberedFilter<SalesChannel | null>(memory, 'channel', null);
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(status === 'all' ? {} : { statuses: [status] }),
            ...(channel === null ? {} : { channels: [channel] }),
        }),
        [trimmed, status, channel],
    );
    const [page, setPage] = useRememberedPage(memory, filter);
    const priceLists = usePriceListPageQuery(filter, page);
    useRestoredPageFallback(memory, page, priceLists.isError, () => {
        setPage(1);
    });
    // Without the status, so the figures count every state in scope; `everyRow` re-applies it.
    const wholeSet = usePriceListWholeSetQuery(withoutStatuses(filter));
    const scopeRows = wholeSet.data ?? NO_ROWS;
    const statuses = useMemo(
        (): readonly PublishableStatus[] => (status === 'all' ? [] : [status]),
        [status],
    );
    const everyRow = useMemo(() => inStatuses(scopeRows, statuses), [scopeRows, statuses]);
    const statusCounts = useMemo(() => statusTally(scopeRows), [scopeRows]);
    const rows = useMemo(() => priceLists.data?.items ?? [], [priceLists.data]);
    // The open record is an address, `?view=`, so its editor can come back to it.
    const { viewing, viewingId, setViewing } = useViewedRecord(
        view,
        rows,
        (row) => String(row.id),
        priceLists.isSuccess && !priceLists.isFetching,
        { useLookup: usePriceListById },
    );
    const total = priceLists.data?.totalCount ?? null;
    const totalPages = pagesInResult(priceLists.data) ?? 0;

    /** From the record's page, the editor's Cancel, Save and trail come back to it. */
    const openEditor = (row: PriceListAdmin) => {
        const id = String(row.id);
        rememberOpened(id);
        router.push(
            withReturnTo(
                `/kitchen/price-lists/${id}`,
                viewingId === id ? withQuery('/kitchen/price-lists', { view: id }) : null,
            ) as never,
        );
    };

    const columns: readonly ControlledColumn<PriceListAdmin, CatalogueColumn<PriceListAdmin>>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:priceLists.columnName'),
            width: 220,
            priority: 100,
            value: (row) => displayName(row.name, locale).value,
            sort: (left, right, direction) =>
                compareText(
                    displayName(left.name, locale).value,
                    displayName(right.name, locale).value,
                    direction,
                ),
            render: (row) => {
                const testID = priceListRowTestId(String(row.id));
                const name = displayName(row.name, locale);
                return (
                    // `Inline`, as every other list's name cell: in a table cell it stays on one
                    // line and lets the name give way to an ellipsis (whole on hover), so a badge
                    // never runs into the next column.
                    <Inline testID={testID} space="xs" align="center">
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
                                tone="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                        {isAgreementPriced(row.channels) ? (
                            <Badge
                                testID={`${testID}-agreement`}
                                tone="warning"
                                label={t('kitchen:priceLists.agreementBadge')}
                            />
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'currency',
            role: 'meta',
            label: t('kitchen:priceLists.columnCurrency'),
            width: 80,
            priority: 70,
            value: (row) => row.currency,
            sort: (left, right, direction) => compareText(left.currency, right.currency, direction),
            render: (row) => (
                <Text variant="mono" testID={`${priceListRowTestId(String(row.id))}-currency`}>
                    {row.currency}
                </Text>
            ),
        },
        {
            key: 'channels',
            label: t('kitchen:priceLists.columnChannels'),
            width: 160,
            priority: 60,
            value: (row) => channelsText(row, t),
            // `PriceListAdminFilter.channels`, sent with the request: every channel the platform
            // declares, not only those on the loaded page, which would hide the rest.
            filter: {
                values: () =>
                    SALES_CHANNELS.map((value) => ({ key: value, label: t(channelKey(value)) })),
                external: {
                    value: channel,
                    onChange: (next) => {
                        setChannel(SALES_CHANNELS.find((value) => value === next) ?? null);
                        setViewing(null);
                    },
                },
            },
            render: (row) => (
                <Text tone="secondary" numberOfLines={2}>
                    {channelsText(row, t)}
                </Text>
            ),
        },
        {
            key: 'entries',
            role: 'metric',
            label: t('kitchen:priceLists.columnEntries'),
            width: 180,
            priority: 85,
            value: (row) => entriesText(row, t),
            // By confirmed prices, then by entries — a list of forty rows with three confirmed
            // is not ahead of one with ten.
            sort: (left, right, direction) => {
                const a = summarisePriceEntries(left.entries);
                const b = summarisePriceEntries(right.entries);
                return (
                    compareNumber(a.confirmed, b.confirmed, direction) ||
                    compareNumber(a.total, b.total, direction)
                );
            },
            render: (row) => {
                const testID = priceListRowTestId(String(row.id));
                const summary = summarisePriceEntries(row.entries);
                return summary.total === 0 ? (
                    <Text tone="secondary" testID={`${testID}-entries-none`}>
                        {t('kitchen:priceLists.noEntries')}
                    </Text>
                ) : (
                    <Inline space="xs" align="center">
                        <Text testID={`${testID}-entries`}>{entriesText(row, t)}</Text>
                        {summary.inconsistent === 0 ? null : (
                            <Badge
                                testID={`${testID}-entries-inconsistent`}
                                tone="danger"
                                label={t('kitchen:priceLists.inconsistentCount', {
                                    count: summary.inconsistent,
                                })}
                            />
                        )}
                    </Inline>
                );
            },
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 96,
            priority: 80,
            value: (row) => t(statusShortKey(row.meta.status)),
            filter: {
                values: () =>
                    PRICE_LIST_STATUS_FILTERS.map((value) => ({
                        key: value,
                        label: t(statusShortKey(value)),
                    })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        setStatus(next === null ? 'all' : (next as PublishableStatus));
                        setViewing(null);
                    },
                },
            },
            render: (row) => (
                <Badge
                    testID={`${priceListRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            label: t('kitchen:list.columnUpdated'),
            width: 110,
            priority: 20,
            value: (row) => formatter.formatRelativeTime(row.meta.updatedAt),
            sort: (left, right, direction) =>
                compareText(left.meta.updatedAt, right.meta.updatedAt, direction),
            render: (row) => (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {formatter.formatRelativeTime(row.meta.updatedAt)}
                </Text>
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-price-lists');
    const failure = toFailure(priceLists.error);
    const unfiltered = trimmed === '' && status === 'all' && channel === null;

    const lens: StatusLensSource = {
        total,
        scopeCount: scopeRows.length,
        statusCounts,
        countsPending: wholeSet.isPending,
        statuses,
        setStatuses: (next) => {
            setStatus(next[0] ?? 'all');
            setViewing(null);
        },
    };

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-price-lists-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={displayName(viewing.name, locale).value}
                kind={t('kitchen:priceLists.viewKind')}
                status={{
                    label: t(statusShortKey(viewing.meta.status)),
                    tone: statusTone(viewing.meta.status),
                }}
                {...(isAgreementPriced(viewing.channels)
                    ? { note: t('kitchen:priceLists.confidentialBody') }
                    : {})}
                fields={viewFields(viewing, t, formatter)}
                primaryAction={{
                    label: t('kitchen:catalogue.edit'),
                    onPress: () => {
                        openEditor(viewing);
                    },
                }}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-price-lists-screen">
            {/*
             * The Lens bar — figures, mix, query row and actions as one object directly over the
             * list it narrows (`lens-bar.tsx`), as on the product list.
             */}
            <LensBar
                testID="kitchen-price-lists-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(lens, everyRow, t)}
                {...statusLensMix(lens, t)}
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                tokens={statusLensTokens(lens, t)}
                result={
                    total === null
                        ? null
                        : t('kitchen:lens.result', {
                              shown: Math.min(page * KITCHEN_PAGE_SIZE, total),
                              total,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered
                    ? {}
                    : {
                          onClear: () => {
                              setQuery('');
                              setStatus('all');
                              setChannel(null);
                              setViewing(null);
                          },
                      })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-price-lists-toolbar-create"
                            label={t('kitchen:priceLists.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                setCreating(true);
                            }}
                        />
                    ) : undefined
                }
            />

            {creating ? (
                <NewPriceListDialog
                    testID="kitchen-price-lists-create"
                    knownCurrency={rows[0]?.currency ?? null}
                    onClose={() => {
                        setCreating(false);
                    }}
                />
            ) : null}

            {priceLists.isPending ? (
                <TableSkeleton
                    testID="kitchen-price-lists-loading"
                    partTestID="kitchen-price-lists"
                />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-price-lists-error"
                    failure={failure}
                    onRetry={() => {
                        void priceLists.refetch();
                    }}
                    retrying={priceLists.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-price-lists-empty"
                    title={
                        unfiltered
                            ? t('kitchen:priceLists.emptyTitle')
                            : t('kitchen:priceLists.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:priceLists.emptyBody')
                            : t('kitchen:priceLists.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<PriceListAdmin>
                        testID="kitchen-price-lists-table"
                        label={t('kitchen:priceLists.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        highlightedId={lastOpenedId}
                        onRowPress={openEditor}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        // View and Edit. No Archive: the contract publishes no retire (§6.1).
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${priceListRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    rememberOpened(String(row.id));
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:catalogue.edit'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${priceListRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    openEditor(row);
                                },
                            },
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-price-lists-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPage(next);
                            setViewing(null);
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}
        </Cascade>
    );
}

function channelsText(row: PriceListAdmin, t: TFunction): string {
    return row.channels.length === 0
        ? t('kitchen:priceLists.noChannels')
        : row.channels.map((channel) => t(channelKey(channel))).join(', ');
}

/** "12 entries · 10 confirmed" — the two facts, or the words for none. */
function entriesText(row: PriceListAdmin, t: TFunction): string {
    const summary = summarisePriceEntries(row.entries);
    if (summary.total === 0) return t('kitchen:priceLists.noEntries');
    return `${t('kitchen:priceLists.entryCount', { count: summary.total })} · ${t(
        'kitchen:priceLists.confirmedCount',
        { count: summary.confirmed },
    )}`;
}

function viewFields(row: PriceListAdmin, t: TFunction, formatter: ReturnType<typeof useFormatter>) {
    const summary = summarisePriceEntries(row.entries);
    return [
        {
            key: 'currency',
            label: t('kitchen:priceLists.columnCurrency'),
            value: row.currency,
            mono: true,
        },
        {
            key: 'channels',
            label: t('kitchen:priceLists.columnChannels'),
            value: channelsText(row, t),
        },
        {
            key: 'entries',
            label: t('kitchen:priceLists.columnEntries'),
            value: entriesText(row, t),
        },
        {
            key: 'pending',
            label: t('kitchen:priceLists.viewPending'),
            value: `${t('kitchen:priceLists.placeholderCount', { count: summary.placeholder })} · ${t(
                'kitchen:priceLists.marketCount',
                { count: summary.marketPriced },
            )}`,
        },
        {
            key: 'updated',
            label: t('kitchen:list.columnUpdated'),
            value:
                row.meta.updatedByName === null
                    ? formatter.formatRelativeTime(row.meta.updatedAt)
                    : `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBy', { name: row.meta.updatedByName })}`,
        },
    ];
}

/**
 * The Lens bar's figures: All · Published · Draft · Awaiting review, then Nothing priced and
 * Agreement, counted over every page the filters match, the status included.
 */
function lensFigures(
    lens: StatusLensSource,
    /** Every price list the filters match, across all pages. */
    rows: readonly PriceListAdmin[],
    t: TFunction,
): readonly LensFigure[] {
    const counted = (count: number) => (lens.countsPending ? null : count);
    const nothingPriced = rows.filter(
        (row) => summarisePriceEntries(row.entries).confirmed === 0,
    ).length;
    const agreement = rows.filter((row) => isAgreementPriced(row.channels)).length;
    return [
        ...statusLensFigures(lens, t, {
            allLabel: t('kitchen:lens.allPriceLists'),
            review: true,
            reviewAction: t('kitchen:lens.reviewAction'),
        }),
        {
            key: 'nothingPriced',
            label: t('kitchen:priceLists.statNothingPriced'),
            value: counted(nothingPriced),
            tone: 'warning',
            separated: true,
        },
        {
            key: 'agreement',
            label: t('kitchen:priceLists.agreementBadge'),
            value: counted(agreement),
            tone: 'info',
        },
    ];
}
