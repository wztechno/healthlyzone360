import type { PriceListAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn, TableSortDirection } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { pagesInResult, usePriceListPageQuery } from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    PRICE_LIST_STATUS_FILTERS,
    channelKey,
    displayName,
    isAgreementPriced,
    priceListRowTestId,
    statusKey,
    statusTone,
    summarisePriceEntries,
} from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/price-lists` — what this kitchen charges, and how much of it is actually decided.
 *
 * ## The entry split is the column this screen exists for
 *
 * Every other admin list answers "how many are there?". This one answers "how many of them are
 * *real*?", because the programme's binding rule is that a fabricated price never reaches a public
 * surface (plan §2.4): a placeholder entry carries `amountMinor: null` and is excluded from every
 * consumer projection, and a market-priced entry carries none for a different reason. A list of
 * forty rows of which three are confirmed is not a price list with forty prices, and a column
 * showing only the total would say that it was.
 *
 * ## No create, no publish, no archive — and that is the contract's doing
 *
 * `KitchenAdminRepository` publishes `listPriceLists`, `getPriceList`, `setPriceListEntries` and
 * `publishPriceList`. There is no `createPriceList`, so the toolbar has no create button; there is
 * no `retirePriceList`, so no row offers one. Publishing *is* offered by the contract — and is
 * deliberately **not** offered from a row here: publishing a price list makes a set of numbers
 * chargeable, the dialog that asks about it has to state how many entries that is and which of them
 * will silently not reach a customer, and a row-level confirm cannot carry that. Publish therefore
 * lives in the editor, one screen away, where the entries the person is deciding about are visible.
 *
 * ## Confidential lists are marked, and marked before they are opened
 *
 * A list whose channels include a contract-private one (`hasPrivatePricing` —
 * `@healthy360/domain-types`) is negotiated paperwork inside one buyer relationship. Its row wears
 * a raised card and an `agreement` badge, and the note under the table says what that means, so that
 * a screen shared in a meeting does not put a negotiated rate in front of the wrong person without
 * anybody noticing what they were looking at. The contract publishes no `customerScope` field to
 * read this from — the channel set is what exists, and the module note in
 * `data/kitchen-admin-hooks.ts` records the gap.
 *
 * ## Sorting is client-side, and stated
 *
 * Same limitation the other four lists document: `PriceListAdminFilter` publishes no sort parameter,
 * so the table sorts what has been loaded.
 */

type SortKey = 'name' | 'currency' | 'status' | 'updatedAt';

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

/**
 * How the list's entries break down — confirmed, pending, priced daily.
 *
 * The three counts are always rendered, including at zero, because "no confirmed prices" is the
 * single most important thing this screen can say about a list and hiding it at zero would hide it
 * exactly when it matters. The inconsistency count is the opposite: it is hidden at zero, because a
 * badge permanently reading "none inconsistent" is furniture.
 */
function EntriesCell({ row }: { readonly row: PriceListAdmin }) {
    const { t } = useTranslation();
    const testID = priceListRowTestId(String(row.id));
    const summary = summarisePriceEntries(row.entries);

    if (summary.total === 0) {
        return (
            <Text testID={`${testID}-entries-none`} tone="secondary">
                {t('kitchen:priceLists.noEntries')}
            </Text>
        );
    }

    return (
        <Stack space="xs" testID={`${testID}-entries`}>
            <Text variant="bodyStrong" testID={`${testID}-entries-total`}>
                {t('kitchen:priceLists.entryCount', { count: summary.total })}
            </Text>
            <Inline space="xs" wrap>
                <Badge
                    testID={`${testID}-entries-confirmed`}
                    tone={summary.confirmed === 0 ? 'neutral' : 'success'}
                    label={t('kitchen:priceLists.confirmedCount', { count: summary.confirmed })}
                />
                <Badge
                    testID={`${testID}-entries-placeholder`}
                    tone={summary.placeholder === 0 ? 'neutral' : 'warning'}
                    label={t('kitchen:priceLists.placeholderCount', {
                        count: summary.placeholder,
                    })}
                />
                <Badge
                    testID={`${testID}-entries-market`}
                    tone="info"
                    label={t('kitchen:priceLists.marketCount', { count: summary.marketPriced })}
                />
                {summary.inconsistent === 0 ? null : (
                    <Badge
                        testID={`${testID}-entries-inconsistent`}
                        tone="danger"
                        icon="warning"
                        label={t('kitchen:priceLists.inconsistentCount', {
                            count: summary.inconsistent,
                        })}
                    />
                )}
            </Inline>
        </Stack>
    );
}

/** Which routes to market the list applies to. Never an invented default. */
function ChannelsCell({ row }: { readonly row: PriceListAdmin }) {
    const { t } = useTranslation();
    const testID = priceListRowTestId(String(row.id));

    if (row.channels.length === 0) {
        return (
            <Text testID={`${testID}-channels-none`} tone="secondary">
                {t('kitchen:priceLists.noChannels')}
            </Text>
        );
    }

    return (
        <Inline space="xs" wrap testID={`${testID}-channels`}>
            {row.channels.map((channel) => (
                <Badge key={channel} tone="info" label={t(channelKey(channel))} />
            ))}
        </Inline>
    );
}

function PriceListsList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
        }),
        [trimmed, statuses],
    );

    const [page, setPage] = useListPage(filter);
    const priceLists = usePriceListPageQuery(filter, page);

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on
    // every render, which would re-run anything memoised over it whether or not it changed.
    const rows = priceLists.data?.items;
    const total = priceLists.data?.totalCount ?? null;
    const totalPages = pagesInResult(priceLists.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'currency') return factor * left.currency.localeCompare(right.currency);
            if (sortKey === 'status') {
                return factor * left.meta.status.localeCompare(right.meta.status);
            }
            if (sortKey === 'updatedAt') {
                return factor * left.meta.updatedAt.localeCompare(right.meta.updatedAt);
            }
            return (
                factor *
                displayName(left.name, locale).value.localeCompare(
                    displayName(right.name, locale).value,
                    locale,
                )
            );
        });
    }, [rows, sortKey, sortDirection, locale]);

    const anyConfidential = sorted.some((row) => isAgreementPriced(row.channels));

    const columns: readonly TableColumn<PriceListAdmin>[] = [
        {
            key: 'name',
            header: t('kitchen:priceLists.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                const testID = priceListRowTestId(String(row.id));
                const confidential = isAgreementPriced(row.channels);
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                        {confidential ? (
                            <Badge
                                testID={`${testID}-agreement`}
                                tone="warning"
                                icon="eye"
                                label={t('kitchen:priceLists.agreementBadge')}
                            />
                        ) : null}
                    </Stack>
                );
            },
        },
        {
            key: 'currency',
            header: t('kitchen:priceLists.columnCurrency'),
            sortable: true,
            render: (row) => (
                <Text testID={`${priceListRowTestId(String(row.id))}-currency`}>
                    {row.currency}
                </Text>
            ),
        },
        {
            key: 'channels',
            header: t('kitchen:priceLists.columnChannels'),
            flex: 2,
            render: (row) => <ChannelsCell row={row} />,
        },
        {
            key: 'entries',
            header: t('kitchen:priceLists.columnEntries'),
            flex: 2,
            render: (row) => <EntriesCell row={row} />,
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            sortable: true,
            render: (row) => (
                <Badge
                    testID={`${priceListRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            header: t('kitchen:list.columnUpdated'),
            sortable: true,
            render: (row) => (
                <Stack space="none">
                    <Text
                        testID={`${priceListRowTestId(String(row.id))}-updated`}
                        variant="caption"
                    >
                        {formatter.formatRelativeTime(row.meta.updatedAt)}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.meta.updatedByName === null
                            ? t('kitchen:list.updatedBySeed')
                            : t('kitchen:list.updatedBy', { name: row.meta.updatedByName })}
                    </Text>
                </Stack>
            ),
        },
    ];

    const failure = toFailure(priceLists.error);
    const unfiltered = trimmed === '' && statuses.length === 0;

    return (
        <Stack space="lg" testID="kitchen-price-lists-screen">
            {/* No create action: the contract has no `createPriceList`, so the title row's
                primary slot stays empty rather than promoting something else into it. */}
            <KitchenPageHeader
                testID="kitchen-price-lists-header"
                title={t('kitchen:priceLists.title')}
                subtitle={t('kitchen:priceLists.subtitle')}
                titleTestID="kitchen-price-lists-title"
                subtitleTestID="kitchen-price-lists-subtitle"
            />

            <ListToolbar
                testID="kitchen-price-lists-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={PRICE_LIST_STATUS_FILTERS}
                {...(priceLists.isPending || total === null
                    ? {}
                    : {
                          resultSummary: t('kitchen:toolbar.showing', {
                              shown: sorted.length,
                              total,
                          }),
                      })}
            />

            {priceLists.isPending ? (
                <Stack space="sm" testID="kitchen-price-lists-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-price-lists-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
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
            ) : sorted.length === 0 ? (
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
                        // A raised strip above the table rather than a per-row one: the table's own
                        // rows cannot carry a surface treatment, so the marker that a negotiated rate
                        // is on screen has to sit where the whole table is read from.
                        <View
                            testID="kitchen-price-lists-confidential"
                            role="note"
                            className="rounded-lg border border-stroke-subtle bg-surface-raised p-3"
                        >
                            <Stack space="xs">
                                <Inline space="xs" align="center" wrap>
                                    <Badge
                                        tone="warning"
                                        icon="eye"
                                        label={t('kitchen:priceLists.agreementBadge')}
                                    />
                                    <Text variant="label">
                                        {t('kitchen:priceLists.confidentialTitle')}
                                    </Text>
                                </Inline>
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:priceLists.confidentialBody')}
                                </Text>
                            </Stack>
                        </View>
                    ) : null}

                    <Table<PriceListAdmin>
                        testID="kitchen-price-lists-table"
                        caption={t('kitchen:priceLists.caption')}
                        captionHidden
                        columns={columns}
                        rows={sorted}
                        rowKey={(row) => String(row.id)}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSortChange={(key, direction) => {
                            setSortKey(key as SortKey);
                            setSortDirection(direction);
                        }}
                        rowAction={{
                            header: t('kitchen:list.actionHeader'),
                            render: (row) => (
                                <Inline space="xs" wrap justify="end">
                                    <Button
                                        testID={`${priceListRowTestId(String(row.id))}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:list.open')}
                                        onPress={() => {
                                            router.push(
                                                `/kitchen/price-lists/${String(row.id)}` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            ),
                        }}
                    />

                    <Pagination
                        testID="kitchen-price-lists-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={priceLists.isFetching}
                    />
                </Stack>
            )}
        </Stack>
    );
}
