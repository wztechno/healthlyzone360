import type { IngredientAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import { Button, Dialog, Icon, Inline, Stack, Text, useToast } from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueListBody } from '../catalogue/catalogue-list-body.tsx';
import type { ColumnControl } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { CatalogueTransferActions } from '../catalogue/catalogue-transfer-actions.tsx';
import { statusSegments } from '../catalogue/use-catalogue-filters.ts';
import type { StatusSegmentValue } from '../catalogue/use-catalogue-filters.ts';
import { RecordPhoto } from '../catalogue/record-photo.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import type { CatalogueViewField } from '../catalogue/record-view-page.tsx';
import {
    PACKAGING_DEFAULT_COLUMNS,
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
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/packaging` — bags, boxes, lids, cutlery and labels, and what each costs.
 *
 * ```
 * Kitchen workspace › Packaging                   <- drawn by the shell, not here
 * ┌ SHOWN ┐ ┌ UNPRICED ┐ ┌ INACTIVE ┐ ┌ MISSING ARABIC ┐
 *         [ ⌕ 240px ]  [ All | Published | Draft | Review ]
 * ID  ITEM  CATEGORY  PACK  PER PACK  PACK PRICE  HOLDS  WASTE  STATUS  ⋯
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
 * `review_required` is offered too, by request. It was left out on the argument that the state is
 * the *allergen quarantine* — a record whose determination contradicts a published recipe — and a
 * box declares no allergens, so nothing could put one there. That describes how a row *enters* the
 * state, not whether the field can hold it: it is a column on the same ingredient table, and an
 * import or a hand edit can set it. The segments are All · Published · Draft · Review; Archived is
 * on the Status column's own filter.
 *
 * ## The row controls are View, Edit and Archive
 *
 * All three are the ingredient ones, because these are ingredients. Edit goes to
 * `/kitchen/packaging/{item}`, which is the ingredient form wearing this family's series (`PKG-`),
 * its category and its back-link — see `packaging-edit-screen.tsx` for why that is a wrapper rather
 * than a second form. `new` is a value of the same parameter, so the header's New packaging and a
 * row's Edit land in one place. Archive is offered only where the server would accept it: the
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

    const controls = useColumnControls<IngredientAdmin, CatalogueColumn<IngredientAdmin>>(
        list.rows,
        columns.map((column) => ({ ...column, ...columnControl(column.key, list, t, locale) })),
        'kitchen-packaging',
        {
            sort: {
                key: list.sortKey,
                direction: list.sortDirection,
                onChange: (key, direction) => {
                    if (isIngredientAdminSortKey(key)) list.setSort(key, direction);
                },
            },
            picker: { defaults: PACKAGING_DEFAULT_COLUMNS },
        },
    );

    const segments = statusSegments(list.statuses, list.setStatuses, t, packagingStatusKey);

    /*
     * View takes the whole page (`IngredientView.dc.html`), in place of the list rather than on a
     * route of its own — Back is a state change, so the list's page, sort and filters survive it.
     */
    const viewing = list.viewing;
    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-packaging-view"
                media={
                    <RecordPhoto
                        assetId={`ingredient-${viewing.slug}`}
                        label={displayName(viewing.name, locale).value}
                        shape="square"
                        testID="kitchen-packaging-view-photo"
                    />
                }
                kind={t('kitchen:packaging.viewKind')}
                {...(viewing.reference === null ? {} : { reference: viewing.reference })}
                title={displayName(viewing.name, locale).value}
                status={{
                    tone: packagingStatusTone(viewing.meta.status),
                    label: t(packagingStatusKey(viewing.meta.status)),
                }}
                fields={viewFields(viewing, t, formatter, categoryName)}
                onBack={list.closeView}
                // Deciding to edit after looking is one control, not a back and a hunt back down
                // the table for the row.
                primaryAction={{
                    label: t('kitchen:catalogue.edit'),
                    testID: 'kitchen-packaging-view-edit',
                    onPress: () => {
                        list.closeView();
                        list.openEditor(String(viewing.id));
                    },
                }}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-packaging-screen">
            <Stack space="xs">
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
                statusSegments={segments.segments}
                status={segments.value}
                onStatusChange={segments.onChange}
            >
                <ColumnPicker {...controls.picker} />
                {canManage ? (
                    <Inline space="xs" align="center">
                        <CatalogueTransferActions testID="kitchen-packaging-toolbar" />
                        {/*
                         * `/kitchen/packaging/new` — the same form a row's Edit opens,
                         * handed the packaging series and the packaging category. A new
                         * record therefore arrives already filed where this list looks,
                         * which is what stops a successful save from producing a row the
                         * page that created it cannot show.
                         */}
                        <Button
                            testID="kitchen-packaging-toolbar-create"
                            label={t('kitchen:packaging.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                list.openEditor('new');
                            }}
                        />
                    </Inline>
                ) : undefined}
            </CatalogueToolbar>

            <CatalogueListBody
                testID="kitchen-packaging"
                list={list}
                empty={{
                    title: t('kitchen:packaging.emptyTitle'),
                    body: t('kitchen:packaging.emptyBody'),
                }}
                filteredEmpty={{
                    title: t('kitchen:list.filteredEmptyTitle'),
                    body: t('kitchen:list.filteredEmptyBody'),
                }}
            >
                <CatalogueList
                    testID="kitchen-packaging-table"
                    label={t('kitchen:packaging.caption')}
                    columns={controls.columns}
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
                        // Edit opens `/kitchen/packaging/{item}` — the ingredient form, which
                        // can edit these rows because they are ingredients, wearing this
                        // family's series, category and back-link.
                        {
                            key: 'edit',
                            label: t('kitchen:catalogue.edit'),
                            icon: CATALOGUE_ROW_ICONS.edit,
                            testID: `${packagingRowTestId(row.id)}-open`,
                            onSelect: () => {
                                list.openEditor(String(row.id));
                            },
                        },
                        /*
                         * Archive is *drawn* for anyone who may manage the catalogue and
                         * *enabled* only where the server would accept it — the ingredient
                         * list's rule, and for the same reason.
                         *
                         * It used to be omitted on any row the server would refuse, and every
                         * seeded packaging row is a platform-library row, so a kitchen saw no
                         * Archive anywhere on the page and could not tell "this row cannot be
                         * archived" from "this list has no archive". Disabled answers that and
                         * still never fires the request that would 403. The permission stays a
                         * hard gate: an action a role cannot perform at all is not a disabled
                         * control, it is somebody else's button.
                         */
                        ...(canManage
                            ? [
                                  {
                                      key: 'archive',
                                      label: t('kitchen:list.archive'),
                                      icon: CATALOGUE_ROW_ICONS.archive,
                                      tone: 'danger' as const,
                                      disabled: !row.isEditable || row.meta.status === 'retired',
                                      testID: `${packagingRowTestId(row.id)}-archive`,
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
            mark: 'list',
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
            mark: 'coins',
            // Amber only while there is something to act on — see the note in the component.
            tone: list.unpricedCount === 0 ? 'default' : 'warning',
        },
        {
            key: 'inactive',
            label: t('kitchen:packaging.statInactive'),
            value: String(list.inactiveCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:packaging.statInactiveCaption'),
            mark: 'hidden',
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
            mark: 'languages',
            tone: list.missingArabicCount === 0 ? 'default' : 'danger',
        },
    ];
}

/**
 * What one column's header does — handed to `useColumnControls`, which draws it.
 *
 * Two columns filter, the two `PackagingAdminFilter` carries: Status, and Category through its
 * `categoryCode`. Category offers *sub-categories* on purpose — the branch is the same on every
 * row here, so offering it would narrow nothing. Every other column sorts through the list hook:
 * the pack unit is a closed set, but the filter has no parameter for it, so it sorts too.
 */
function columnControl(
    key: string,
    list: PackagingListState,
    t: TFunction,
    locale: string,
): ColumnControl<IngredientAdmin> {
    if (key === 'status') {
        return {
            filter: {
                values: () =>
                    PACKAGING_STATUS_FILTERS.map((status: PublishableStatus) => ({
                        key: status,
                        label: t(packagingStatusKey(status)),
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
                values: () =>
                    list.categories.map((entry) => ({
                        key: entry.code,
                        label: displayName(entry.name, locale).value,
                    })),
                external: {
                    value: list.category,
                    onChange: (next) => {
                        list.setCategory(next);
                    },
                },
            },
        };
    }
    return isIngredientAdminSortKey(key) ? { sort: 'external' } : {};
}

function isIngredientAdminSortKey(key: string): key is PackagingSortKey {
    return (
        key === 'reference' ||
        key === 'name' ||
        key === 'category' ||
        key === 'purchaseUnit' ||
        key === 'itemsPerUnit' ||
        key === 'purchasePrice' ||
        key === 'capacity' ||
        key === 'waste'
    );
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
