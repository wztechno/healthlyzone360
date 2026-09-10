import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Icon,
    Inline,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { PublishableStatus, RecipeAdminSummary } from '@healthy360/api-client/contracts';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueColumnHeader } from '../catalogue/catalogue-column-header.tsx';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueViewDrawer } from '../catalogue/catalogue-view-drawer.tsx';
import type { CatalogueViewField } from '../catalogue/catalogue-view-drawer.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { CatalogueTransferActions } from '../catalogue/catalogue-transfer-actions.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { recipeColumns } from '../catalogue/recipe-columns.tsx';
import type { RecipeListState, RecipeSortKey } from '../catalogue/use-recipe-list.ts';
import { useRecipeList } from '../catalogue/use-recipe-list.ts';
import {
    RECIPE_STATUS_FILTERS,
    displayName,
    recipeRowTestId,
    statusShortKey,
    statusTone,
} from '../format.ts';

/**
 * `/kitchen/recipes` — the recipe list, drawn the way `/kitchen/ingredients` is.
 *
 * ```
 * Kitchen workspace › Recipes                      <- drawn by the shell, not here
 *                                                             [ + New recipe ]
 * ┌ SHOWN ┐ ┌ DRAFT ┐ ┌ AWAITING REVIEW ┐ ┌ MISSING ARABIC ┐
 * [ ⌕ 240px ]  [ All | Live | Draft | Review ]
 * REF.  RECIPE  KITCHEN  VERSION  VERSION STATE  ALLERGENS  STATUS  UPDATED   ⋯
 * Showing 1–25 of 84                                            [ ‹ 1 2 3 › ]
 * ```
 *
 * Four parts, in this order, and nothing else — the shape `ingredients-screen.tsx` records in full.
 * Everything that file argues for holds here unchanged and is not restated: no page title and no
 * trail of its own (the shell draws one and the nav rail has the page highlighted), no summary line
 * (its figures *are* the cards), no density switch and no field chooser, and every control at `sm`
 * except the one `md` primary. The entity difference is the column spec and the four figures, which
 * is the claim §4.1 makes.
 *
 * ## What is specific to recipes
 *
 * **Import is not drawn.** The ingredient list holds the button disabled because a library import
 * is a route that is coming; a recipe arrives by being written or by the technical-sheet import,
 * and neither is a control on this page. A disabled button with no route behind it is only worth
 * its space when the reader is expecting to find one.
 *
 * **The fourth card is Awaiting review, not Uncosted.** A recipe has no price on its summary, and
 * the figure a kitchen actually has to clear is the quarantine: `setIngredientAllergens` moves a
 * recipe to `review_required` when a published label it derived is contradicted, and those are the
 * rows somebody has to go and resolve before anything can publish. Unlike the ingredient list's two
 * read-only cards it is a real filter, because `RecipeAdminFilter.statuses` carries it.
 *
 * **The row has a fourth action.** View · Open · New draft · Archive. New draft appears only
 * against a version that cannot be edited in place — see `useRecipeList.isImmutable` — so most rows
 * draw three and the action column measures the widest one on the page.
 *
 * **The kitchen filter moved onto its column.** It was a `ListToolbar` disclosure; §4.3 says
 * filtering is a per-column act, and `kitchenId` is a real filter parameter, so the Kitchen
 * header's Filter narrows every page rather than the loaded one.
 */
export function RecipesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-recipes"
        >
            <RecipesList />
        </Gate>
    );
}

/**
 * The status segments: All · Live · Draft · Review.
 *
 * Four, not five — Archived is reachable from the Status column's own filter, and spending a fifth
 * of a primary control on the one state a catalogue is almost never browsed in is the trade the
 * ingredient toolbar already refused. `retired` is still a first-class filter, just not a segment.
 */
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];

type StatusSegmentValue = PublishableStatus | 'all';

function RecipesList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const list = useRecipeList();

    const { detailOf } = list;
    const columns = useMemo(
        () => recipeColumns({ t, locale, formatter, detailOf }),
        [t, locale, formatter, detailOf],
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

    const viewed = list.viewing;
    const viewedAllergens =
        viewed === null ? [] : (detailOf(viewed)?.currentVersion.allergens ?? []);

    return (
        <Stack space="md" testID="kitchen-recipes-screen">
            {/*
             * The opening — the action and the four figures — is one block at 4px, nested inside
             * the page's 16px rhythm. Same reasoning as the ingredient list: with no trail and no
             * title of its own the header is a right-aligned button row with nothing on its left,
             * and at the page's own 16px that read as two empty bands stacked above the first thing
             * worth looking at.
             */}
            <Stack space="xs">
                {list.isPending ? null : (
                    <CatalogueStatCards testID="kitchen-recipes-stats" cards={statCards(list, t)} />
                )}
            </Stack>

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-recipes-toolbar"
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:toolbar.searchRecipes')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                // Single-select, so "all" is the absence of a status rather than a status of its own.
                status={segmentValue}
                onStatusChange={(status) => {
                    list.setStatuses(status === 'all' ? [] : [status]);
                }}
            >
                {canManage ? (
                    <Inline space="xs" align="center">
                        <CatalogueTransferActions testID="kitchen-recipes-toolbar" />
                        <Button
                            testID="kitchen-recipes-toolbar-create"
                            label={t('kitchen:toolbar.createRecipe')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={list.createNew}
                        />
                    </Inline>
                ) : undefined}
            </CatalogueToolbar>

            {list.isPending ? (
                <Stack space="xs" testID="kitchen-recipes-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-recipes-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : list.failure !== null ? (
                <ErrorState
                    testID="kitchen-recipes-error"
                    failure={list.failure}
                    onRetry={list.refetch}
                    retrying={list.isFetching}
                />
            ) : list.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-recipes-empty"
                    title={
                        list.isUnfiltered
                            ? t('kitchen:recipes.emptyTitle')
                            : t('kitchen:recipes.filteredEmptyTitle')
                    }
                    body={
                        list.isUnfiltered
                            ? t('kitchen:recipes.emptyBody')
                            : t('kitchen:recipes.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-recipes-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={list.clearFilters}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-recipes-empty-create"
                                    label={t('kitchen:toolbar.createRecipe')}
                                    onPress={list.createNew}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList
                        testID="kitchen-recipes-table"
                        label={t('kitchen:recipes.caption')}
                        columns={withHeaders}
                        rows={list.rows}
                        rowKey={(row) => String(row.id)}
                        // Fixed, not switchable: the S/M/L control is gone.
                        density="sm"
                        onRowPress={(row) => {
                            list.openEditor(String(row.id));
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row) => rowActions(row, list, t, toast, canManage)}
                    />

                    <CataloguePager
                        testID="kitchen-recipes-pagination"
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
                testID="kitchen-recipes-view"
                open={viewed !== null}
                onClose={list.closeView}
                kindLabel={t('kitchen:recipes.viewKind')}
                fieldsLabel={t('kitchen:list.viewFields')}
                closeLabel={t('kitchen:catalogue.close')}
                editLabel={t('kitchen:catalogue.edit')}
                onEdit={() => {
                    if (viewed === null) return;
                    list.closeView();
                    list.openEditor(String(viewed.id));
                }}
                {...(viewed === null ? {} : { reference: viewed.slug })}
                title={viewed === null ? '' : displayName(viewed.name, locale).value}
                status={
                    viewed === null ? undefined : (
                        <Badge
                            tone={statusTone(viewed.meta.status)}
                            label={t(statusShortKey(viewed.meta.status))}
                        />
                    )
                }
                fields={viewed === null ? [] : viewFields(viewed, list, t, formatter)}
                {...(viewed === null || viewedAllergens.length === 0
                    ? {}
                    : {
                          chipsLabel: t('kitchen:recipes.columnAllergens'),
                          chipsSource: t('kitchen:recipes.viewAllergensSource'),
                          chipsCaption: t('kitchen:recipes.viewAllergensCaption'),
                          chips: viewedAllergens.map((declaration) => (
                              <Badge
                                  key={declaration.allergenCode}
                                  tone={
                                      declaration.containment === 'contains' ? 'danger' : 'warning'
                                  }
                                  label={declaration.allergenCode}
                              />
                          )),
                      })}
            />

            {/*
             * Retiring *is* the archive: the contract has no `archiveRecipe`, and nothing is
             * deleted because meals, products and cost snapshots still point at the version. A
             * refusal — a recipe a published meal still depends on — arrives as the server's own
             * sentence, which this dialog already renders.
             */}
            <Dialog
                testID="kitchen-recipes-archive-dialog"
                open={list.archiving !== null}
                onClose={list.cancelArchive}
                title={t('kitchen:recipes.archiveTitle')}
                description={t('kitchen:recipes.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipes-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelArchive}
                        />
                        <Button
                            testID="kitchen-recipes-archive-confirm"
                            variant="danger"
                            label={t('kitchen:recipes.archiveConfirm')}
                            loading={list.isArchivePending}
                            onPress={() => {
                                list.confirmArchive((name) => {
                                    toast.show({
                                        testID: 'kitchen-recipes-archived-toast',
                                        tone: 'success',
                                        message: t('kitchen:recipes.archivedToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.archiveFailure === null ? null : (
                    <Text testID="kitchen-recipes-archive-error" tone="danger">
                        {list.archiveFailure.message ?? t('kitchen:recipes.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/**
 * View · Open · New draft · Archive, in the design's order.
 *
 * Above `md` these are flat icon buttons on the row; below it the same array becomes the overflow
 * menu, because a narrow row has space for exactly one control.
 *
 * **New draft is conditional and that is the point.** A published or retired version is immutable,
 * so the only way to change it is to open its successor; offering the control against a draft that
 * is already open would write a version bump that changed nothing. It is absent while the row's
 * detail is in flight rather than disabled — a control that appears a beat later is better than one
 * that is there, refuses, and then starts working.
 */
function rowActions(
    row: RecipeAdminSummary,
    list: RecipeListState,
    t: TFunction,
    toast: ReturnType<typeof useToast>,
    canManage: boolean,
): readonly MenuItem[] {
    const testID = recipeRowTestId(String(row.id));
    const live = row.meta.status !== 'retired';

    return [
        {
            key: 'view',
            label: t('kitchen:list.view'),
            icon: CATALOGUE_ROW_ICONS.view,
            testID: `${testID}-view`,
            onSelect: () => {
                list.openView(row);
            },
        },
        {
            key: 'edit',
            label: t('kitchen:recipes.open'),
            icon: CATALOGUE_ROW_ICONS.edit,
            testID: `${testID}-open`,
            onSelect: () => {
                list.openEditor(String(row.id));
            },
        },
        ...(canManage && live && list.isImmutable(row)
            ? [
                  {
                      key: 'newDraft',
                      label: t('kitchen:recipes.newDraft'),
                      icon: 'plus' as const,
                      disabled: list.draftOpeningFor !== null,
                      testID: `${testID}-new-draft`,
                      onSelect: () => {
                          list.startDraft(row, (version) => {
                              toast.show({
                                  testID: 'kitchen-recipes-draft-opened-toast',
                                  tone: 'success',
                                  message: t('kitchen:recipes.draftOpenedToast', {
                                      number: version,
                                  }),
                              });
                          });
                      },
                  },
              ]
            : []),
        ...(canManage && live
            ? [
                  {
                      key: 'archive',
                      label: t('kitchen:recipes.archive'),
                      icon: CATALOGUE_ROW_ICONS.archive,
                      tone: 'danger' as const,
                      testID: `${testID}-archive`,
                      onSelect: () => {
                          list.askToArchive(row);
                      },
                  },
              ]
            : []),
    ];
}

/**
 * The four figures the summary line used to state, as cards.
 *
 * `total` is the server's count for the filtered set; the three beside it are counted over the
 * loaded page, which is the only set this screen has. That difference is why Shown reads "18 of 84"
 * rather than claiming the others are catalogue-wide.
 *
 * All four are pressable here, where the ingredient list has two that are not: every one of these
 * figures has a `RecipeAdminFilter` behind it except Missing Arabic, which is the single read-only
 * card — the contract carries no parameter for it, and a card that looked pressable and did nothing
 * would be worse than one that plainly does not.
 */
function statCards(list: RecipeListState, t: TFunction): readonly CatalogueStatCard[] {
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
            // Pressable in both states: clearing nothing is a no-op, and a card that stopped being
            // a target once the filters were clear would move the row's one affordance around.
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
            // Amber only while there is something to act on — see the note in the component.
            tone: list.draftCount === 0 ? 'default' : 'warning',
            onPress: () => {
                list.setStatuses(['draft']);
            },
            accessibilityLabel: t('kitchen:list.statDraftAction'),
        },
        {
            key: 'review',
            label: t('kitchen:recipes.statReview'),
            value: String(list.reviewCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:recipes.statReviewCaption'),
            mark: 'warning',
            // The one figure that blocks publication outright, so it takes the danger ink while
            // there is anything in it — and the ordinary raised fill, because the row spends its
            // one coloured panel on Draft.
            tone: list.reviewCount === 0 ? 'default' : 'danger',
            onPress: () => {
                list.setStatuses(['review_required']);
            },
            accessibilityLabel: t('kitchen:recipes.statReviewAction'),
        },
        {
            key: 'missingArabic',
            label: t('kitchen:list.statMissingArabic'),
            value: String(list.missingArabicCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:list.statMissingArabicCaption'),
            mark: 'warning',
            tone: list.missingArabicCount === 0 ? 'default' : 'warning',
        },
    ];
}

/**
 * The record, as the read-only panel lists it.
 *
 * The values the row already carries plus the four it has no track for — the source sheet's own
 * Kind, the version count in words, and who last touched it. Absent values render the dash rather
 * than being dropped: a panel whose rows change position depending on what is filled in cannot be
 * scanned twice the same way.
 */
function viewFields(
    row: RecipeAdminSummary,
    list: RecipeListState,
    t: TFunction,
    formatter: Formatter,
): readonly CatalogueViewField[] {
    const dash = t('kitchen:list.noValue');
    const versionStatus = list.detailOf(row)?.currentVersion.status;

    return [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            value: row.slug,
            mono: true,
        },
        {
            key: 'kitchen',
            label: t('kitchen:recipes.columnKitchen'),
            value: String(row.kitchenId),
        },
        {
            key: 'version',
            label: t('kitchen:recipes.columnVersion'),
            value: t('kitchen:recipes.versionNumber', { number: row.currentVersionNumber }),
            mono: true,
        },
        {
            key: 'versionState',
            label: t('kitchen:recipes.columnVersionState'),
            value: versionStatus === undefined ? dash : t(statusShortKey(versionStatus)),
        },
        {
            key: 'versionCount',
            label: t('kitchen:recipes.sectionVersions'),
            value: t('kitchen:recipes.versionCount', { count: row.versionCount }),
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
 * to draw a plain label instead of a focusable trigger nobody can act on. Version state and
 * Allergens land there: both are derived per row, and neither has a filter parameter.
 */
function headerMenu(
    column: CatalogueColumn<RecipeAdminSummary>,
    list: RecipeListState,
    t: TFunction,
): (() => React.ReactNode) | undefined {
    const sortKey = sortKeyFor(column.key);
    const filter = filterItemsFor(column.key, list, t);
    if (sortKey === null && filter.length === 0) return undefined;

    const active = sortKey !== null && list.sortKey === sortKey;
    // Any value in this column's own list that is currently applied. Derived from the items
    // rather than restated per entity: the screens already mark the applied value `selected`
    // so the menu can tick it, and "the menu has a tick" is exactly "the column is filtered".
    const filtered = filter.some((item) => item.selected === true);

    /*
     * A column with nothing to filter by sorts on the press itself - see `onToggleSort`. The cycle
     * is the one a reader expects from a table: first press sorts ascending, pressing the column
     * already sorted flips it.
     */
    const toggleSort =
        sortKey === null || filter.length > 0
            ? undefined
            : () => {
                  list.setSort(sortKey, active && list.sortDirection === 'asc' ? 'desc' : 'asc');
              };

    return () => (
        <CatalogueColumnHeader
            label={column.label}
            align={column.align}
            {...(toggleSort === undefined ? {} : { onToggleSort: toggleSort })}
            /*
             * Values only. The sort pair used to lead this list, which meant a column that could
             * only sort still opened a panel to ask "ascending or descending" - a second press for
             * something the first press already meant. Sorting is the press itself now, so a column
             * with no values to choose from has no menu at all, and `sections` being empty is
             * exactly what tells the header that.
             */
            sections={
                filter.length === 0 ? [] : [{ label: t('kitchen:catalogue.filter'), items: filter }]
            }
            // Three states, not two: `undefined` where the column cannot sort at all, so the
            // header knows to draw no arrow rather than a grey one pointing at nothing.
            sortDirection={
                sortKey === null || filter.length > 0
                    ? undefined
                    : active
                      ? list.sortDirection
                      : null
            }
            filtered={filtered}
            testID={`kitchen-recipes-column-${column.key}`}
        />
    );
}

/** The sort the hook understands for a column, or `null` where there is none. */
function sortKeyFor(key: string): RecipeSortKey | null {
    if (
        key === 'reference' ||
        key === 'name' ||
        key === 'kitchen' ||
        key === 'version' ||
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
 * Only the two the request can carry. The version, the version state and the derived allergen label
 * have no parameter on `RecipeAdminFilter`, so their headers sort — or do nothing — and narrowing
 * one loaded page and calling it a filter would misreport every page after it.
 *
 * Status offers all four, including Archived, which is what makes it fine for the toolbar's
 * segments to name only three.
 */
function filterItemsFor(key: string, list: RecipeListState, t: TFunction): readonly MenuItem[] {
    if (key === 'status') {
        return [
            ...RECIPE_STATUS_FILTERS.map((status: PublishableStatus) => ({
                key: status,
                label: t(statusShortKey(status)),
                selected: list.statuses.includes(status),
                testID: `kitchen-recipes-column-status-${status}`,
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

    if (key === 'kitchen') {
        return [
            // The per-kitchen recipe count the old toolbar's picker carried is gone with it: a
            // `MenuItem` is a label and a check, and the count was derived from one unfiltered page
            // rather than the catalogue — a figure that looked authoritative and was not.
            ...list.kitchens.map((entry) => ({
                key: String(entry.kitchenId),
                label: String(entry.kitchenId),
                selected: list.kitchen === String(entry.kitchenId),
                testID: `kitchen-recipes-column-kitchen-${String(entry.kitchenId)}`,
                onSelect: () => {
                    const value = String(entry.kitchenId);
                    list.setKitchen(list.kitchen === value ? null : value);
                },
            })),
            ...(list.kitchen === null
                ? []
                : [
                      clearItem('kitchen', t, () => {
                          list.setKitchen(null);
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
        testID: `kitchen-recipes-column-${column}-clear`,
        onSelect,
    };
}
