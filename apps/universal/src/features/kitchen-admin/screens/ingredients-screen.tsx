import {
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
import type { IngredientAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { IngredientDetail } from '../catalogue/ingredient-detail.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { CatalogueTransferActions } from '../catalogue/catalogue-transfer-actions.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { ingredientColumns } from '../catalogue/ingredient-columns.tsx';
import type { IngredientListState, IngredientSortKey } from '../catalogue/use-ingredient-list.ts';
import { useIngredientList } from '../catalogue/use-ingredient-list.ts';
import type { ColumnControl } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import {
    INGREDIENT_STATUS_FILTERS,
    displayName,
    humaniseCode,
    ingredientRowTestId,
    statusShortKey,
} from '../format.ts';

/**
 * `/kitchen/ingredients` — the ingredient list, as `Catalogue.dc.html` draws it.
 *
 * ```
 * Kitchen workspace › Ingredients                 <- drawn by the shell, not here
 *                                                 [ Import ]  [ + New ingredient ]
 * ┌ SHOWN ┐ ┌ DRAFT ┐ ┌ MISSING ARABIC ┐ ┌ UNCOSTED ┐
 * [ ⌕ 240px ]  [ All | Live | Draft | Review ]
 * REF.   DESIGNATION   CATEGORY  UNIT  UNIT PRICE  ALLERGENS  STATUS  UPDATED   ⋯
 * Showing 1–25 of 306                                              [ ‹ 1 2 3 › ]
 * ```
 *
 * Four parts, in this order, and nothing else. Every control on the page is `sm` — the smallest the
 * ladder offers — except the one primary, which is the `md` the design gives it. Those numbers are
 * only real under `DensityProvider value="compact"`, which `KitchenOpsShell` supplies; on the
 * customer ladder `sm` is the 44px touch floor and the whole page renders half again too tall.
 *
 * ## What is deliberately absent
 *
 * **No page title and no trail of its own.** The shell's trail already ends in "Ingredients" and
 * the nav rail has it highlighted; a 16px heading between them is the third time the word appears
 * in 40px of screen, and a second trail is two answers to "where am I".
 *
 * **No summary line.** Its four figures are the four cards. Drawing both would state "2 draft"
 * twice, sixteen pixels apart.
 *
 * **No density switch and no field chooser.** The list is fixed at `sm`, so the S/M/L set had
 * nothing to switch; every column the spec declares is drawn and the fitter drops the low-priority
 * ones by itself, so the `▽` had nothing to hide. `CatalogueToolbar` records the reasoning.
 *
 * ## Where each control lives
 *
 * **Sorting and filtering are on the column header** (§4.3): each header opens Sort ascending /
 * Sort descending, and Status and Category add their value list with a Clear. Those two filter
 * because those two are what the request carries — filtering the loaded page by unit or allergen
 * would narrow one page and misreport every page after it, which is a worse answer than no filter.
 *
 * **Two of the four cards are filters.** Shown clears every constraint; Draft narrows to the
 * drafts. Missing Arabic and Uncosted are read-only because `IngredientAdminFilter` carries no
 * parameter for either, and a card that looked pressable and did nothing would be worse than one
 * that plainly does not.
 *
 * **Import is drawn and disabled.** There is no import route and no import endpoint — the library
 * arrives through the seeder — so the button holds its place with the reason on it rather than
 * shipping one that 404s.
 */
export function IngredientsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredients"
        >
            <IngredientsList />
        </Gate>
    );
}

/**
 * The status segments, as the design draws them: All · Live · Draft · Review.
 *
 * Four, not five. Archived is reachable from the Status column's own filter, and putting it on the
 * toolbar would spend a fifth of a primary control on the one state a catalogue is almost never
 * browsed in. `retired` is still a first-class filter — it is just not a first-class *segment*.
 */
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];

type StatusSegmentValue = PublishableStatus | 'all';

function IngredientsList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const list = useIngredientList();

    /**
     * Code → the catalogue's own name for it, for both levels of the tree.
     *
     * The row carries codes; a reader wants names. `humaniseCode` was standing in for this and is
     * only convincing at the top level — it renders `baking-starch` as "Baking Starch" where the
     * category is called "Baking & Starch", and a leaf code like `sauce-cold-sauce-dip` as "Sauce
     * Cold Sauce Dip", which is not the name of anything. It stays as the fallback for a code the
     * tree does not know.
     */
    const categoryName = useMemo(() => {
        const names = new Map(
            list.categoryTree.map((entry) => [entry.code, displayName(entry.name, locale).value]),
        );
        return (code: string): string => names.get(code) ?? humaniseCode(code);
    }, [list.categoryTree, locale]);

    const columns = useMemo(
        () => ingredientColumns({ t, locale, formatter, categoryName }),
        [t, locale, formatter, categoryName],
    );

    const controls = useColumnControls<IngredientAdmin, CatalogueColumn<IngredientAdmin>>(
        list.rows,
        columns.map((column) => ({ ...column, ...columnControl(column.key, list, t, locale) })),
        'kitchen-ingredients',
        {
            sort: {
                key: list.sortKey,
                direction: list.sortDirection,
                onChange: (key, direction) => {
                    if (isIngredientSortKey(key)) list.setSort(key, direction);
                },
            },
        },
    );

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

    /*
     * View takes the whole page rather than a 400px drawer beside it.
     *
     * The record is opened *instead of* the list, not on a route of its own: `list.viewing` already
     * holds the full `IngredientAdmin` the row was drawn from, so this costs no second fetch and no
     * loading state, and Back is a state change rather than a navigation that would drop the list's
     * page, sort and filters on the way out. The cost is that the record is not deep-linkable — see
     * `ingredient-detail.tsx` for what that would take.
     */
    const viewing = list.viewing;
    if (viewing !== null) {
        return (
            <Stack space="md" testID="kitchen-ingredients-screen">
                <IngredientDetail
                    testID="kitchen-ingredients-detail"
                    ingredient={viewing}
                    categoryName={categoryName}
                    onBack={list.closeView}
                    {...(canManage ? { onEdit: () => list.openEditor(String(viewing.id)) } : {})}
                />
            </Stack>
        );
    }

    return (
        <Stack space="md" testID="kitchen-ingredients-screen">
            {/*
             * The opening — the actions and the four figures — is one block at 4px, nested inside
             * the page's 16px rhythm.
             *
             * There is no trail here: `KitchenOpsShell` already draws `Kitchen workspace ›
             * Ingredients` above every kitchen route, and a second one underneath it was two trails
             * to the same page disagreeing about how they got there. With no trail and no title,
             * the header is a right-aligned button row with nothing on its left — so at the page's
             * own 16px it read as two empty bands stacked between the shell's trail and the first
             * thing worth looking at. Tightening the whole page instead would put the cards back on
             * top of the toolbar, which is the complaint that produced the 16px. So the gap that
             * shrinks is the one inside the opening, and the rhythm below it is untouched.
             */}
            <Stack space="xs">
                {list.isPending ? null : (
                    <CatalogueStatCards
                        testID="kitchen-ingredients-stats"
                        cards={statCards(list, t)}
                    />
                )}
            </Stack>

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-ingredients-toolbar"
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:toolbar.searchIngredients')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                // Single-select, so "all" is the absence of a status rather than a status of its own.
                status={segmentValue}
                onStatusChange={(status) => {
                    list.setStatuses(status === 'all' ? [] : [status]);
                }}
            >
                <Inline space="xs" align="center">
                    {canManage ? (
                        <CatalogueTransferActions testID="kitchen-ingredients-toolbar" />
                    ) : null}
                    {canManage ? (
                        <Button
                            testID="kitchen-ingredients-toolbar-create"
                            label={t('kitchen:toolbar.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={list.createNew}
                        />
                    ) : null}
                </Inline>
            </CatalogueToolbar>

            {list.isPending ? (
                <Stack space="xs" testID="kitchen-ingredients-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-ingredients-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : list.failure !== null ? (
                <ErrorState
                    testID="kitchen-ingredients-error"
                    failure={list.failure}
                    onRetry={list.refetch}
                    retrying={list.isFetching}
                />
            ) : list.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-ingredients-empty"
                    title={
                        list.isUnfiltered
                            ? t('kitchen:list.emptyTitle')
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        list.isUnfiltered
                            ? t('kitchen:list.emptyBody')
                            : t('kitchen:list.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-ingredients-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={list.clearFilters}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-ingredients-empty-create"
                                    label={t('kitchen:toolbar.create')}
                                    onPress={list.createNew}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList
                        testID="kitchen-ingredients-table"
                        label={t('kitchen:list.caption')}
                        columns={controls.columns}
                        rows={list.rows}
                        rowKey={(row) => String(row.id)}
                        // Fixed, not switchable: the S/M/L control is gone.
                        density="sm"
                        onRowPress={(row) => {
                            list.openEditor(String(row.id));
                        }}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        // View, Edit, Archive, in the design's order. Above `md` these are three
                        // flat icon buttons on the row; below it the same array becomes the overflow
                        // menu, because a narrow row has space for exactly one control.
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${ingredientRowTestId(row.id)}-view`,
                                onSelect: () => {
                                    list.openView(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:list.open'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${ingredientRowTestId(row.id)}-open`,
                                onSelect: () => {
                                    list.openEditor(String(row.id));
                                },
                            },
                            /*
                             * Archive is *drawn* wherever the reader could plausibly want it and
                             * *enabled* only where the server would accept it.
                             *
                             * It used to be omitted entirely on a row the server would refuse —
                             * every platform-library row, which is most of the 306 — so the action
                             * column held two buttons on some rows and three on others and a reader
                             * had no way to tell whether Archive was missing because this row
                             * cannot be archived or because the feature was not there. Rendering it
                             * disabled answers that: the control is where it always is, and it does
                             * not fire a request the server will 403.
                             *
                             * The permission is still a hard gate, because an action a role cannot
                             * perform at all is not a disabled control, it is somebody else's
                             * button.
                             */
                            ...(canManage
                                ? [
                                      {
                                          key: 'archive',
                                          label: t('kitchen:list.archive'),
                                          icon: CATALOGUE_ROW_ICONS.archive,
                                          tone: 'danger' as const,
                                          disabled:
                                              !row.isEditable || row.meta.status === 'retired',
                                          testID: `${ingredientRowTestId(row.id)}-archive`,
                                          onSelect: () => {
                                              list.askToArchive(row);
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-ingredients-pagination"
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

            <Dialog
                testID="kitchen-ingredients-archive-dialog"
                open={list.archiving !== null}
                onClose={list.cancelArchive}
                title={t('kitchen:editor.archiveTitle')}
                description={t('kitchen:editor.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-ingredients-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={list.cancelArchive}
                        />
                        <Button
                            testID="kitchen-ingredients-archive-confirm"
                            variant="danger"
                            label={t('kitchen:editor.archiveConfirm')}
                            loading={list.isArchivePending}
                            onPress={() => {
                                list.confirmArchive((name) => {
                                    toast.show({
                                        testID: 'kitchen-ingredients-archived-toast',
                                        tone: 'success',
                                        message: t('kitchen:list.archivedToast', { name }),
                                    });
                                });
                            }}
                        />
                    </>
                }
            >
                {list.archiveFailure === null ? null : (
                    <Text testID="kitchen-ingredients-archive-error" tone="danger">
                        {list.archiveFailure.message ?? t('kitchen:list.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/**
 * The four figures the summary line used to state, as cards.
 *
 * `total` is the server's count for the filtered set; Draft, Missing Arabic and Uncosted are
 * counted over the loaded page, which is the only set this screen has. That difference is why Shown
 * reads "18 of 306" rather than claiming the three beside it are catalogue-wide.
 */
function statCards(list: IngredientListState, t: TFunction): readonly CatalogueStatCard[] {
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
            key: 'missingArabic',
            label: t('kitchen:list.statMissingArabic'),
            value: String(list.missingArabicCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:list.statMissingArabicCaption'),
            mark: 'warning',
            tone: list.missingArabicCount === 0 ? 'default' : 'danger',
        },
        {
            key: 'uncosted',
            label: t('kitchen:list.statUncosted'),
            value: String(list.uncostedCount),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:list.statUncostedCaption'),
            mark: 'warning',
            tone: list.uncostedCount === 0 ? 'default' : 'warning',
        },
    ];
}

/**
 * The record, as the read-only panel lists it.
 *
 * The same values the row already carries plus the three the row has no track for — the purchase
 * unit, the composition note and who last touched it. `updatedByName` in particular is here rather
 * than in the list because it is a fact about *a* record, and a 72px Updated column that tried to
 * hold "by Farah Haddad" either truncated a person's name or doubled every row's height.
 *
 * Absent values render the dash rather than being dropped: a panel whose rows change position
 * depending on what is filled in cannot be scanned twice the same way.
 */

/**
 * What one column's header does — handed to `useColumnControls`, which draws it.
 *
 * Sorting and every filter stay on the list hook, and so on the request: `IngredientAdminFilter` is
 * paged, and narrowing the loaded page by unit or price would misreport every page after it. That is
 * why only Status, Category and Allergens filter, and why their state is `external`.
 *
 * Status offers all four, including Archived, which is what makes it fine for the toolbar's segments
 * to name only three. Allergens offers every class the platform declares, not only the ones on the
 * loaded page — the eighteen rows in front of you carry four classes between them, and a menu that
 * offered four would make the other ten look as though nothing declares them.
 */
function columnControl(
    key: string,
    list: IngredientListState,
    t: TFunction,
    locale: string,
): ColumnControl<IngredientAdmin> {
    if (key === 'status') {
        return {
            filter: {
                values: () =>
                    INGREDIENT_STATUS_FILTERS.map((status: PublishableStatus) => ({
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

    if (key === 'allergens') {
        return {
            filter: {
                values: () =>
                    list.allergenClasses.map((entry) => ({
                        key: entry.code,
                        label: displayName(entry.name, locale).value,
                    })),
                external: {
                    value: list.allergen,
                    onChange: (next) => {
                        list.setAllergen(
                            next === null
                                ? null
                                : (list.allergenClasses.find((entry) => entry.code === next)
                                      ?.code ?? null),
                        );
                    },
                },
            },
        };
    }

    if (key === 'category') {
        return {
            filter: {
                // The catalogue's own names now that the tree is on the contract — `humaniseCode`
                // renders `baking-starch` as "Baking Starch" where the category is "Baking & Starch".
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

    return isIngredientSortKey(key) ? { sort: 'external' } : {};
}

function isIngredientSortKey(key: string): key is IngredientSortKey {
    return (
        key === 'reference' ||
        key === 'name' ||
        key === 'category' ||
        key === 'unit' ||
        key === 'unitPrice' ||
        key === 'status' ||
        key === 'updatedAt'
    );
}
