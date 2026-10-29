import type { AllergenClass } from '@healthy360/api-client/contracts';
import {
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Inline,
    TableSkeleton,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import {
    allergenColumns,
    allergenRowTestId,
    thresholdLabel,
} from '../catalogue/allergen-columns.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { ColumnControl } from '../catalogue/use-column-controls.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensToken } from '../catalogue/lens-bar.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import type { CatalogueViewField } from '../catalogue/record-view-page.tsx';
import type { AllergenListState } from '../catalogue/use-allergen-list.ts';
import { NO_MARKET, useAllergenList } from '../catalogue/use-allergen-list.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { useListMemory, useRememberedOpened } from '../list-memory.ts';

/**
 * `/kitchen/allergen-classes` — the fourteen regulatory classes, read only.
 *
 * ```
 * Kitchen workspace › Allergen classes            <- drawn by the shell, not here
 * (All classes 14) │ ● Active 13  ● Withdrawn 1 │ ● Severe  ● With a threshold
 * [ ⌕ Search ] [Markets: GCC ×]                                     9 of 14  Clear │ ▤
 * ID  CLASS  REGULATION  DECLARABLE IN  THRESHOLD  STATUS  ⋯
 * ```
 *
 * ## It is a Catalogue list, drawn like one
 *
 * It was the last kitchen list that was not. It opened with `KitchenPageHeader` — a 24px title and a
 * subtitle, the chrome every *other* kitchen route uses — and drew the design system's `Table`,
 * which is a different component from `DataList` with its own header ramp, its own row height and
 * its own column model. A kitchen that had learnt to read six catalogue lists arrived here and met
 * a seventh layout for the same job.
 *
 * It now takes the same parts in the same order as Ingredients, Packaging, Recipes, Resale and
 * Meals: the compact header, the Lens bar, the fitted list with sort-and-filter
 * column headers, and the View panel. Which means the eight or nine decisions those screens have
 * accumulated — the equal share of leftover width, the sort arrow on every sortable header, the row
 * that floors rather than clips, the centred figures — arrive here for free, and the next one will
 * too.
 *
 * ## What it still does *not* have, and why
 *
 * **No Import or Export.** Excluded by request, and it is the right exclusion: this is a platform
 * vocabulary a kitchen does not own, so there is nothing here to import and nothing that would mean
 * anything exported.
 *
 * **No primary action, and no Edit on a row.** An allergen code is an immutable regulatory identity
 * (plan §4.6, decision D-041). The platform owns the display names, the market applicability, the
 * thresholds and the deactivation switch; a kitchen owns only its *mappings* onto these codes, and
 * `KitchenAdminRepository.listAllergenClasses()` has no writer. A greyed-out New or Edit would be a
 * claim about the interface that is not true — which is a different case from the disabled Import
 * on the other lists, where the feature is coming and simply is not here yet.
 *
 * **No pager.** The resource is not paged: it returns all fourteen, always. A pager under a
 * fourteen-row list would be a control with one page to offer.
 *
 * The governance banner that explained why there are no controls is gone (the team's no-helper-copy
 * rule): the page is read-only and draws no control to explain away.
 *
 * ## The row opens a View panel
 *
 * The one row action, and it is read-only. It also closes a real accessibility hole: the page had no
 * focusable content at all inside its scrolling region, which Safari makes unreachable by keyboard
 * and axe reports as a serious `scrollable-region-focusable` violation. A back button was standing
 * in for that; a pressable row and a real panel answer it properly, and carry the description and
 * the full withdrawal wording that no 160px track could hold.
 */
export function AllergenClassesScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-allergen-classes"
        >
            <AllergenClasses view={view} />
        </Gate>
    );
}

function AllergenClasses({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const list = useAllergenList(view);
    // The class last opened and the page survive leaving the list. The filters are the list
    // hook's own state.
    const memory = useListMemory('kitchen.allergen-classes');
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);
    const openView = (entry: AllergenClass) => {
        rememberOpened(String(entry.code));
        list.openView(entry);
    };

    const columns = useMemo(
        () => allergenColumns({ t, locale, formatter }),
        [t, locale, formatter],
    );

    const controls = useColumnControls<AllergenClass, CatalogueColumn<AllergenClass>>(
        list.rows,
        columns.map((column) => ({ ...column, ...columnControl(column.key, list, t) })),
        'kitchen-allergen-classes',
        {
            sort: {
                key: list.sortKey,
                direction: list.sortDirection,
                onChange: (key, direction) => {
                    if (isAllergenClassSortKey(key)) list.setSort(key, direction);
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
                testID="kitchen-allergen-classes-view"
                kind={t('kitchen:classes.viewKind')}
                reference={String(viewing.code)}
                title={displayName(viewing.name, locale).value}
                status={{
                    tone: viewing.isActive ? 'brand' : 'warning',
                    label: viewing.isActive
                        ? t('kitchen:classes.active')
                        : t('kitchen:classes.withdrawn'),
                }}
                fields={viewFields(viewing, t, formatter, locale)}
                onBack={list.closeView}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-allergen-classes-screen">
            {/*
             * The Lens bar — figures, mix and query row as one object directly over the list it
             * narrows (`lens-bar.tsx`). No actions: allergen classes are the platform's to govern.
             */}
            <LensBar
                testID="kitchen-allergen-classes-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(list, t)}
                mix={[
                    {
                        key: 'active',
                        value: list.total - list.withdrawnCount,
                        tone: 'success',
                        dimmed: list.status === 'withdrawn',
                    },
                    {
                        key: 'withdrawn',
                        value: list.withdrawnCount,
                        tone: 'warning',
                        dimmed: list.status === 'active',
                    },
                ]}
                mixLabel={t('kitchen:lens.allergenMix', {
                    active: list.total - list.withdrawnCount,
                    withdrawn: list.withdrawnCount,
                })}
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:classes.searchPlaceholder')}
                tokens={lensTokens(list, t)}
                result={
                    list.isPending
                        ? null
                        : t('kitchen:lens.result', { shown: list.shown, total: list.total })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(list.isUnfiltered ? {} : { onClear: list.clearFilters })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
            />

            {list.isPending ? (
                <TableSkeleton
                    testID="kitchen-allergen-classes-loading"
                    partTestID="kitchen-allergen-classes"
                />
            ) : list.failure !== null ? (
                <ErrorState
                    testID="kitchen-allergen-classes-error"
                    failure={list.failure}
                    title={t('kitchen:classes.errorTitle')}
                    onRetry={list.refetch}
                    retrying={list.isFetching}
                />
            ) : list.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-allergen-classes-empty"
                    title={
                        list.isUnfiltered
                            ? t('kitchen:classes.emptyTitle')
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        list.isUnfiltered
                            ? t('kitchen:classes.emptyBody')
                            : t('kitchen:list.filteredEmptyBody')
                    }
                    actions={
                        list.isUnfiltered ? undefined : (
                            <Inline space="sm" wrap>
                                <Button
                                    testID="kitchen-allergen-classes-clear"
                                    variant="secondary"
                                    label={t('kitchen:toolbar.clearFilters')}
                                    onPress={list.clearFilters}
                                />
                            </Inline>
                        )
                    }
                />
            ) : (
                <CatalogueList
                    testID="kitchen-allergen-classes-table"
                    label={t('kitchen:classes.title')}
                    columns={controls.columns}
                    rows={list.rows}
                    rowKey={(entry) => String(entry.code)}
                    density="sm"
                    highlightedId={lastOpenedId}
                    initialPage={memory.initial.page}
                    onPageChange={(page) => {
                        memory.remember({ page });
                    }}
                    onRowPress={openView}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    // One action, and it is the only one this record can offer — see the note above
                    // on why there is no Edit.
                    rowActions={(entry): readonly MenuItem[] => [
                        {
                            key: 'view',
                            label: t('kitchen:list.view'),
                            icon: CATALOGUE_ROW_ICONS.view,
                            testID: `${allergenRowTestId(String(entry.code))}-view`,
                            onSelect: () => {
                                openView(entry);
                            },
                        },
                    ]}
                />
            )}
        </Cascade>
    );
}

/**
 * The Lens bar's figures: All · Active · Withdrawn — the `isActive` split, which is this record's
 * whole lifecycle — then Severe and With a threshold. Those two are read-only: `severeByDefault`
 * and `declarationThreshold` are not filters this screen offers. Every figure counts all fourteen.
 */
function lensFigures(list: AllergenListState, t: TFunction): readonly LensFigure[] {
    const counted = (count: number) => (list.isPending ? null : count);
    return [
        {
            key: 'all',
            label: t('kitchen:lens.allAllergenClasses'),
            value: counted(list.total),
            active: list.status === 'all',
            onPress: () => {
                list.setStatus('all');
            },
            accessibilityLabel: t('kitchen:lens.allAction'),
        },
        {
            key: 'active',
            label: t('kitchen:classes.active'),
            value: counted(list.total - list.withdrawnCount),
            tone: 'success',
            separated: true,
            active: list.status === 'active',
            onPress: () => {
                list.setStatus('active');
            },
            accessibilityLabel: t('kitchen:lens.activeAction'),
        },
        {
            key: 'withdrawn',
            label: t('kitchen:classes.withdrawn'),
            value: counted(list.withdrawnCount),
            tone: 'warning',
            active: list.status === 'withdrawn',
            onPress: () => {
                list.setStatus('withdrawn');
            },
            accessibilityLabel: t('kitchen:classes.statWithdrawnAction'),
        },
        {
            // Danger for the dot only: a severe class is a fact about the allergen, not work that
            // is blocked, so it does not take the alarm ink.
            key: 'severe',
            label: t('kitchen:classes.statSevere'),
            value: counted(list.severeCount),
            tone: 'danger',
            separated: true,
        },
        {
            key: 'threshold',
            label: t('kitchen:classes.statThreshold'),
            value: counted(list.thresholdCount),
            tone: 'info',
        },
    ];
}

/** The status and the market in force, as removable tokens. */
function lensTokens(list: AllergenListState, t: TFunction): readonly LensToken[] {
    const token = (key: string, label: string, value: string, onRemove: () => void): LensToken => {
        const text = t('kitchen:lens.token', { label, value });
        return {
            key,
            label: text,
            removeLabel: t('kitchen:toolbar.removeFilter', { filter: text }),
            onRemove,
        };
    };
    return [
        ...(list.status === 'all'
            ? []
            : [
                  token(
                      'status',
                      t('kitchen:toolbar.statusLabel'),
                      list.status === 'active'
                          ? t('kitchen:classes.active')
                          : t('kitchen:classes.withdrawn'),
                      () => {
                          list.setStatus('all');
                      },
                  ),
              ]),
        ...(list.market === null
            ? []
            : [
                  token(
                      'market',
                      t('kitchen:classes.columnMarkets'),
                      list.market === NO_MARKET ? t('kitchen:classes.noMarkets') : list.market,
                      () => {
                          list.setMarket(null);
                      },
                  ),
              ]),
    ];
}

/** The panel's field list — the row's own values, plus the two no track could hold. */
function viewFields(
    entry: AllergenClass,
    t: TFunction,
    formatter: Formatter,
    locale: string,
): readonly CatalogueViewField[] {
    return [
        {
            key: 'description',
            label: t('kitchen:classes.columnExamples'),
            value: displayName(entry.description, locale).value,
        },
        {
            key: 'regulation',
            label: t('kitchen:classes.columnReference'),
            value: entry.regulatoryReference,
        },
        {
            key: 'markets',
            label: t('kitchen:classes.columnMarkets'),
            value:
                entry.markets.length === 0
                    ? t('kitchen:classes.noMarkets')
                    : entry.markets.join(', '),
        },
        {
            key: 'threshold',
            label: t('kitchen:classes.columnThreshold'),
            value: thresholdLabel(entry, t, formatter),
        },
        {
            key: 'severe',
            label: t('kitchen:classes.statSevere'),
            // The full sentence, which the row's badge can only abbreviate to one word.
            value: entry.severeByDefault
                ? t('kitchen:classes.severe')
                : t('kitchen:classes.severeNot'),
        },
        {
            key: 'status',
            label: t('kitchen:list.columnStatus'),
            // Same: the row says "Withdrawn", and this says what being withdrawn means for a label
            // already printed.
            value: entry.isActive ? t('kitchen:classes.active') : t('kitchen:classes.inactive'),
        },
    ];
}

/**
 * What one column's header does — handed to `useColumnControls`, which draws it.
 *
 * Every column but Markets sorts. Status sorts rather than filters: the one lifecycle cut, Active /
 * Withdrawn, is on the toolbar where a reader meets it first, and a Status menu offering the same
 * two would be that control drawn twice.
 *
 * Markets filters — a class belongs to several markets, so there is no order to put them in, and
 * "what does the GCC require" is the question the column is asked. The request carries no market
 * parameter, and does not need one: the resource is all fourteen classes, unpaged, so the list hook
 * narrows the whole answer rather than a page of it, and Shown stays a true count.
 */
function columnControl(
    key: string,
    list: AllergenListState,
    t: TFunction,
): ColumnControl<AllergenClass> {
    if (key === 'markets') {
        return {
            filter: {
                values: () => [
                    ...list.markets.map((market) => ({ key: market, label: market })),
                    ...(list.hasUnmarketed
                        ? [{ key: NO_MARKET, label: t('kitchen:classes.noMarkets') }]
                        : []),
                ],
                external: { value: list.market, onChange: list.setMarket },
            },
        };
    }
    return isAllergenClassSortKey(key) ? { sort: 'external' } : {};
}

function isAllergenClassSortKey(key: string): key is AllergenListState['sortKey'] {
    return (
        key === 'code' ||
        key === 'name' ||
        key === 'regulation' ||
        key === 'threshold' ||
        key === 'status'
    );
}
