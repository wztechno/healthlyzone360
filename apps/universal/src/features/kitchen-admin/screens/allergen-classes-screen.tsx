import type { AllergenClass } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    EmptyState,
    ErrorState,
    Inline,
    Skeleton,
    Stack,
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
import { CatalogueColumnHeader } from '../catalogue/catalogue-column-header.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { CatalogueViewDrawer } from '../catalogue/catalogue-view-drawer.tsx';
import type { CatalogueViewField } from '../catalogue/catalogue-view-drawer.tsx';
import type { AllergenListState, AllergenStatusFilter } from '../catalogue/use-allergen-list.ts';
import { useAllergenList } from '../catalogue/use-allergen-list.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';

/**
 * `/kitchen/allergen-classes` — the fourteen regulatory classes, read only.
 *
 * ```
 * Kitchen workspace › Allergen classes            <- drawn by the shell, not here
 * ┌ SHOWN ┐ ┌ SEVERE ┐ ┌ WITHDRAWN ┐ ┌ WITH A THRESHOLD ┐
 *          [ ⌕ 240px ]  [ All | Active | Withdrawn ]
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
 * Meals: the compact header, the stat row, the one-row toolbar, the fitted list with sort-and-filter
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
 * The governance rule that used to be the page's only explanation is still stated, as the Callout
 * under the stat row — it is the reason there are no controls, and a reader who wonders why should
 * not have to infer it from their absence.
 *
 * ## The row opens a View panel
 *
 * The one row action, and it is read-only. It also closes a real accessibility hole: the page had no
 * focusable content at all inside its scrolling region, which Safari makes unreachable by keyboard
 * and axe reports as a serious `scrollable-region-focusable` violation. A back button was standing
 * in for that; a pressable row and a real panel answer it properly, and carry the description and
 * the full withdrawal wording that no 160px track could hold.
 */
export function AllergenClassesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-allergen-classes"
        >
            <AllergenClasses />
        </Gate>
    );
}

/** All · Active · Withdrawn — the `isActive` split, which is this record's whole lifecycle. */
const SEGMENTS: readonly AllergenStatusFilter[] = ['all', 'active', 'withdrawn'];

function AllergenClasses() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const list = useAllergenList();

    const columns = useMemo(
        () => allergenColumns({ t, locale, formatter }),
        [t, locale, formatter],
    );

    const withHeaders = columns.map((column) => ({
        ...column,
        renderHeader: headerMenu(column, list),
    }));

    const statusSegments: readonly CatalogueStatusSegment<AllergenStatusFilter>[] = SEGMENTS.map(
        (value) => ({
            value,
            label:
                value === 'all'
                    ? t('kitchen:toolbar.statusAll')
                    : value === 'active'
                      ? t('kitchen:classes.active')
                      : t('kitchen:classes.withdrawn'),
        }),
    );

    return (
        <Stack space="md" testID="kitchen-allergen-classes-screen">
            {/*
             * No header row. This list has no actions at all - allergen classes are the platform's
             * to govern, which the notice below says in words - so the header was an empty box
             * holding the cards apart from nothing.
             */}
            {list.isPending ? null : (
                <CatalogueStatCards
                    testID="kitchen-allergen-classes-stats"
                    cards={statCards(list, t)}
                />
            )}

            <Callout
                testID="kitchen-allergen-classes-governance"
                role="note"
                tone="info"
                title={t('kitchen:classes.governanceTitle')}
                body={t('kitchen:classes.governanceBody')}
            />

            <CatalogueToolbar<AllergenStatusFilter>
                testID="kitchen-allergen-classes-toolbar"
                search={list.query}
                onSearchChange={list.setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:classes.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={list.status}
                onStatusChange={list.setStatus}
            />

            {list.isPending ? (
                <Stack space="xs" testID="kitchen-allergen-classes-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-allergen-classes-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
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
                    columns={withHeaders}
                    rows={list.rows}
                    rowKey={(entry) => String(entry.code)}
                    density="sm"
                    onRowPress={list.openView}
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
                                list.openView(entry);
                            },
                        },
                    ]}
                />
            )}

            <CatalogueViewDrawer
                testID="kitchen-allergen-classes-view"
                open={list.viewing !== null}
                onClose={list.closeView}
                kindLabel={t('kitchen:classes.viewKind')}
                fieldsLabel={t('kitchen:list.viewFields')}
                closeLabel={t('kitchen:catalogue.close')}
                {...(list.viewing === null
                    ? { title: '' }
                    : {
                          reference: String(list.viewing.code),
                          title: displayName(list.viewing.name, locale).value,
                          status: (
                              <Badge
                                  testID="kitchen-allergen-classes-view-status"
                                  tone={list.viewing.isActive ? 'brand' : 'warning'}
                                  icon={list.viewing.isActive ? null : undefined}
                                  label={
                                      list.viewing.isActive
                                          ? t('kitchen:classes.active')
                                          : t('kitchen:classes.withdrawn')
                                  }
                              />
                          ),
                      })}
                fields={list.viewing === null ? [] : viewFields(list.viewing, t, formatter, locale)}
            />
        </Stack>
    );
}

/**
 * The four figures the page opens with.
 *
 * Two are filters and two are not, which is the rule {@link CatalogueStatCards} states: Shown clears
 * every constraint and Withdrawn narrows to the deactivated classes, because both are cuts this list
 * can actually make. Severe and With a threshold are read-only — `severeByDefault` and
 * `declarationThreshold` are not filters this screen offers, and a card that looked pressable and
 * then did nothing would be worse than one that does not.
 */
function statCards(list: AllergenListState, t: TFunction): readonly CatalogueStatCard[] {
    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(list.shown),
            unit: t('kitchen:list.statShownUnit', { total: list.total }),
            caption: list.isUnfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: list.clearFilters,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'severe',
            label: t('kitchen:classes.statSevere'),
            value: String(list.severeCount),
            unit: t('kitchen:classes.statUnit'),
            caption: t('kitchen:classes.statSevereCaption'),
            mark: 'warning',
            tone: 'danger',
        },
        {
            key: 'withdrawn',
            label: t('kitchen:classes.withdrawn'),
            value: String(list.withdrawnCount),
            unit: t('kitchen:classes.statUnit'),
            caption: t('kitchen:classes.statWithdrawnCaption'),
            mark: 'eyeOff',
            tone: 'warning',
            onPress: () => {
                list.setStatus(list.status === 'withdrawn' ? 'all' : 'withdrawn');
            },
            accessibilityLabel: t('kitchen:classes.statWithdrawnAction'),
        },
        {
            key: 'threshold',
            label: t('kitchen:classes.statThreshold'),
            value: String(list.thresholdCount),
            unit: t('kitchen:classes.statUnit'),
            caption: t('kitchen:classes.statThresholdCaption'),
            mark: 'info',
        },
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
 * The header control for one column — §4.3's sort menu.
 *
 * Sort only: none of these columns carries a filter of its own. The one cut this list makes is
 * Active / Withdrawn, and that is on the toolbar's segments where a reader meets it first; a Status
 * column menu offering the same two values would be the same control drawn twice, sixteen pixels
 * apart. Markets would be a genuine second cut, and it is not offered because the request carries no
 * market parameter — the same reason the ingredient list's Unit column still has no filter.
 */
function headerMenu(
    column: CatalogueColumn<AllergenClass>,
    list: AllergenListState,
): (() => React.ReactNode) | undefined {
    const sortKey = sortKeyFor(column.key);
    if (sortKey === null) return undefined;

    const active = list.sortKey === sortKey;

    /*
     * Every column here sorts and none of them filter, so the press is the sort - see
     * `onToggleSort`. This list never had a value list to put in a menu, which makes it the
     * simplest case: no `sections`, no panel, and the header is one press target throughout.
     */
    return () => (
        <CatalogueColumnHeader
            label={column.label}
            align={column.align}
            sections={[]}
            onToggleSort={() => {
                list.setSort(sortKey, active && list.sortDirection === 'asc' ? 'desc' : 'asc');
            }}
            sortDirection={active ? list.sortDirection : null}
            testID={`kitchen-allergen-classes-column-${column.key}`}
        />
    );
}

/** The sort this list understands for a column, or `null` where there is none. */
function sortKeyFor(key: string): AllergenListState['sortKey'] | null {
    if (
        key === 'code' ||
        key === 'name' ||
        key === 'regulation' ||
        key === 'threshold' ||
        key === 'status'
    ) {
        return key;
    }
    return null;
}
