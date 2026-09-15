import type { PriceListAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    EmptyState,
    ErrorState,
    RecordWindow,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { pagesInResult, usePriceListPageQuery } from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    channelKey,
    displayName,
    isAgreementPriced,
    priceListRowTestId,
    statusShortKey,
    statusTone,
    summarisePriceEntries,
} from '../format.ts';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/price-lists` — what this kitchen charges, and how much of it is actually decided
 * (Commercial handoff §3.1).
 *
 * ```
 * ┌ SHOWN ┐ ┌ NOTHING PRICED ┐ ┌ AGREEMENT ┐
 * [ ⌕ search ]  [ All | Live | Draft | Review ]
 * ◉ Negotiated prices are on this screen …
 * PRICE LIST          CURRENCY  CHANNELS      ENTRIES                     STATUS  UPDATED   ◉ ✎
 * Showing 1–25 of 40                                                          [ ‹ 1 2 › ]
 * ```
 *
 * The Catalogue list's five parts, with nothing rebuilt: `CatalogueStatCards`, `CatalogueToolbar`,
 * `CatalogueList` with a column spec, `CataloguePager`, and the `RecordWindow` behind View.
 *
 * ## No create, no archive
 *
 * `KitchenAdminRepository` has no `createPriceList` and no `retirePriceList`, so the page has no
 * primary and no row offers Archive (§6.1). Publish lives in the editor, where the entries being
 * decided about are on screen.
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
export function PriceListsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-price-lists"
        >
            <PriceListsList />
        </Gate>
    );
}

const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];
type StatusSegmentValue = PublishableStatus | 'all';

function PriceListsList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    const [viewing, setViewing] = useState<PriceListAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(status === 'all' ? {} : { statuses: [status] }),
        }),
        [trimmed, status],
    );
    const [page, setPage] = useListPage(filter);
    const priceLists = usePriceListPageQuery(filter, page);
    const rows = useMemo(() => priceLists.data?.items ?? [], [priceLists.data]);
    const total = priceLists.data?.totalCount ?? null;
    const totalPages = pagesInResult(priceLists.data) ?? 0;

    const openEditor = (row: PriceListAdmin) => {
        setViewing(null);
        router.push(`/kitchen/price-lists/${String(row.id)}` as never);
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
                    <View
                        testID={testID}
                        className="min-w-0 flex-row flex-wrap items-center gap-1.5"
                    >
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
                    </View>
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
            render: (row) => {
                const testID = priceListRowTestId(String(row.id));
                const summary = summarisePriceEntries(row.entries);
                return summary.total === 0 ? (
                    <Text tone="secondary" testID={`${testID}-entries-none`}>
                        {t('kitchen:priceLists.noEntries')}
                    </Text>
                ) : (
                    <View className="flex-row flex-wrap items-center gap-1.5">
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
                    </View>
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
    const unfiltered = trimmed === '' && status === 'all';
    const anyConfidential = controls.rows.some((row) => isAgreementPriced(row.channels));

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(statusShortKey(value)) })),
    ];

    return (
        <Stack space="md" testID="kitchen-price-lists-screen">
            {priceLists.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-price-lists-stats"
                    cards={statCards(controls.rows, total, unfiltered, t, () => {
                        setQuery('');
                        setStatus('all');
                    })}
                />
            )}

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-price-lists-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            />

            {priceLists.isPending ? (
                <Stack space="xs" testID="kitchen-price-lists-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-price-lists-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
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
                    {anyConfidential ? (
                        <Callout
                            testID="kitchen-price-lists-confidential"
                            role="note"
                            tone="warning"
                            title={t('kitchen:priceLists.confidentialTitle')}
                            body={t('kitchen:priceLists.confidentialBody')}
                        />
                    ) : null}

                    <CatalogueList<PriceListAdmin>
                        testID="kitchen-price-lists-table"
                        label={t('kitchen:priceLists.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
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
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:list.open'),
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
                        range={t('kitchen:toolbar.showing', {
                            shown: controls.rows.length,
                            total: total ?? controls.rows.length,
                        })}
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

            {viewing === null ? null : (
                <RecordWindow
                    testID="kitchen-price-lists-view"
                    open
                    onClose={() => {
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
            )}
        </Stack>
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
                    ? `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBySeed')}`
                    : `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBy', { name: row.meta.updatedByName })}`,
        },
    ];
}

/** Counted over the page in hand (§3z): shown, lists that price nothing, lists under an agreement. */
function statCards(
    rows: readonly PriceListAdmin[],
    total: number | null,
    unfiltered: boolean,
    t: TFunction,
    clear: () => void,
): readonly CatalogueStatCard[] {
    const nothingPriced = rows.filter(
        (row) => summarisePriceEntries(row.entries).confirmed === 0,
    ).length;
    const agreement = rows.filter((row) => isAgreementPriced(row.channels)).length;
    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(rows.length),
            unit: t('kitchen:list.statShownUnit', { total: total ?? rows.length }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'nothingPriced',
            label: t('kitchen:priceLists.statNothingPriced'),
            value: String(nothingPriced),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:priceLists.statNothingPricedCaption'),
            mark: 'warning',
            tone: nothingPriced === 0 ? 'default' : 'warning',
        },
        {
            key: 'agreement',
            label: t('kitchen:priceLists.agreementBadge'),
            value: String(agreement),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:priceLists.statAgreementCaption'),
            mark: 'lock',
        },
    ];
}
