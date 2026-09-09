import type { IngredientAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
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
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
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
import {
    packagingColumns,
    packagingRowTestId,
    packagingStatusKey,
    packagingStatusTone,
} from '../catalogue/packaging-columns.tsx';
import { PACKAGING_STATUS_FILTERS } from '../catalogue/use-packaging-list.ts';
import type { PackagingListState, PackagingSortKey } from '../catalogue/use-packaging-list.ts';
import { usePackagingList } from '../catalogue/use-packaging-list.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, humaniseCode, unitShortKey } from '../format.ts';

/**
 * `/kitchen/packaging` — bags, boxes, lids, cutlery and labels, and what each costs.
 *
 * ```
 * Kitchen workspace › Packaging                   <- drawn by the shell, not here
 * ┌ SHOWN ┐ ┌ UNPRICED ┐ ┌ INACTIVE ┐ ┌ MISSING ARABIC ┐
 * [ ⌕ 240px ]  [ All | Live | Draft ]
 * REF.  NAME  CATEGORY  PACK  PER PACK  PACK PRICE  HOLDS  WASTE  STATUS  ⋯
 * Showing 1–25 of 33                                            [ ‹ 1 2 › ]
 * ```
 *
 * ## One table, read from the packaging end
 *
 * Packaging and food share `ingredients` again, told apart by the taxonomy: every row here is
 * filed under `packaging-disposables`, this page asks for that branch by name, and the ingredient
 * list excludes it. Two lists, one collection, read from opposite ends.
 *
 * It had a table of its own for one slice, and the argument for that was a bug rather than a
 * difference. The first version of this page queried `/catalogue/ingredients` with a category
 * filter; when the code stopped resolving, the filter silently degraded to *no* filter and the
 * page rendered three hundred ingredients. That is the failure mode of a filter that can widen —
 * it does not break, it lies. Both directions are now closed at the repository: an inclusion it
 * cannot resolve returns an empty page, an exclusion it cannot resolve is refused outright. The
 * property the split was buying is bought without the second table.
 *
 * Sauces and dressings are the same shape of answer one level up: `catalogue_items` holds products,
 * meals, sauces, dressings and plans in one table discriminated by `item_type`, and each screen
 * shows one kind. This is that pattern, with the category doing the discriminating.
 *
 * ## What the page is for
 *
 * One question: what does this cost, and how many does a batch need. That is why the pack price and
 * the capacity are tracks on the row rather than fields in a panel, and why **Unpriced** is the
 * second stat card. A recipe's technical sheet withholds its total entirely while any one packaging
 * line is unpriced, so an unpriced box silently takes the bottom line off every recipe that ships
 * in it — which makes that figure the one number on this page somebody is expected to clear.
 *
 * ## The status vocabulary is the ingredient one
 *
 * `PackagingStatus` was active / inactive / archived, and the ingredient column's own CHECK had
 * carried exactly those three all along — two enums for one vocabulary, which is drift waiting to
 * happen. So the enum went and these rows read the words the rest of the catalogue uses: Live,
 * Draft, Archived.
 *
 * What is still absent is `review_required`. That state is the *allergen quarantine* — a record
 * whose determination contradicts a published recipe — and a box declares no allergens, so nothing
 * can put one there. The toolbar segments are All · Live · Draft; Archived is on the Status
 * column's own filter, and no control here offers a transition the server cannot make.
 *
 * ## The row controls are View, Edit and Archive
 *
 * All three are the ingredient ones, because these are ingredients. Edit does not need a route
 * behind `/kitchen/packaging/{item}` — the rows carry ingredient ids, so
 * {@link PackagingListState.openEditor} sends a reader to `/kitchen/ingredients/{item}`, which
 * edits exactly this record. Archive is offered only where the server would accept it: the
 * permission, the row's own `isEditable`, and a row that is not already archived.
 */
export function PackagingScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-packaging"
        >
            <PackagingList />
        </Gate>
    );
}

/**
 * All · Active · Inactive.
 *
 * Three, not four. Archived is reachable from the Status column's own filter, which is the call the
 * ingredient list makes about `retired`: a fourth segment would spend a quarter of a primary
 * control on the one state a catalogue is almost never browsed in.
 */
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft'];

type StatusSegmentValue = PublishableStatus | 'all';

function PackagingList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const list = usePackagingList();

    /**
     * Code → the taxonomy's own name for it.
     *
     * The wire carries the pair of category ids and the repository maps them to codes; nothing
     * sends a resolved name. The packaging table used to denormalise one onto every row, which is
     * what this replaces — one lookup built once per render, over six nodes.
     */
    const categoryName = useMemo(() => {
        const names = new Map(
            list.categoryTree.map((entry) => [entry.code, displayName(entry.name, locale).value]),
        );
        return (code: string): string => names.get(code) ?? humaniseCode(code);
    }, [list.categoryTree, locale]);

    const columns = useMemo(
        () => packagingColumns({ t, locale, formatter, categoryName }),
        [t, locale, formatter, categoryName],
    );

    const withHeaders = columns.map((column) => ({
        ...column,
        renderHeader: headerMenu(column, list, t, locale),
    }));

    const active = list.statuses[0];
    const segmentValue: StatusSegmentValue =
        active !== undefined && SEGMENT_STATUSES.includes(active) ? active : 'all';

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((status) => ({
            value: status,
            label: t(packagingStatusKey(status)),
        })),
    ];

    return (
        <Stack space="md" testID="kitchen-packaging-screen">
            <Stack space="xs">
                <CataloguePageHeader testID="kitchen-packaging-header" />

                {list.isPending ? null : (
                    <CatalogueStatCards
                        testID="kitchen-packaging-stats"
                        cards={statCards(list, t)}
                    />
                )}
            </Stack>

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-packaging-toolbar"
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:packaging.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={segmentValue}
                onStatusChange={(status) => {
                    list.setStatuses(status === 'all' ? [] : [status]);
                }}
            />

            {list.isPending ? (
                <Stack space="xs" testID="kitchen-packaging-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-packaging-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : list.failure !== null ? (
                <ErrorState
                    testID="kitchen-packaging-error"
                    failure={list.failure}
                    onRetry={list.refetch}
                    retrying={list.isFetching}
                />
            ) : list.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-packaging-empty"
                    title={
                        list.isUnfiltered
                            ? t('kitchen:packaging.emptyTitle')
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        list.isUnfiltered
                            ? t('kitchen:packaging.emptyBody')
                            : t('kitchen:list.filteredEmptyBody')
                    }
                    actions={
                        list.isUnfiltered ? undefined : (
                            <Inline space="sm" wrap>
                                <Button
                                    testID="kitchen-packaging-clear"
                                    variant="secondary"
                                    label={t('kitchen:toolbar.clearFilters')}
                                    onPress={list.clearFilters}
                                />
                            </Inline>
                        )
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList
                        testID="kitchen-packaging-table"
                        label={t('kitchen:packaging.caption')}
                        columns={withHeaders}
                        rows={list.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        // The row body opens the panel, not the editor. Reading is what this page
                        // is for — what a box costs and how many a batch needs — so the cheap
                        // answer is the one a click lands on, and Edit is one control away.
                        onRowPress={(row) => {
                            list.openView(row);
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        // View, Edit, Archive, the order every other Catalogue list draws them in.
                        // Above `md` they are flat icon buttons on the row; below it the same array
                        // becomes the overflow menu, because a narrow row fits one control.
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${packagingRowTestId(row.id)}-view`,
                                onSelect: () => {
                                    list.openView(row);
                                },
                            },
                            // Edit is the *ingredient* editor, which can edit these rows because
                            // they are ingredients. There is still no `/kitchen/packaging/{item}`
                            // route, and there does not need to be one.
                            {
                                key: 'edit',
                                label: t('kitchen:list.open'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${packagingRowTestId(row.id)}-open`,
                                onSelect: () => {
                                    list.openEditor(String(row.id));
                                },
                            },
                            // Archive is offered only where it would be accepted: the permission,
                            // the server's own answer for this row, and a row that is not already
                            // archived. A kitchen browsing the shared library would otherwise be
                            // offered Archive on every platform row and get a 403 on each.
                            ...(canManage && row.isEditable && row.meta.status !== 'retired'
                                ? [
                                      {
                                          key: 'archive',
                                          label: t('kitchen:list.archive'),
                                          icon: CATALOGUE_ROW_ICONS.archive,
                                          tone: 'danger' as const,
                                          testID: `${packagingRowTestId(row.id)}-archive`,
                                          onSelect: () => {
                                              list.askToArchive(row);
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-packaging-pagination"
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
                testID="kitchen-packaging-view"
                open={list.viewing !== null}
                onClose={list.closeView}
                kindLabel={t('kitchen:packaging.viewKind')}
                fieldsLabel={t('kitchen:list.viewFields')}
                closeLabel={t('kitchen:catalogue.close')}
                // Deciding to edit after looking is one control, not a close and a hunt back down
                // the table for the row.
                editLabel={t('kitchen:catalogue.edit')}
                onEdit={() => {
                    const viewed = list.viewing;
                    if (viewed === null) return;
                    list.closeView();
                    list.openEditor(String(viewed.id));
                }}
                {...(list.viewing === null || list.viewing.reference === null
                    ? {}
                    : { reference: list.viewing.reference })}
                title={list.viewing === null ? '' : displayName(list.viewing.name, locale).value}
                status={
                    list.viewing === null ? undefined : (
                        <Badge
                            tone={packagingStatusTone(list.viewing.meta.status)}
                            label={t(packagingStatusKey(list.viewing.meta.status))}
                        />
                    )
                }
                fields={
                    list.viewing === null
                        ? []
                        : viewFields(list.viewing, t, formatter, categoryName)
                }
            />

            {/*
             * Archiving takes the item out of use. The dialog says what that costs — a recipe that
             * still names it keeps naming it, and its technical sheet keeps costing it — because
             * "archive" on its own reads like a delete and is not one.
             */}
            <Dialog
                testID="kitchen-packaging-archive-dialog"
                open={list.archiving !== null}
                onClose={list.cancelArchive}
                title={t('kitchen:packaging.archiveTitle')}
                description={t('kitchen:packaging.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-packaging-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelArchive}
                        />
                        <Button
                            testID="kitchen-packaging-archive-confirm"
                            variant="danger"
                            label={t('kitchen:packaging.archiveConfirm')}
                            loading={list.isArchivePending}
                            onPress={() => {
                                list.confirmArchive((name) => {
                                    toast.show({
                                        testID: 'kitchen-packaging-archived-toast',
                                        tone: 'success',
                                        message: t('kitchen:packaging.archivedToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.archiveFailure === null ? null : (
                    <Text testID="kitchen-packaging-archive-error" tone="danger">
                        {list.archiveFailure.message ?? t('kitchen:packaging.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/**
 * The four figures, as cards.
 *
 * Unpriced is second because it is what this page exists to chase: a recipe's technical sheet
 * withholds its total while any packaging line has no price, so an unpriced box takes the bottom
 * line off every recipe that ships in it. `total` is the server's count for the filtered set; the
 * three beside it are counted over the loaded page, which is the only set this screen has.
 */
function statCards(list: PackagingListState, t: TFunction): readonly CatalogueStatCard[] {
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
            key: 'unpriced',
            label: t('kitchen:packaging.statUnpriced'),
            value: String(list.unpricedCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:packaging.statUnpricedCaption'),
            mark: 'warning',
            // Amber only while there is something to act on — see the note in the component.
            tone: list.unpricedCount === 0 ? 'default' : 'warning',
        },
        {
            key: 'inactive',
            label: t('kitchen:packaging.statInactive'),
            value: String(list.inactiveCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:packaging.statInactiveCaption'),
            mark: 'eyeOff',
            onPress: () => {
                list.setStatuses(['draft']);
            },
            accessibilityLabel: t('kitchen:packaging.statInactiveAction'),
        },
        {
            key: 'missingArabic',
            label: t('kitchen:list.statMissingArabic'),
            value: String(list.missingArabicCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:packaging.statMissingArabicCaption'),
            mark: 'warning',
            tone: list.missingArabicCount === 0 ? 'default' : 'danger',
        },
    ];
}

/** The sort keys the list hook understands, or `null` for a column that does not sort. */
function sortKeyFor(key: string): PackagingSortKey | null {
    if (key === 'reference' || key === 'name' || key === 'category' || key === 'purchasePrice') {
        return key;
    }
    return null;
}

/**
 * The sort-and-filter menu for one header, or `undefined` for a column that offers neither — which
 * tells `DataList` to draw a plain label rather than a focusable trigger that does nothing.
 *
 * Two columns filter, and they are the two `PackagingAdminFilter` carries: Status, and Sub-category
 * through its `categoryCode`. The pack unit, the capacity and the waste percentage sort nothing and
 * filter nothing — narrowing the loaded page while the pager still counted the whole set would
 * misreport every page after the first.
 */
function headerMenu(
    column: CatalogueColumn<IngredientAdmin>,
    list: PackagingListState,
    t: TFunction,
    locale: string,
): (() => ReactNode) | undefined {
    const sortKey = sortKeyFor(column.key);
    const filter = filterItemsFor(column.key, list, t, locale);
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
                      testID: `kitchen-packaging-column-${column.key}-asc`,
                      onSelect: () => {
                          list.setSort(sortKey, 'asc');
                      },
                  },
                  {
                      key: 'desc',
                      label: t('kitchen:catalogue.sortDescending'),
                      selected: active && list.sortDirection === 'desc',
                      testID: `kitchen-packaging-column-${column.key}-desc`,
                      onSelect: () => {
                          list.setSort(sortKey, 'desc');
                      },
                  },
              ];

    return () => (
        <Menu
            label={t('kitchen:catalogue.columnMenu', { column: column.label })}
            align="start"
            // The header sits inside the list's own stacking context and the rows paint after it,
            // so a panel hanging from the header lands under the first rows without this.
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
                    testID={`kitchen-packaging-column-${column.key}-trigger`}
                >
                    {`${column.label}${mark}`}
                </Text>
            )}
            testID={`kitchen-packaging-column-${column.key}`}
        />
    );
}

function filterItemsFor(
    key: string,
    list: PackagingListState,
    t: TFunction,
    locale: string,
): readonly MenuItem[] {
    if (key === 'status') {
        return [
            ...PACKAGING_STATUS_FILTERS.map((status: PublishableStatus) => ({
                key: status,
                label: t(packagingStatusKey(status)),
                selected: list.statuses.includes(status),
                testID: `kitchen-packaging-column-status-${status}`,
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

    // The Category column's menu still filters by *sub-category*, and deliberately: the branch is
    // the same value on every row on this page, so a filter offering it would narrow nothing. The
    // leaves — bags, containers, cutlery — are the only cut of this taxonomy worth making, and
    // `categoryCode` on the wire takes a leaf code as readily as the root.
    if (key === 'category') {
        return [
            ...list.categories.map((entry) => ({
                key: entry.code,
                label: displayName(entry.name, locale).value,
                selected: list.category === entry.code,
                testID: `kitchen-packaging-column-category-${entry.code}`,
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
        testID: `kitchen-packaging-column-${column}-clear`,
        onSelect,
    };
}

/**
 * The panel behind View.
 *
 * It repeats the row's figures rather than only adding to them, because this is where a record is
 * read field by field and a panel that omitted the price would send the reader back to the table to
 * check it. What it adds is the category, the issued unit and the material — the three the row has
 * no track for.
 */
function viewFields(
    row: IngredientAdmin,
    t: TFunction,
    formatter: Formatter,
    categoryName: (code: string) => string,
): readonly CatalogueViewField[] {
    const dash = t('kitchen:list.noValue');

    return [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            value: row.reference ?? dash,
            mono: true,
        },
        {
            key: 'category',
            label: t('kitchen:list.columnCategory'),
            value: row.categoryCode === '' ? dash : categoryName(row.categoryCode),
        },
        {
            key: 'subcategory',
            label: t('kitchen:fields.subcategory'),
            value: row.subcategoryCode === null ? dash : categoryName(row.subcategoryCode),
        },
        {
            key: 'unit',
            label: t('kitchen:list.columnUnit'),
            value: t(unitShortKey(row.measurementUnit)),
        },
        {
            key: 'purchaseUnit',
            label: t('kitchen:fields.purchaseUnit'),
            value: row.purchaseUnit === null ? dash : t(unitShortKey(row.purchaseUnit)),
        },
        {
            key: 'itemsPerUnit',
            label: t('kitchen:fields.itemsPerUnit'),
            value: row.itemsPerUnit === null ? dash : formatter.formatNumber(row.itemsPerUnit),
            mono: true,
        },
        {
            key: 'purchasePrice',
            label: t('kitchen:packaging.columnPackPrice'),
            value:
                row.purchasePrice === null
                    ? dash
                    : formatter.formatCurrency(
                          row.purchasePrice.amount,
                          row.purchasePrice.currency,
                      ),
            mono: true,
        },
        {
            key: 'capacity',
            label: t('kitchen:packaging.columnCapacity'),
            value:
                row.capacity === null
                    ? dash
                    : `${formatter.formatNumber(row.capacity.quantity)} ${t(unitShortKey(row.capacity.unit))}`,
            mono: true,
        },
        {
            key: 'waste',
            label: t('kitchen:packaging.columnWaste'),
            value:
                row.wastePercent === null ? dash : `${formatter.formatNumber(row.wastePercent)}%`,
            mono: true,
        },
        {
            key: 'composition',
            label: t('kitchen:fields.composition'),
            value: row.composition ?? dash,
        },
        {
            key: 'status',
            label: t('kitchen:status.label'),
            value: t(packagingStatusKey(row.meta.status)),
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
