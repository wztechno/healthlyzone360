import type { ProductAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    Dialog,
    Icon,
    Inline,
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
import { CatalogueListBody } from '../catalogue/catalogue-list-body.tsx';
import type { ColumnControl } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import { CatalogueTransferActions } from '../catalogue/catalogue-transfer-actions.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { statusLensFigures, statusLensMix, statusLensTokens } from '../catalogue/lens-status.ts';
import { RecordPhoto } from '../catalogue/record-photo.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import type { CatalogueViewField } from '../catalogue/record-view-page.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { productColumns } from '../catalogue/product-columns.tsx';
import type {
    ProductItemType,
    ProductListState,
    ProductSortKey,
} from '../catalogue/use-product-list.ts';
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
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/products` — what this kitchen buys in and sells on as goods, rather than cooks. The
 * cooked kinds that were listed here too — sauces, dressings, frozen meals — are recipes in the
 * recipe book now.
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
 * ## Publishing is the editor's, not the list's
 *
 * `publishProduct` exists now — the route always did, only the client method was missing — but it
 * stays off the row menu. Publication has a gate (`CatalogueItemReadiness`) whose refusals are
 * specific and fixable, and a row menu has nowhere to show them: pressing Publish on a row that
 * cannot pass would be a toast saying no, with the four things to fix one screen away. The editor
 * draws that gate as a rail and puts the button beside it. So the row menu stays
 * View · Edit · Archive, and the status column renders whatever the record's state is.
 *
 * ## Where each control lives
 *
 * **Sorting and filtering are on the column header** (§4.3). Product, Category, Status and Updated
 * each open Sort ascending / Sort descending; Category and Status add their value list with a
 * Clear, because those two are what `ProductAdminFilter` actually carries. Packs, Channels and
 * Flags sort by nothing — each is a set, and narrowing one loaded page by a set would misreport
 * every page after it.
 *
 * **The status figures are filters.** All clears the status; Published and Draft narrow to it.
 * Missing Arabic and No pack are read-only, because the filter carries no parameter for either and a
 * figure that looked pressable and did nothing would be worse than one that plainly does not.
 */

type SortKey = ProductSortKey;

/**
 * The goods family this screen serves: its `item_type`, its address and the copy that names it.
 *
 * It served three once — sauces and dressings are products in apparatus, and were listed on their
 * own pages by `item_type` — until the cooked kinds joined the recipe book. Copy that names the
 * family is looked up here (literal keys, so extraction sees them); copy about the apparatus stays
 * under `kitchen:products.*`.
 */
export interface GoodsFamily {
    readonly itemType: ProductItemType;
    readonly routeBase: '/kitchen/products';
    readonly gateTestID: string;
    readonly create: string;
    readonly caption: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    /** The eyebrow over the View drawer — "Product", "Sauce", "Dressing". */
    readonly viewKind: string;
    readonly searchPlaceholder: string;
    /** The Lens bar's first figure — "All products". */
    readonly allLabel: string;
}

export const PRODUCTS_FAMILY: GoodsFamily = {
    itemType: 'product',
    routeBase: '/kitchen/products',
    gateTestID: 'kitchen-products',
    create: 'kitchen:products.create',
    caption: 'kitchen:products.caption',
    emptyTitle: 'kitchen:products.emptyTitle',
    emptyBody: 'kitchen:products.emptyBody',
    viewKind: 'kitchen:products.viewKind',
    searchPlaceholder: 'kitchen:products.searchPlaceholder',
    allLabel: 'kitchen:lens.allProducts',
};

export function ProductsScreen({
    family = PRODUCTS_FAMILY,
    view,
}: {
    readonly family?: GoodsFamily;
    readonly view?: string | undefined;
}) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID={family.gateTestID}
        >
            <ProductsList family={family} view={view} />
        </Gate>
    );
}

function ProductsList({
    family,
    view,
}: {
    readonly family: GoodsFamily;
    readonly view?: string | undefined;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const list = useProductList(family.itemType, family.routeBase, view);

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

    const controls = useColumnControls<ProductAdmin, CatalogueColumn<ProductAdmin>>(
        list.rows,
        columns.map((column) => ({ ...column, ...columnControl(column.key, list, t) })),
        'kitchen-products',
        {
            sort: {
                key: list.sortKey,
                direction: list.sortDirection,
                onChange: (key, direction) => {
                    if (isProductAdminSortKey(key)) list.setSort(key, direction);
                },
            },
        },
    );

    /*
     * View takes the whole page (`IngredientView.dc.html`), in place of the list rather than on a
     * route of its own — Back is a state change, so the list's page, sort and filters survive it.
     */
    const viewing = list.viewing;
    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-products-view"
                media={
                    <RecordPhoto
                        assetId={viewing.imagePlaceholderId}
                        photoUrl={viewing.photoUrl}
                        label={displayName(viewing.name, locale).value}
                        shape="wide"
                        testID="kitchen-products-view-photo"
                    />
                }
                kind={t(family.viewKind)}
                title={displayName(viewing.name, locale).value}
                status={{
                    tone: statusTone(viewing.meta.status),
                    label: t(statusShortKey(viewing.meta.status)),
                }}
                fields={viewFields(viewing, t, formatter, locale, categoryName)}
                onBack={list.closeView}
                primaryAction={{
                    label: t('kitchen:catalogue.edit'),
                    testID: 'kitchen-products-view-edit',
                    // The page stays open underneath: the editor's way back is this view.
                    onPress: () => {
                        list.openEditor(String(viewing.id));
                    },
                }}
                /*
                 * The channels as badges, and drawn even when the set is empty. On the row they are
                 * a comma run — twenty-five rows of coloured pills drown the names beside them —
                 * but here there is one record and room to look at it. An empty set says so in
                 * words, because "on no channel" and "nobody has looked" are the two answers a
                 * reader most needs told apart.
                 */
                chipsLabel={t('kitchen:products.columnChannels')}
                chipsCaption={t('kitchen:products.viewChannelsCaption')}
                chipsContent={channelChips(viewing, t)}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-products-screen">
            {/*
             * The Lens bar — figures, mix, query row and actions as one object directly over the
             * list it narrows (`lens-bar.tsx`), as on the ingredient list.
             */}
            <LensBar
                testID="kitchen-products-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(list, t, t(family.allLabel))}
                {...statusLensMix(list, t)}
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t(family.searchPlaceholder)}
                tokens={statusLensTokens(list, t)}
                result={
                    list.total === null
                        ? null
                        : t('kitchen:lens.result', { shown: list.shown, total: list.total })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(list.isUnfiltered ? {} : { onClear: list.clearFilters })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canManage ? (
                        <Inline space="xs" align="center">
                            <CatalogueTransferActions testID="kitchen-products-toolbar" />
                            <Button
                                testID="kitchen-products-toolbar-create"
                                label={t(family.create)}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={list.createNew}
                            />
                        </Inline>
                    ) : undefined
                }
            />

            <CatalogueListBody
                testID="kitchen-products"
                list={list}
                empty={{ title: t(family.emptyTitle), body: t(family.emptyBody) }}
                filteredEmpty={{
                    title: t('kitchen:products.filteredEmptyTitle'),
                    body: t('kitchen:products.filteredEmptyBody'),
                }}
                create={
                    canManage ? { label: t(family.create), onPress: list.createNew } : undefined
                }
            >
                <CatalogueList
                    testID="kitchen-products-table"
                    label={t(family.caption)}
                    columns={controls.columns}
                    rows={list.rows}
                    rowKey={(row) => String(row.id)}
                    // Fixed, not switchable: the S/M/L control is gone.
                    density="sm"
                    highlightedId={list.lastOpenedId}
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
                            label: t('kitchen:catalogue.edit'),
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
            </CatalogueListBody>

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
        </Cascade>
    );
}

/**
 * The Lens bar's figures: All · Published · Draft · Awaiting review, then the two that block
 * publishing. Missing Arabic and No pack count the rows the list shows, the status included.
 */
function lensFigures(
    list: ProductListState,
    t: TFunction,
    allLabel: string,
): readonly LensFigure[] {
    const counted = (count: number) => (list.countsPending ? null : count);
    return [
        ...statusLensFigures(list, t, {
            allLabel,
            review: true,
            reviewAction: t('kitchen:lens.reviewAction'),
        }),
        {
            key: 'missingArabic',
            label: t('kitchen:list.statMissingArabic'),
            value: counted(list.missingArabicCount),
            tone: 'danger',
            alarm: true,
            separated: true,
        },
        {
            key: 'noPack',
            label: t('kitchen:products.statNoPack'),
            value: counted(list.noPackCount),
            tone: 'warning',
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
 * What one column's header does — handed to `useColumnControls`, which draws it.
 *
 * Only Status and Category filter, because only those two travel on `ProductAdminFilter`;
 * Packs, Channels and Flags have no parameter, and narrowing the loaded page would misreport
 * every page after it. Status offers all four, Archived included, so the toolbar can name three.
 */
function columnControl(
    key: string,
    list: ProductListState,
    t: TFunction,
): ColumnControl<ProductAdmin> {
    if (key === 'status') {
        return {
            sort: 'external',
            filter: {
                values: () =>
                    PRODUCT_STATUS_FILTERS.map((status: PublishableStatus) => ({
                        key: status,
                        label: t(statusShortKey(status)),
                    })),
                external: {
                    value: list.statuses[0] ?? null,
                    onChange: (next) => {
                        list.setStatuses(next === null ? [] : [next as PublishableStatus]);
                    },
                },
            },
        };
    }
    if (key === 'category') {
        return {
            sort: 'external',
            filter: {
                // A value with no id is not offered: the endpoint narrows by id, so a code the read
                // could not pair with one would send no constraint while the header claimed a filter.
                values: () =>
                    list.categories
                        .filter((entry) => entry.id !== null)
                        .map((entry) => ({ key: entry.code, label: humaniseCode(entry.code) })),
                external: {
                    value: list.category,
                    onChange: (next) => {
                        list.setCategory(next);
                    },
                },
            },
        };
    }
    return isProductAdminSortKey(key) ? { sort: 'external' } : {};
}

function isProductAdminSortKey(key: string): key is SortKey {
    return (
        key === 'reference' ||
        key === 'name' ||
        key === 'category' ||
        key === 'status' ||
        key === 'updatedAt'
    );
}
