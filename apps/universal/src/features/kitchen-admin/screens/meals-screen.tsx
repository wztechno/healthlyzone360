import type { MealAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
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
import { MEAL_TYPES } from '@healthy360/domain-types';
import type { MealType } from '@healthy360/domain-types';
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
import { mealColumns } from '../catalogue/meal-columns.tsx';
import type { MealListState, MealSortKey } from '../catalogue/use-meal-list.ts';
import { useMealList } from '../catalogue/use-meal-list.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    MEAL_STATUS_FILTERS,
    availableChannels,
    channelKey,
    displayName,
    mealRowTestId,
    mealTypeKey,
    statusShortKey,
    statusTone,
} from '../format.ts';

/**
 * `/kitchen/meals` — the dishes this kitchen sells, and which of them a shopper can see.
 *
 * ```
 * Kitchen workspace › Meals                       <- drawn by the shell, not here
 *                                                              [ + New meal ]
 * ┌ SHOWN ┐ ┌ LIVE ┐ ┌ DRAFT ┐ ┌ MISSING ARABIC ┐
 * [ ⌕ 240px ]  [ All | Live | Draft | Review ]
 * MEAL   CHANNELS   MEAL TYPE   CATEGORY   ALLERGENS   STATUS   UPDATED   ⋯
 * Showing 1–25 of 96                                         [ ‹ 1 2 3 › ]
 * ```
 *
 * The Catalogue shell §4.1 describes, in the order it describes it, the same five parts the
 * ingredient and product lists draw.
 *
 * ## This is the one list whose rows a customer also reads
 *
 * Publishing a meal puts it in the marketplace listing and on its own public page; withdrawing one
 * takes it away. That is not a metaphor in this world — the admin and consumer surfaces read the
 * same store — so the publication column is the most load-bearing thing on the screen, and Live is
 * the second stat card rather than a figure buried under three others.
 *
 * ## Withdraw is the archive here, and publish is not on the row
 *
 * The contract publishes `publishMeal` and `retireMeal`. Only the second is a row action, in the
 * Archive slot the shell reserves — nothing is deleted, past orders and price-list entries still
 * point at the record, and the dialog says so because "withdraw" and "delete" must not read as one
 * word. Publishing is the deliberate act with the consequence stated in front of it, and the editor
 * is where that consequence is stated: a published meal is visible to every consumer surface at
 * once, and a quarantined one the server refuses structurally.
 *
 * ## "Visible to customers" moved into the View panel
 *
 * The row used to carry a caption under its status badge saying what publication *means*. A 28px
 * Catalogue row has one line, and spending it on a sentence that is the same on every published row
 * cost the tracks beside it. The statement is now a field in the drawer, where a record is read one
 * at a time — which is the reading it was written for.
 *
 * ## The second filter axis is the meal type, because that is what the contract publishes
 *
 * `MealAdminFilter` carries `mealTypes`; there is no meal category and no cuisine filter
 * server-side. One type at a time from the Meal type column's own header — a closed vocabulary of
 * four, so nothing has to be derived from the rows in use the way the product categories are.
 */

export function MealsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-meals"
        >
            <MealsList />
        </Gate>
    );
}

/**
 * All · Live · Draft · Review.
 *
 * Four, not five: Archived — `retired`, which for a meal means withdrawn — is reachable from the
 * Status column's own filter, and putting it on the toolbar would spend a fifth of a primary
 * control on the one state a menu is almost never browsed in.
 */
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];

type StatusSegmentValue = PublishableStatus | 'all';

function MealsList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const list = useMealList();

    const columns = useMemo(() => mealColumns({ t, locale, formatter }), [t, locale, formatter]);

    const withHeaders = columns.map((column) => ({
        ...column,
        renderHeader: headerMenu(column, list, t),
    }));

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
        <Stack space="md" testID="kitchen-meals-screen">
            <Stack space="xs">
                <CataloguePageHeader
                    testID="kitchen-meals-header"
                    primaryAction={
                        canManage ? (
                            <Button
                                testID="kitchen-meals-toolbar-create"
                                label={t('kitchen:meals.create')}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={list.createNew}
                            />
                        ) : undefined
                    }
                />

                {list.isPending ? null : (
                    <CatalogueStatCards testID="kitchen-meals-stats" cards={statCards(list, t)} />
                )}
            </Stack>

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-meals-toolbar"
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:meals.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={segmentValue}
                onStatusChange={(status) => {
                    list.setStatuses(status === 'all' ? [] : [status]);
                }}
            />

            {list.isPending ? (
                <Stack space="xs" testID="kitchen-meals-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-meals-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : list.failure !== null ? (
                <ErrorState
                    testID="kitchen-meals-error"
                    failure={list.failure}
                    onRetry={list.refetch}
                    retrying={list.isFetching}
                />
            ) : list.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-meals-empty"
                    title={
                        list.isUnfiltered
                            ? t('kitchen:meals.emptyTitle')
                            : t('kitchen:meals.filteredEmptyTitle')
                    }
                    body={
                        list.isUnfiltered
                            ? t('kitchen:meals.emptyBody')
                            : t('kitchen:meals.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-meals-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={list.clearFilters}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-meals-empty-create"
                                    label={t('kitchen:meals.create')}
                                    onPress={list.createNew}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList
                        testID="kitchen-meals-table"
                        label={t('kitchen:meals.caption')}
                        columns={withHeaders}
                        rows={list.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={(row) => {
                            list.openEditor(String(row.id));
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${mealRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    list.openView(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:list.open'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${mealRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    list.openEditor(String(row.id));
                                },
                            },
                            /*
                             * Withdraw sits in the Archive slot, because withdrawing *is* the
                             * archive for a meal — and it is offered only on a row the server would
                             * accept it for: a draft has nothing to withdraw from, and an already
                             * withdrawn meal would 409.
                             */
                            ...(canManage &&
                            (row.meta.status === 'published' ||
                                row.meta.status === 'review_required')
                                ? [
                                      {
                                          key: 'retire',
                                          label: t('kitchen:meals.retire'),
                                          icon: CATALOGUE_ROW_ICONS.archive,
                                          tone: 'danger' as const,
                                          testID: `${mealRowTestId(String(row.id))}-retire`,
                                          onSelect: () => {
                                              list.askToRetire(row);
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />

                    {/*
                     * 7a's provenance footer, verbatim from the frame: the numbers on a card are
                     * the recipe version's, and this is where a reader learns that.
                     */}
                    <Text variant="caption" tone="secondary" testID="kitchen-meals-provenance">
                        {t('kitchen:meals.tableProvenance')}
                    </Text>

                    <CataloguePager
                        testID="kitchen-meals-pagination"
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
                testID="kitchen-meals-view"
                open={list.viewing !== null}
                onClose={list.closeView}
                kindLabel={t('kitchen:meals.viewKind')}
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
                fields={list.viewing === null ? [] : viewFields(list.viewing, t, formatter)}
                /*
                 * Drawn even when the set is empty. The label is frozen from the recipe version at
                 * publication and cannot be edited on a meal, so an empty set here is a real
                 * declaration — and on the one field a kitchen reads for safety, "this meal declares
                 * none" and "nobody has looked" are the two answers that most need telling apart.
                 */
                {...(list.viewing === null
                    ? {}
                    : {
                          chipsLabel: t('kitchen:meals.columnAllergens'),
                          chipsSource: t('kitchen:meals.viewAllergensSource'),
                          chipsCaption: t('kitchen:meals.viewAllergensCaption'),
                          chips:
                              list.viewing.allergens.length === 0 ? (
                                  <Text tone="secondary">{t('kitchen:list.noAllergens')}</Text>
                              ) : (
                                  list.viewing.allergens.map((code) => (
                                      <Badge key={String(code)} tone="danger" label={String(code)} />
                                  ))
                              ),
                      })}
            />

            {/*
             * Withdrawing is what removes a meal from every consumer surface. The dialog says exactly
             * that, and says nothing is deleted, because orders and price-list entries still point
             * at the row — "withdraw" and "delete" are not the same word and must not read as one.
             */}
            <Dialog
                testID="kitchen-meals-retire-dialog"
                open={list.retiring !== null}
                onClose={list.cancelRetire}
                title={t('kitchen:meals.retireTitle')}
                description={t('kitchen:meals.retireBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-meals-retire-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelRetire}
                        />
                        <Button
                            testID="kitchen-meals-retire-confirm"
                            variant="danger"
                            label={t('kitchen:meals.retireConfirm')}
                            loading={list.isRetirePending}
                            onPress={() => {
                                list.confirmRetire((name) => {
                                    toast.show({
                                        testID: 'kitchen-meals-retired-toast',
                                        tone: 'success',
                                        message: t('kitchen:meals.retiredToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.retireFailure === null ? null : (
                    <Text testID="kitchen-meals-retire-error" tone="danger">
                        {list.retireFailure.message ?? t('kitchen:meals.retireFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/**
 * The four figures, as cards.
 *
 * Live is here rather than the ingredient list's Uncosted, because publication is what this
 * catalogue is *for*: the number a kitchen wants at a glance is how many dishes a shopper can see
 * right now. `total` is the server's count for the filtered set; the three beside it are counted
 * over the loaded page, which is the only set this screen has.
 */
function statCards(list: MealListState, t: TFunction): readonly CatalogueStatCard[] {
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
            key: 'live',
            label: t('kitchen:list.statLive'),
            value: String(list.liveCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:meals.statLiveCaption'),
            mark: 'eye',
            onPress: () => {
                list.setStatuses(['published']);
            },
            accessibilityLabel: t('kitchen:meals.statLiveAction'),
        },
        {
            key: 'draft',
            label: t('kitchen:list.statDraft'),
            value: String(list.draftCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:list.statDraftCaption'),
            mark: 'eyeOff',
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
    ];
}

/**
 * The record, as the read-only panel lists it.
 *
 * `visibleToConsumers` is a field here and not a caption on the row: it is the sentence the old
 * two-line status cell carried, and it says the same thing on every published record, so it belongs
 * where a record is read one at a time rather than repeated twenty-five times down a column.
 *
 * The margin is deliberately absent. `MealAdmin.marginPercent` is CONFIDENTIAL — the gross margin
 * against the recipe's cost per serving — and this panel opens from a list that asks only for the
 * catalogue *view* permission. It renders in the editor, labelled, behind the read that is entitled
 * to it.
 */
function viewFields(row: MealAdmin, t: TFunction, formatter: Formatter): readonly CatalogueViewField[] {
    const dash = t('kitchen:list.noValue');
    const channels = availableChannels(row.channelAvailability);

    return [
        {
            key: 'status',
            label: t('kitchen:status.label'),
            value: t(statusShortKey(row.meta.status)),
        },
        {
            key: 'visible',
            label: t('kitchen:meals.viewVisibility'),
            value:
                row.meta.status === 'published'
                    ? t('kitchen:meals.visibleToConsumers')
                    : t('kitchen:meals.notVisibleToConsumers'),
        },
        {
            key: 'mealTypes',
            label: t('kitchen:meals.typeFilterLabel'),
            value:
                row.mealTypes.length === 0
                    ? dash
                    : row.mealTypes.map((type) => t(mealTypeKey(type))).join(', '),
        },
        {
            key: 'category',
            label: t('kitchen:list.columnCategory'),
            value:
                row.kitchenCategory === null
                    ? t('kitchen:list.noCategory')
                    : row.kitchenSubcategory === null
                      ? row.kitchenCategory
                      : `${row.kitchenCategory} / ${row.kitchenSubcategory}`,
        },
        {
            key: 'channels',
            label: t('kitchen:meals.columnChannels'),
            value:
                channels.length === 0
                    ? t('kitchen:meals.noChannels')
                    : channels.map((channel) => t(channelKey(channel))).join(', '),
        },
        {
            // The portion sold, relative to one recipe serving — it rescales every nutrition figure
            // a customer reads, and it is on no track.
            key: 'portion',
            label: t('kitchen:meals.portionLabel'),
            value: formatter.formatNumber(row.portionFactor),
            mono: true,
        },
        {
            key: 'recipe',
            label: t('kitchen:meals.recipeLabel'),
            value: row.recipeId === null ? t('kitchen:meals.recipeNone') : String(row.recipeId),
            mono: true,
        },
        {
            key: 'composition',
            label: t('kitchen:fields.composition'),
            value: row.composition ?? dash,
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
 * to draw a plain label rather than a focusable trigger nobody can act on.
 */
function headerMenu(
    column: CatalogueColumn<MealAdmin>,
    list: MealListState,
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
                      testID: `kitchen-meals-column-${column.key}-asc`,
                      onSelect: () => {
                          list.setSort(sortKey, 'asc');
                      },
                  },
                  {
                      key: 'desc',
                      label: t('kitchen:catalogue.sortDescending'),
                      selected: active && list.sortDirection === 'desc',
                      testID: `kitchen-meals-column-${column.key}-desc`,
                      onSelect: () => {
                          list.setSort(sortKey, 'desc');
                      },
                  },
              ];

    return () => (
        <Menu
            label={t('kitchen:catalogue.columnMenu', { column: column.label })}
            align="start"
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
                    testID={`kitchen-meals-column-${column.key}-trigger`}
                >
                    {`${column.label}${mark}`}
                </Text>
            )}
            testID={`kitchen-meals-column-${column.key}`}
        />
    );
}

/** The sort the hook understands for a column, or `null` where there is none. */
function sortKeyFor(key: string): MealSortKey | null {
    if (key === 'name' || key === 'category' || key === 'status' || key === 'updatedAt') {
        return key;
    }
    return null;
}

/**
 * The value list under a column's Filter heading.
 *
 * Only the two the request can carry: `MealAdminFilter` publishes `statuses` and `mealTypes` and
 * nothing else. Channels, allergens and the kitchen's own filing pair have no parameter, so their
 * headers do not offer to narrow by them — filtering one loaded page would misreport every page
 * after it.
 */
function filterItemsFor(key: string, list: MealListState, t: TFunction): readonly MenuItem[] {
    if (key === 'status') {
        return [
            ...MEAL_STATUS_FILTERS.map((status: PublishableStatus) => ({
                key: status,
                label: t(statusShortKey(status)),
                selected: list.statuses.includes(status),
                testID: `kitchen-meals-column-status-${status}`,
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

    if (key === 'mealTypes') {
        return [
            ...MEAL_TYPES.map((type: MealType) => ({
                key: type,
                label: t(mealTypeKey(type)),
                selected: list.mealType === type,
                testID: `kitchen-meals-column-meal-type-${type}`,
                onSelect: () => {
                    list.setMealType(list.mealType === type ? null : type);
                },
            })),
            ...(list.mealType === null
                ? []
                : [
                      clearItem('meal-type', t, () => {
                          list.setMealType(null);
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
        testID: `kitchen-meals-column-${column}-clear`,
        onSelect,
    };
}
