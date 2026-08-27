import type { ProductAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn, TableSortDirection } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useArchiveProductMutation,
    useProductCategoriesQuery,
    useProductPageQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    PRODUCT_STATUS_FILTERS,
    availableChannels,
    channelKey,
    defaultPackVariant,
    displayName,
    humaniseCode,
    productRowTestId,
    statusKey,
    statusTone,
    unitKey,
} from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/products` — what this kitchen sells as goods rather than as a dish on a menu.
 *
 * ## Every column is a field the listing already answered
 *
 * Unlike the recipe list, this one costs no extra request per row: `listProducts` returns whole
 * {@link ProductAdmin} records — packs, channels, flags and all — so the pack summary and the channel
 * badges are read straight off the page that was fetched. That is worth stating because the recipe
 * list's N+1 is written down as a limitation, and a reader comparing the two files should be able to
 * see immediately that the difference is the contract's, not a change of mind.
 *
 * ## There is no publish control here, and that is the contract's doing
 *
 * `ProductAdmin.meta` carries the full publication lifecycle, and `KitchenAdminRepository` publishes
 * `archiveProduct` and nothing else — no `publishProduct`, no `retireProduct`. So the row action set
 * is open and archive; the status column renders whatever the record's state is; and no button here
 * implies a transition the server has no endpoint for. When the publication actions land the row
 * grows one control and nothing else about this screen changes.
 *
 * ## Sorting is client-side, and stated
 *
 * Same limitation the ingredient and recipe lists document: `ProductAdminFilter` publishes no sort
 * parameter, so the table sorts what has been loaded. Honest for a catalogue of twenty, wrong for one
 * of two thousand.
 */

type SortKey = 'name' | 'status' | 'updatedAt';

/**
 * The three packaged-goods families this one screen serves. Sauces and
 * dressings are products in apparatus — same packs, same channels, same
 * lifecycle — listed on their own pages by `item_type`. Copy that names the
 * family is looked up here (literal keys, so extraction sees them); copy
 * about the apparatus stays under `kitchen:products.*`.
 */
export interface GoodsFamily {
    readonly itemType: 'product' | 'sauce' | 'dressing';
    readonly routeBase: '/kitchen/products' | '/kitchen/sauces' | '/kitchen/dressings';
    readonly gateTestID: string;
    readonly title: string;
    readonly subtitle: string;
    readonly create: string;
    readonly caption: string;
    readonly resultCount: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
}

export const PRODUCTS_FAMILY: GoodsFamily = {
    itemType: 'product',
    routeBase: '/kitchen/products',
    gateTestID: 'kitchen-products',
    title: 'kitchen:products.title',
    subtitle: 'kitchen:products.subtitle',
    create: 'kitchen:products.create',
    caption: 'kitchen:products.caption',
    resultCount: 'kitchen:products.resultCount',
    emptyTitle: 'kitchen:products.emptyTitle',
    emptyBody: 'kitchen:products.emptyBody',
};

export const SAUCES_FAMILY: GoodsFamily = {
    itemType: 'sauce',
    routeBase: '/kitchen/sauces',
    gateTestID: 'kitchen-sauces',
    title: 'kitchen:sauces.title',
    subtitle: 'kitchen:sauces.subtitle',
    create: 'kitchen:sauces.create',
    caption: 'kitchen:sauces.caption',
    resultCount: 'kitchen:sauces.resultCount',
    emptyTitle: 'kitchen:sauces.emptyTitle',
    emptyBody: 'kitchen:sauces.emptyBody',
};

export const DRESSINGS_FAMILY: GoodsFamily = {
    itemType: 'dressing',
    routeBase: '/kitchen/dressings',
    gateTestID: 'kitchen-dressings',
    title: 'kitchen:dressings.title',
    subtitle: 'kitchen:dressings.subtitle',
    create: 'kitchen:dressings.create',
    caption: 'kitchen:dressings.caption',
    resultCount: 'kitchen:dressings.resultCount',
    emptyTitle: 'kitchen:dressings.emptyTitle',
    emptyBody: 'kitchen:dressings.emptyBody',
};

export function ProductsScreen({ family = PRODUCTS_FAMILY }: { readonly family?: GoodsFamily }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID={family.gateTestID}
        >
            <ProductsList family={family} />
        </Gate>
    );
}

/**
 * How many packs the product is sold in, and which one leads.
 *
 * The default is the first, because array position is the only ordering `ProductPackVariant`
 * publishes — see `defaultPackVariant` in `../format.ts`. A product with no packs at all says so
 * rather than rendering an empty cell: "no pack recorded" is a thing to go and fix, and a blank is
 * indistinguishable from a column that failed to load.
 */
function PackCell({ row }: { readonly row: ProductAdmin }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const testID = productRowTestId(String(row.id));
    const lead = defaultPackVariant(row.packVariants);

    if (lead === null) {
        return (
            <Text testID={`${testID}-packs-none`} tone="secondary">
                {t('kitchen:products.noPacks')}
            </Text>
        );
    }

    return (
        <Stack space="none" testID={`${testID}-packs`}>
            <Text variant="bodyStrong">{displayName(lead.label, locale).value}</Text>
            <Text variant="caption" tone="secondary">
                {t('kitchen:products.packMeasure', {
                    quantity: lead.netQuantity,
                    unit: t(unitKey(lead.netUnit)),
                    units: lead.unitsPerPack,
                })}
            </Text>
            <Text variant="caption" tone="secondary" testID={`${testID}-packs-count`}>
                {t('kitchen:products.packCount', { count: row.packVariants.length })}
            </Text>
        </Stack>
    );
}

/** Which routes to market the product is currently sold through. Never an invented default. */
function ChannelCell({ row }: { readonly row: ProductAdmin }) {
    const { t } = useTranslation();
    const testID = productRowTestId(String(row.id));
    const channels = availableChannels(row.channelAvailability);

    if (channels.length === 0) {
        return (
            <Text testID={`${testID}-channels-none`} tone="secondary">
                {t('kitchen:products.noChannels')}
            </Text>
        );
    }

    return (
        <Inline space="xs" wrap testID={`${testID}-channels`}>
            {channels.map((channel) => (
                <Badge key={channel} tone="info" label={t(channelKey(channel))} />
            ))}
        </Inline>
    );
}

function ProductsList({ family }: { readonly family: GoodsFamily }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [category, setCategory] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');
    const [archiving, setArchiving] = useState<ProductAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            itemType: family.itemType,
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(category === null ? {} : { categoryCode: category }),
        }),
        [family.itemType, trimmed, statuses, category],
    );

    const [page, setPage] = useListPage(filter);
    const products = useProductPageQuery(filter, page);
    const categories = useProductCategoriesQuery();
    const archive = useArchiveProductMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on
    // every render, which would re-run anything memoised over it whether or not it changed.
    const rows = products.data?.items;
    const total = products.data?.totalCount ?? null;
    const totalPages = pagesInResult(products.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
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

    const openEditor = (productId: string) => {
        router.push(`${family.routeBase}/${productId}` as never);
    };

    const columns: readonly TableColumn<ProductAdmin>[] = [
        {
            key: 'name',
            header: t('kitchen:products.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                const testID = productRowTestId(String(row.id));
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
                        <Inline space="xs" wrap>
                            {row.isMarketPriced ? (
                                <Badge
                                    testID={`${testID}-market-priced`}
                                    tone="warning"
                                    label={t('kitchen:products.marketPricedShort')}
                                />
                            ) : null}
                            {row.isAssorted ? (
                                <Badge
                                    testID={`${testID}-assorted`}
                                    tone="neutral"
                                    label={t('kitchen:products.assortedShort')}
                                />
                            ) : null}
                            {row.dataQualityFlags.length === 0 ? null : (
                                <Badge
                                    testID={`${testID}-data-quality`}
                                    tone="warning"
                                    icon="warning"
                                    label={t('kitchen:products.dataQualityCount', {
                                        count: row.dataQualityFlags.length,
                                    })}
                                />
                            )}
                        </Inline>
                    </Stack>
                );
            },
        },
        {
            key: 'category',
            header: t('kitchen:products.columnCategory'),
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${productRowTestId(String(row.id))}-category`}>
                        {row.categoryCode.trim() === ''
                            ? t('kitchen:list.noCategory')
                            : humaniseCode(row.categoryCode)}
                    </Text>
                    {row.kitchenCategory === null ? null : (
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID={`${productRowTestId(String(row.id))}-kitchen-category`}
                        >
                            {row.kitchenSubcategory === null
                                ? row.kitchenCategory
                                : `${row.kitchenCategory} / ${row.kitchenSubcategory}`}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'packs',
            header: t('kitchen:products.columnPacks'),
            flex: 2,
            render: (row) => <PackCell row={row} />,
        },
        {
            key: 'channels',
            header: t('kitchen:products.columnChannels'),
            flex: 2,
            render: (row) => <ChannelCell row={row} />,
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            sortable: true,
            render: (row) => (
                <Badge
                    testID={`${productRowTestId(String(row.id))}-status`}
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
                    <Text testID={`${productRowTestId(String(row.id))}-updated`} variant="caption">
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

    const failure = toFailure(products.error);
    const unfiltered = trimmed === '' && statuses.length === 0 && category === null;

    return (
        <Stack space="lg" testID="kitchen-products-screen">
            <KitchenPageHeader
                testID="kitchen-products-header"
                title={t(family.title)}
                subtitle={t(family.subtitle)}
                titleTestID="kitchen-products-title"
                subtitleTestID="kitchen-products-subtitle"
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-products-toolbar-create"
                            label={t(family.create)}
                            onPress={() => {
                                router.push(`${family.routeBase}/new` as never);
                            }}
                        />
                    ) : undefined
                }
            />

            <ListToolbar
                testID="kitchen-products-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={PRODUCT_STATUS_FILTERS}
                categoryLabel={t('kitchen:products.categoryFilterLabel')}
                categoryAllLabel={t('kitchen:products.categoryFilterAll')}
                categoryOptions={(categories.data ?? []).map((entry) => ({
                    value: entry.code,
                    label: humaniseCode(entry.code),
                    description: t('kitchen:products.productCount', { count: entry.count }),
                }))}
                category={category}
                onCategoryChange={setCategory}
                {...(products.isPending || total === null
                    ? {}
                    : {
                          resultSummary: t('kitchen:toolbar.showing', {
                              shown: sorted.length,
                              total,
                          }),
                      })}
            />

            {products.isPending ? (
                <Stack space="sm" testID="kitchen-products-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-products-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-products-error"
                    failure={failure}
                    onRetry={() => {
                        void products.refetch();
                    }}
                    retrying={products.isFetching}
                />
            ) : sorted.length === 0 ? (
                <EmptyState
                    testID="kitchen-products-empty"
                    title={
                        unfiltered ? t(family.emptyTitle) : t('kitchen:products.filteredEmptyTitle')
                    }
                    body={
                        unfiltered ? t(family.emptyBody) : t('kitchen:products.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-products-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={() => {
                                    setQuery('');
                                    setStatuses([]);
                                    setCategory(null);
                                }}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-products-empty-create"
                                    label={t(family.create)}
                                    onPress={() => {
                                        router.push(`${family.routeBase}/new` as never);
                                    }}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<ProductAdmin>
                        testID="kitchen-products-table"
                        caption={t(family.caption)}
                        captionHidden
                        columns={columns}
                        rows={sorted}
                        rowKey={(row) => String(row.id)}
                        rowTone={(row) => (row.meta.status === 'retired' ? 'muted' : 'default')}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSortChange={(key, direction) => {
                            setSortKey(key as SortKey);
                            setSortDirection(direction);
                        }}
                        rowAction={{
                            header: t('kitchen:list.actionHeader'),
                            render: (row) => {
                                const testID = productRowTestId(String(row.id));
                                return (
                                    <Inline space="xs" wrap justify="end">
                                        <Button
                                            testID={`${testID}-open`}
                                            size="sm"
                                            variant="secondary"
                                            label={t('kitchen:list.open')}
                                            onPress={() => {
                                                openEditor(String(row.id));
                                            }}
                                        />
                                        {canManage && row.meta.status !== 'retired' ? (
                                            <Button
                                                testID={`${testID}-archive`}
                                                size="sm"
                                                variant="ghost"
                                                label={t('kitchen:list.archive')}
                                                onPress={() => {
                                                    setArchiving(row);
                                                }}
                                            />
                                        ) : null}
                                    </Inline>
                                );
                            },
                        }}
                    />

                    <Pagination
                        testID="kitchen-products-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={products.isFetching}
                    />
                </Stack>
            )}

            {/*
             * Archiving is the only lifecycle action the contract gives this family. The dialog says
             * what it costs — the product leaves every channel it is on and every price list keeps
             * pointing at it — because "archive" on its own reads like a delete and is not one.
             */}
            <Dialog
                testID="kitchen-products-archive-dialog"
                open={archiving !== null}
                onClose={() => {
                    setArchiving(null);
                }}
                title={t('kitchen:products.archiveTitle')}
                description={t('kitchen:products.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-products-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setArchiving(null);
                            }}
                        />
                        <Button
                            testID="kitchen-products-archive-confirm"
                            variant="danger"
                            label={t('kitchen:products.archiveConfirm')}
                            loading={archive.isPending}
                            onPress={() => {
                                const row = archiving;
                                if (row === null) return;
                                archive.mutate(
                                    {
                                        productId: row.id,
                                        request: { lockVersion: row.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setArchiving(null);
                                            toast.show({
                                                testID: 'kitchen-products-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:products.archivedToast', {
                                                    name: displayName(row.name, locale).value,
                                                }),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                {archive.error === null ? null : (
                    <Text testID="kitchen-products-archive-error" tone="danger">
                        {toFailure(archive.error)?.message ?? t('kitchen:products.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}
