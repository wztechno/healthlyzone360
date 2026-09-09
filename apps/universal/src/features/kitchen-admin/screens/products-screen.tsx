import type { ProductAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Icon,
    Inline,
    Menu,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { CatalogueViewDrawer } from '../catalogue/catalogue-view-drawer.tsx';
import type { CatalogueViewField } from '../catalogue/catalogue-view-drawer.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { productColumns } from '../catalogue/product-columns.tsx';
import type { ProductItemType, ProductListState, ProductSortKey } from '../catalogue/use-product-list.ts';
import { useProductList } from '../catalogue/use-product-list.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    PRODUCT_STATUS_FILTERS,
    availableChannels,
    channelKey,
    defaultPackVariant,
    displayName,
    humaniseCode,
    productRowTestId,
    statusShortKey,
    statusTone,
    unitShortKey,
} from '../format.ts';

/**
 * `/kitchen/products` — what this kitchen sells as goods rather than as a dish on a menu — and the
 * same page again at `/kitchen/sauces` and `/kitchen/dressings`.
 *
 * ```
 * Kitchen workspace › Products                    <- drawn by the shell, not here
 *                                                            [ + New product ]
 * ┌ SHOWN ┐ ┌ DRAFT ┐ ┌ MISSING ARABIC ┐ ┌ NO PACK ┐
 * [ ⌕ 240px ]  [ All | Live | Draft | Review ]
 * PRODUCT   CATEGORY   PACKS   CHANNELS   FLAGS   STATUS   UPDATED   ⋯
 * Showing 1–25 of 240                                        [ ‹ 1 2 3 › ]
 * ```
 *
 * The Catalogue shell §4.1 describes, in the order it describes: header, stat cards, the one 28px
 * toolbar row, the spec-driven list, the pager. Every control is `sm` except the one primary, which
 * is the `md` the design gives it — and those numbers are only real under `DensityProvider
 * value="compact"`, which `KitchenOpsShell` supplies.
 *
 * ## Every column is a field the listing already answered
 *
 * Unlike the recipe list, this one costs no extra request per row: `listProducts` returns whole
 * {@link ProductAdmin} records — packs, channels, flags and all — so the pack summary and the
 * channel run are read straight off the page that was fetched, and the View drawer needs no read of
 * its own. That is worth stating because the recipe list's N+1 is written down as a limitation, and
 * a reader comparing the two files should see immediately that the difference is the contract's.
 *
 * ## There is no publish control here, and that is the contract's doing
 *
 * `ProductAdmin.meta` carries the full publication lifecycle, and `KitchenAdminRepository` publishes
 * `archiveProduct` and nothing else — no `publishProduct`, no `retireProduct`. So the row menu is
 * View · Edit · Archive; the status column renders whatever the record's state is; and no control
 * here implies a transition the server has no endpoint for.
 *
 * ## Where each control lives
 *
 * **Sorting and filtering are on the column header** (§4.3). Product, Category, Status and Updated
 * each open Sort ascending / Sort descending; Category and Status add their value list with a
 * Clear, because those two are what `ProductAdminFilter` actually carries. Packs, Channels and
 * Flags sort by nothing — each is a set, and narrowing one loaded page by a set would misreport
 * every page after it.
 *
 * **Two of the four cards are filters.** Shown clears every constraint; Draft narrows to the
 * drafts. Missing Arabic and No pack are read-only, because the filter carries no parameter for
 * either and a card that looked pressable and did nothing would be worse than one that plainly does
 * not.
 */

type SortKey = ProductSortKey;

/**
 * The three packaged-goods families this one screen serves. Sauces and dressings are products in
 * apparatus — same packs, same channels, same lifecycle — listed on their own pages by `item_type`.
 * Copy that names the family is looked up here (literal keys, so extraction sees them); copy about
 * the apparatus stays under `kitchen:products.*`.
 */
export interface GoodsFamily {
    readonly itemType: ProductItemType;
    readonly routeBase: '/kitchen/products' | '/kitchen/sauces' | '/kitchen/dressings';
    readonly gateTestID: string;
    readonly title: string;
    readonly subtitle: string;
    readonly create: string;
    readonly caption: string;
    readonly resultCount: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    /** The uppercase eyebrow over the View drawer — "Product", "Sauce", "Dressing". */
    readonly viewKind: string;
    readonly searchPlaceholder: string;
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
    viewKind: 'kitchen:products.viewKind',
    searchPlaceholder: 'kitchen:products.searchPlaceholder',
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
    viewKind: 'kitchen:sauces.viewKind',
    searchPlaceholder: 'kitchen:sauces.searchPlaceholder',
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
    viewKind: 'kitchen:dressings.viewKind',
    searchPlaceholder: 'kitchen:dressings.searchPlaceholder',
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
 * The status segments, as the design draws them: All · Live · Draft · Review.
 *
 * Four, not five. Archived is reachable from the Status column's own filter, and putting it on the
 * toolbar would spend a fifth of a primary control on the one state a catalogue is almost never
 * browsed in.
 */
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];

type StatusSegmentValue = PublishableStatus | 'all';

function ProductsList({ family }: { readonly family: GoodsFamily }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const list = useProductList(family.itemType, family.routeBase);

    /**
     * Code → the name the kitchen filed it under.
     *
     * There is no product category resource on the contract — the vocabulary is derived from the
     * codes in use — so `humaniseCode` is the whole answer here rather than the fallback it is on
     * the ingredient list. Kept behind a function all the same, so the day a real taxonomy lands
     * this is the one line that changes.
     */
    const categoryName = useMemo(() => (code: string) => humaniseCode(code), []);

    const columns = useMemo(
        () => productColumns({ t, locale, formatter, categoryName }),
        [t, locale, formatter, categoryName],
    );

    const withHeaders = columns.map((column) => ({
        ...column,
        renderHeader: headerMenu(column, list, t),
    }));

    // A status the segments do not name — Archived, reached from the Status column's own filter —
    // leaves the set on "all" rather than lighting a segment that is not on the row.
    const active = list.statuses[0];
    const segmentValue: StatusSegmentValue =
        active !== undefined && SEGMENT_STATUSES.includes(active) ? active : 'all';

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((status) => ({
            value: status,
            label: t(statusShortKey(status)),
        })),
    ];

    return (
        <Stack space="md" testID="kitchen-products-screen">
            {/*
             * The opening — the actions and the four figures — is one block at 4px, nested inside
             * the page's 16px rhythm. The reasoning is the ingredient list's: with no trail and no
             * title of its own, the header is a right-aligned button row, and at the page's own
             * 16px it read as two empty bands stacked above the first thing worth looking at.
             */}
            <Stack space="xs">
                <CataloguePageHeader
                    testID="kitchen-products-header"
                    primaryAction={
                        canManage ? (
                            <Button
                                testID="kitchen-products-toolbar-create"
                                label={t(family.create)}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={list.createNew}
                            />
                        ) : undefined
                    }
                />

                {list.isPending ? null : (
                    <CatalogueStatCards
                        testID="kitchen-products-stats"
                        cards={statCards(list, t)}
                    />
                )}
            </Stack>

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-products-toolbar"
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t(family.searchPlaceholder)}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                // Single-select, so "all" is the absence of a status rather than a status of its own.
                status={segmentValue}
                onStatusChange={(status) => {
                    list.setStatuses(status === 'all' ? [] : [status]);
                }}
            />

            {list.isPending ? (
                <Stack space="xs" testID="kitchen-products-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-products-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : list.failure !== null ? (
                <ErrorState
                    testID="kitchen-products-error"
                    failure={list.failure}
                    onRetry={list.refetch}
                    retrying={list.isFetching}
                />
            ) : list.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-products-empty"
                    title={
                        list.isUnfiltered
                            ? t(family.emptyTitle)
                            : t('kitchen:products.filteredEmptyTitle')
                    }
                    body={
                        list.isUnfiltered
                            ? t(family.emptyBody)
                            : t('kitchen:products.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-products-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={list.clearFilters}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-products-empty-create"
                                    label={t(family.create)}
                                    onPress={list.createNew}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList
                        testID="kitchen-products-table"
                        label={t(family.caption)}
                        columns={withHeaders}
                        rows={list.rows}
                        rowKey={(row) => String(row.id)}
                        // Fixed, not switchable: the S/M/L control is gone.
                        density="sm"
                        onRowPress={(row) => {
                            list.openEditor(String(row.id));
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        // View, Edit, Archive, in the design's order. Above `md` these are flat
                        // icon buttons on the row; below it the same array becomes the overflow
                        // menu, because a narrow row has space for exactly one control.
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${productRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    list.openView(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:list.open'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${productRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    list.openEditor(String(row.id));
                                },
                            },
                            // Archive is offered only where it would be accepted: the permission,
                            // and a row that is not already archived.
                            ...(canManage && row.meta.status !== 'retired'
                                ? [
                                      {
                                          key: 'archive',
                                          label: t('kitchen:list.archive'),
                                          icon: CATALOGUE_ROW_ICONS.archive,
                                          tone: 'danger' as const,
                                          testID: `${productRowTestId(String(row.id))}-archive`,
                                          onSelect: () => {
                                              list.askToArchive(row);
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-products-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: list.shown,
                            total: list.total ?? list.shown,
                        })}
                        page={list.page}
                        totalPages={list.totalPages}
                        onPageChange={list.setPage}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}

            <CatalogueViewDrawer
                testID="kitchen-products-view"
                open={list.viewing !== null}
                onClose={list.closeView}
                kindLabel={t(family.viewKind)}
                fieldsLabel={t('kitchen:list.viewFields')}
                closeLabel={t('kitchen:catalogue.close')}
                editLabel={t('kitchen:catalogue.edit')}
                onEdit={() => {
                    const viewed = list.viewing;
                    if (viewed === null) return;
                    list.closeView();
                    list.openEditor(String(viewed.id));
                }}
                title={list.viewing === null ? '' : displayName(list.viewing.name, locale).value}
                status={
                    list.viewing === null ? undefined : (
                        <Badge
                            tone={statusTone(list.viewing.meta.status)}
                            label={t(statusShortKey(list.viewing.meta.status))}
                        />
                    )
                }
                fields={
                    list.viewing === null
                        ? []
                        : viewFields(list.viewing, t, formatter, locale, categoryName)
                }
                /*
                 * The channels as badges, and drawn even when the set is empty. On the row they are
                 * a comma run — twenty-five rows of coloured pills drown the names beside them —
                 * but here there is one record and room to look at it. An empty set says so in
                 * words, because "on no channel" and "nobody has looked" are the two answers a
                 * reader most needs told apart.
                 */
                {...(list.viewing === null
                    ? {}
                    : {
                          chipsLabel: t('kitchen:products.columnChannels'),
                          chipsCaption: t('kitchen:products.viewChannelsCaption'),
                          chips: channelChips(list.viewing, t),
                      })}
            />

            {/*
             * Archiving is the only lifecycle action the contract gives this family. The dialog says
             * what it costs — the product leaves every channel it is on and every price list keeps
             * pointing at it — because "archive" on its own reads like a delete and is not one.
             */}
            <Dialog
                testID="kitchen-products-archive-dialog"
                open={list.archiving !== null}
                onClose={list.cancelArchive}
                title={t('kitchen:products.archiveTitle')}
                description={t('kitchen:products.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-products-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelArchive}
                        />
                        <Button
                            testID="kitchen-products-archive-confirm"
                            variant="danger"
                            label={t('kitchen:products.archiveConfirm')}
                            loading={list.isArchivePending}
                            onPress={() => {
                                list.confirmArchive((name) => {
                                    toast.show({
                                        testID: 'kitchen-products-archived-toast',
                                        tone: 'success',
                                        message: t('kitchen:products.archivedToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.archiveFailure === null ? null : (
                    <Text testID="kitchen-products-archive-error" tone="danger">
                        {list.archiveFailure.message ?? t('kitchen:products.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/**
 * The four figures the summary line used to state, as cards.
 *
 * `total` is the server's count for the filtered set; Draft, Missing Arabic and No pack are counted
 * over the loaded page, which is the only set this screen has. That difference is why Shown reads
 * "18 of 240" rather than claiming the three beside it are catalogue-wide.
 */
function statCards(list: ProductListState, t: TFunction): readonly CatalogueStatCard[] {
    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(list.shown),
            unit: t('kitchen:list.statShownUnit', { total: list.total ?? list.shown }),
            caption: list.isUnfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: list.clearFilters,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'draft',
            label: t('kitchen:list.statDraft'),
            value: String(list.draftCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:list.statDraftCaption'),
            mark: 'eyeOff',
            // Amber only while there is something to act on.
            tone: list.draftCount === 0 ? 'default' : 'warning',
            onPress: () => {
                list.setStatuses(['draft']);
            },
            accessibilityLabel: t('kitchen:list.statDraftAction'),
        },
        {
            key: 'missingArabic',
            label: t('kitchen:list.statMissingArabic'),
            value: String(list.missingArabicCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:list.statMissingArabicCaption'),
            mark: 'warning',
            tone: list.missingArabicCount === 0 ? 'default' : 'danger',
        },
        {
            key: 'noPack',
            label: t('kitchen:products.statNoPack'),
            value: String(list.noPackCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:products.statNoPackCaption'),
            mark: 'warning',
            tone: list.noPackCount === 0 ? 'default' : 'warning',
        },
    ];
}

/** The channel set, as badges. Never an invented default — an empty set says so. */
function channelChips(row: ProductAdmin, t: TFunction): ReactNode {
    const channels = availableChannels(row.channelAvailability);

    return channels.length === 0 ? (
        <Text tone="secondary">{t('kitchen:products.noChannels')}</Text>
    ) : (
        channels.map((channel) => (
            <Badge key={channel} tone="info" label={t(channelKey(channel))} />
        ))
    );
}

/**
 * The record, as the read-only panel lists it.
 *
 * The same values the row already carries plus the ones the row has no track for — the kitchen's
 * own filing pair, the composition note, every pack rather than the lead one, and who last touched
 * it. `updatedByName` in particular is here rather than on the row because it is a fact about *a*
 * record, and a 96px Updated column that tried to hold "by Farah Haddad" either truncated a
 * person's name or doubled every row's height.
 *
 * Absent values render the dash rather than being dropped: a panel whose rows change position
 * depending on what is filled in cannot be scanned twice the same way.
 */
function viewFields(
    row: ProductAdmin,
    t: TFunction,
    formatter: Formatter,
    locale: string,
    categoryName: (code: string) => string,
): readonly CatalogueViewField[] {
    const dash = t('kitchen:list.noValue');
    const lead = defaultPackVariant(row.packVariants);

    return [
        {
            key: 'category',
            label: t('kitchen:products.columnCategory'),
            value:
                row.categoryCode.trim() === ''
                    ? t('kitchen:list.noCategory')
                    : categoryName(row.categoryCode),
        },
        {
            // "Sub-category", not a second "Category". Two fields reading `Category` one under the
            // other is the panel telling a reader nothing about which is which: the one above is
            // the platform taxonomy this row is filed under, and this is the kitchen's own filing
            // as the source workbook transcribed it — `Category / Subcategory` where the workbook
            // carried both.
            key: 'kitchenCategory',
            label: t('kitchen:fields.subcategory'),
            value:
                row.kitchenCategory === null
                    ? dash
                    : row.kitchenSubcategory === null
                      ? row.kitchenCategory
                      : `${row.kitchenCategory} / ${row.kitchenSubcategory}`,
        },
        {
            key: 'defaultPack',
            label: t('kitchen:products.viewDefaultPack'),
            value:
                lead === null
                    ? t('kitchen:products.noPacks')
                    : t('kitchen:products.packSummary', {
                          pack: displayName(lead.label, locale).value,
                          quantity: formatter.formatNumber(lead.netQuantity),
                          unit: t(unitShortKey(lead.netUnit)),
                      }),
            mono: true,
        },
        {
            key: 'packs',
            label: t('kitchen:products.columnPacks'),
            value: t('kitchen:products.packCount', { count: row.packVariants.length }),
            mono: true,
        },
        {
            key: 'pricing',
            label: t('kitchen:products.marketPricedShort'),
            value: row.isMarketPriced ? t('kitchen:common.yes') : t('kitchen:common.no'),
        },
        {
            key: 'assorted',
            label: t('kitchen:products.assortedShort'),
            value: row.isAssorted ? t('kitchen:common.yes') : t('kitchen:common.no'),
        },
        {
            key: 'dataQuality',
            label: t('kitchen:products.columnFlags'),
            value:
                row.dataQualityFlags.length === 0
                    ? dash
                    : t('kitchen:products.dataQualityCount', {
                          count: row.dataQualityFlags.length,
                      }),
        },
        {
            key: 'composition',
            label: t('kitchen:fields.composition'),
            value: row.composition ?? dash,
        },
        {
            key: 'status',
            label: t('kitchen:status.label'),
            value: t(statusShortKey(row.meta.status)),
        },
        {
            key: 'updated',
            label: t('kitchen:catalogue.columnUpdated'),
            value: formatter.formatRelativeTime(row.meta.updatedAt),
        },
        {
            key: 'updatedBy',
            label: t('kitchen:list.updatedBy', { name: '' }).trim(),
            value: row.meta.updatedByName ?? t('kitchen:list.updatedBySeed'),
        },
    ];
}

/**
 * The header control for one column — §4.3's sort-and-filter menu.
 *
 * Returns `undefined` for a column that can neither sort nor filter, which is what tells `DataList`
 * to draw a plain label instead of a focusable trigger nobody can act on.
 */
function headerMenu(
    column: CatalogueColumn<ProductAdmin>,
    list: ProductListState,
    t: TFunction,
): (() => ReactNode) | undefined {
    const sortKey = sortKeyFor(column.key);
    const filter = filterItemsFor(column.key, list, t);
    if (sortKey === null && filter.length === 0) return undefined;

    const active = sortKey !== null && list.sortKey === sortKey;
    const mark = !active ? '' : list.sortDirection === 'asc' ? ' ↑' : ' ↓';

    const sortItems: readonly MenuItem[] =
        sortKey === null
            ? []
            : [
                  {
                      key: 'asc',
                      label: t('kitchen:catalogue.sortAscending'),
                      selected: active && list.sortDirection === 'asc',
                      testID: `kitchen-products-column-${column.key}-asc`,
                      onSelect: () => {
                          list.setSort(sortKey, 'asc');
                      },
                  },
                  {
                      key: 'desc',
                      label: t('kitchen:catalogue.sortDescending'),
                      selected: active && list.sortDirection === 'desc',
                      testID: `kitchen-products-column-${column.key}-desc`,
                      onSelect: () => {
                          list.setSort(sortKey, 'desc');
                      },
                  },
              ];

    return () => (
        <Menu
            label={t('kitchen:catalogue.columnMenu', { column: column.label })}
            align="start"
            // The header cell is inside the list's own stacking context and the rows paint after
            // it, so a panel hanging from the header lands *under* the first rows without this.
            className="z-sticky"
            sections={[
                ...(sortItems.length === 0 ? [] : [{ items: sortItems }]),
                ...(filter.length === 0
                    ? []
                    : [{ label: t('kitchen:catalogue.filter'), items: filter }]),
            ]}
            trigger={({ triggerProps, toggle }) => (
                <Text
                    {...triggerProps}
                    variant="micro"
                    tone={active ? 'primary' : 'secondary'}
                    align={column.align === 'center' ? 'center' : undefined}
                    role="button"
                    onPress={toggle}
                    testID={`kitchen-products-column-${column.key}-trigger`}
                >
                    {`${column.label}${mark}`}
                </Text>
            )}
            testID={`kitchen-products-column-${column.key}`}
        />
    );
}

/** The sort the hook understands for a column, or `null` where there is none. */
function sortKeyFor(key: string): SortKey | null {
    if (
        key === 'reference' ||
        key === 'name' ||
        key === 'category' ||
        key === 'status' ||
        key === 'updatedAt'
    ) {
        return key;
    }
    return null;
}

/**
 * The value list under a column's Filter heading.
 *
 * Only the two the request can carry. Packs, Channels and Flags have no filter parameter on
 * `ProductAdminFilter`, so their headers sort nothing and filter nothing — narrowing one loaded
 * page and calling it a filter would misreport every page after it.
 *
 * Status offers all four, including Archived, which is what makes it fine for the toolbar's
 * segments to name only three.
 */
function filterItemsFor(
    key: string,
    list: ProductListState,
    t: TFunction,
): readonly MenuItem[] {
    if (key === 'status') {
        return [
            ...PRODUCT_STATUS_FILTERS.map((status: PublishableStatus) => ({
                key: status,
                label: t(statusShortKey(status)),
                selected: list.statuses.includes(status),
                testID: `kitchen-products-column-status-${status}`,
                onSelect: () => {
                    list.setStatuses(list.statuses[0] === status ? [] : [status]);
                },
            })),
            ...(list.statuses.length === 0
                ? []
                : [
                      clearItem('status', t, () => {
                          list.setStatuses([]);
                      }),
                  ]),
        ];
    }

    if (key === 'category') {
        return [
            ...list.categories.map((entry) => ({
                key: entry.code,
                label: humaniseCode(entry.code),
                selected: list.category === entry.code,
                testID: `kitchen-products-column-category-${entry.code}`,
                onSelect: () => {
                    list.setCategory(list.category === entry.code ? null : entry.code);
                },
            })),
            ...(list.category === null
                ? []
                : [
                      clearItem('category', t, () => {
                          list.setCategory(null);
                      }),
                  ]),
        ];
    }

    return [];
}

function clearItem(column: string, t: TFunction, onSelect: () => void): MenuItem {
    return {
        key: 'clear',
        label: t('kitchen:catalogue.clearFilter'),
        testID: `kitchen-products-column-${column}-clear`,
        onSelect,
    };
}
