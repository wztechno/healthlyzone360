import {
    Button,
    Cascade,
    Dialog,
    Icon,
    Inline,
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
import { CatalogueListBody } from '../catalogue/catalogue-list-body.tsx';
import { IngredientDetail } from '../catalogue/ingredient-detail.tsx';
import { CatalogueTransferActions } from '../catalogue/catalogue-transfer-actions.tsx';
import { ingredientImportGuide } from '../catalogue/import-guides.ts';
import { LensBar, LensScope } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensToken } from '../catalogue/lens-bar.tsx';
import { statusLensFigures, statusLensMix, statusLensTokens } from '../catalogue/lens-status.ts';
import { listPrintJob, useListPrint } from '../catalogue/list-print.ts';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import {
    INGREDIENT_DEFAULT_COLUMNS,
    INGREDIENT_LOCKED_COLUMNS,
    ingredientColumns,
} from '../catalogue/ingredient-columns.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
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
 * ┌ All │ ● Published ● Draft │ ● Missing Arabic ● Uncosted      Import Export [+ New] ┐
 * ├▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆┤
 * └ [Category All ▾] [ ⌕ Search ingredients ] [Status: Draft ×]   18 of 306  Clear │ ⫴ ┘
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
 * **The status figures are filters.** All, Published and Draft set the status; Missing Arabic and
 * Uncosted are read-only because `IngredientAdminFilter` carries no parameter for either.
 *
 * **Import is drawn and disabled.** There is no import route and no import endpoint — the library
 * arrives through the seeder — so the button holds its place with the reason on it rather than
 * shipping one that 404s.
 *
 * ## How the page arrives
 *
 * The way every admin page arrives, and the page it was worked out on.
 *
 * 1. **The page enters.** The root is a `Cascade`: the three bands — cards, toolbar, list — each
 *    rise 8dp and fade in, 40ms apart, so the eye reads down the page the way it will be used.
 * 2. **Nothing moves while it loads.** The cards are drawn in full with a placeholder where each
 *    figure goes, and the list is `TableSkeleton` in the table's own frame. Both are their loaded
 *    height, so the data landing moves nothing on the page.
 * 3. **The data lands.** The figures fade in inside their cards and the rows cascade into the
 *    frame (`CatalogueList` does this for every list). A later page of the pager cascades the same
 *    way; a re-sort does not, because a row that is already on the page has already arrived.
 *
 * Every step is `useMotion`'s: under reduced motion the page is drawn in its final place on the
 * first frame, and no step can leave a band invisible.
 */
export function IngredientsScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredients"
        >
            <IngredientsList view={view} />
        </Gate>
    );
}

function IngredientsList({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const list = useIngredientList(view);
    const print = useListPrint();

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
        columns.map((column) => ({
            ...column,
            ...columnControl(column.key, list, t, locale),
        })),
        'kitchen-ingredients',
        {
            sort: {
                key: list.sortKey,
                direction: list.sortDirection,
                onChange: (key, direction) => {
                    if (isIngredientSortKey(key)) list.setSort(key, direction);
                },
            },
            // Every field is a column; the reader keeps up to six of them.
            picker: { defaults: INGREDIENT_DEFAULT_COLUMNS, locked: INGREDIENT_LOCKED_COLUMNS },
        },
    );

    /*
     * View takes the whole page rather than a 400px drawer beside it.
     *
     * The record is opened *instead of* the list, not on a route of its own: `list.viewing` already
     * holds the full `IngredientAdmin` the row was drawn from, so this costs no second fetch and no
     * loading state, and Back is a state change rather than a navigation that would drop the list's
     * page, sort and filters on the way out. It is still an address — `?view=` names it, so the
     * editor it opens comes back to it (`use-viewed-record.ts`).
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
        <Cascade space="md" testID="kitchen-ingredients-screen">
            {/*
             * The Lens bar — the figures, the mix, the query row and the actions as one object
             * directly over the list it narrows (`lens-bar.tsx`). It replaced four stat cards and
             * the toolbar under them.
             */}
            <LensBar
                testID="kitchen-ingredients-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(list, t)}
                {...statusLensMix(list, t)}
                scope={
                    <LensScope<string>
                        testID="kitchen-ingredients-category"
                        label={t('kitchen:toolbar.categoryLabel')}
                        value={list.category ?? ALL_SCOPE}
                        onChange={(next) => {
                            list.setCategory(next === ALL_SCOPE ? null : next);
                        }}
                        options={[
                            { value: ALL_SCOPE, label: t('kitchen:toolbar.statusAll') },
                            ...list.categories.map((entry) => ({
                                value: entry.code,
                                label: categoryName(entry.code),
                            })),
                        ]}
                    />
                }
                search={list.query}
                onSearchChange={list.setQuery}
                // A camera read goes into the search box: the server matches a code there as well
                // as a name, which is also how a keyboard-wedge scan already works.
                onScan={(scan) => {
                    list.setQuery(scan.data);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:toolbar.searchIngredients')}
                tokens={lensTokens(list, t, locale)}
                result={
                    list.total === null
                        ? null
                        : t('kitchen:lens.result', { shown: list.shown, total: list.total })
                }
                clearLabel={t('kitchen:lens.clear')}
                // The category is the scope the reader stands in, so Clear leaves it.
                {...(list.trimmed === '' && list.statuses.length === 0 && list.allergen === null
                    ? {}
                    : {
                          onClear: () => {
                              list.setQuery('');
                              list.setStatuses([]);
                              list.setAllergen(null);
                          },
                      })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    <Inline space="xs" align="center">
                        {canManage ? (
                            <CatalogueTransferActions
                                testID="kitchen-ingredients-toolbar"
                                importGuide={ingredientImportGuide(
                                    list.categories.map((entry) => entry.code),
                                )}
                                exportMenu={{
                                    excel: {
                                        load: (repositories) =>
                                            repositories.kitchenAdmin.exportIngredients(
                                                list.filter,
                                            ),
                                        fallbackName: 'ingredients.xlsx',
                                    },
                                    pdf: [
                                        {
                                            key: 'pdf',
                                            label: t('kitchen:transfer.export.pdf'),
                                            disabled: list.countsPending,
                                            onSelect: () => {
                                                print.start(
                                                    listPrintJob({
                                                        resource: 'ingredients',
                                                        title: t(
                                                            'kitchen:transfer.ingredients.printTitle',
                                                        ),
                                                        columns: controls.columns,
                                                        rows: list.everyRow,
                                                        // The whole-set read drops the sort, so it is
                                                        // put back here, by every column the header
                                                        // could have sorted on.
                                                        sort: {
                                                            key: list.sortKey,
                                                            direction: list.sortDirection,
                                                            from: columns,
                                                        },
                                                    }),
                                                );
                                            },
                                        },
                                    ],
                                }}
                            />
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
                }
            />

            <CatalogueListBody
                testID="kitchen-ingredients"
                list={list}
                empty={{
                    title: t('kitchen:list.emptyTitle'),
                    body: t('kitchen:list.emptyBody'),
                }}
                filteredEmpty={{
                    title: t('kitchen:list.filteredEmptyTitle'),
                    body: t('kitchen:list.filteredEmptyBody'),
                }}
                create={
                    canManage
                        ? { label: t('kitchen:toolbar.create'), onPress: list.createNew }
                        : undefined
                }
            >
                <CatalogueList
                    testID="kitchen-ingredients-table"
                    label={t('kitchen:list.caption')}
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
                            label: t('kitchen:catalogue.edit'),
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
                                      disabled: !row.isEditable || row.meta.status === 'retired',
                                      testID: `${ingredientRowTestId(row.id)}-archive`,
                                      onSelect: () => {
                                          list.askToArchive(row);
                                      },
                                  },
                              ]
                            : []),
                    ]}
                />
            </CatalogueListBody>

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
        </Cascade>
    );
}

/** The Category picker's "every category" — a value no category code can take. */
const ALL_SCOPE = '*';

/**
 * The Lens bar's figures: All · Published · Draft, then the two that block publishing.
 *
 * Missing Arabic and Uncosted are read-only: `IngredientAdminFilter` carries no parameter for
 * either, and a figure that looked pressable and did nothing would be worse than one that plainly
 * does not. They count the rows the list shows — the status included — like the cards did.
 */
function lensFigures(list: IngredientListState, t: TFunction): readonly LensFigure[] {
    const counted = (count: number) => (list.countsPending ? null : count);
    return [
        ...statusLensFigures(list, t, {
            allLabel: t('kitchen:lens.allIngredients'),
            review: false,
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
            key: 'uncosted',
            label: t('kitchen:list.statUncosted'),
            value: counted(list.uncostedCount),
            tone: 'warning',
        },
    ];
}

/** The filters in force besides the search and the category — each one removable on its own. */
function lensTokens(list: IngredientListState, t: TFunction, locale: string): readonly LensToken[] {
    const allergen =
        list.allergen === null
            ? undefined
            : list.allergenClasses.find((entry) => entry.code === list.allergen);
    const allergenLabel =
        list.allergen === null
            ? null
            : t('kitchen:lens.token', {
                  label: t('kitchen:recipes.columnAllergens'),
                  value:
                      allergen === undefined
                          ? list.allergen
                          : displayName(allergen.name, locale).value,
              });

    return [
        ...statusLensTokens(list, t),
        ...(allergenLabel === null
            ? []
            : [
                  {
                      key: 'allergen',
                      label: allergenLabel,
                      removeLabel: t('kitchen:toolbar.removeFilter', { filter: allergenLabel }),
                      onRemove: () => {
                          list.setAllergen(null);
                      },
                  },
              ]),
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
            sort: 'external',
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
            sort: 'external',
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
