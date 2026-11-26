import {
    Button,
    Callout,
    Cascade,
    Checkbox,
    DATA_TABLE_ROW_ICONS,
    DataTable,
    EmptyState,
    ErrorState,
    Icon,
    TableSkeleton,
} from '@healthy360/design-system';
import type { DataTableColumn, MenuItem } from '@healthy360/design-system';
import type { CatalogueItem, CatalogueItemKind } from '@healthy360/api-client/contracts';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure, useCorporateCatalogueQuery } from '../../../data/business-hooks.ts';
import { ColumnPicker } from '../../kitchen-admin/catalogue/column-picker.tsx';
import { LensBar } from '../../kitchen-admin/catalogue/lens-bar.tsx';
import type { LensFigure, LensTone } from '../../kitchen-admin/catalogue/lens-bar.tsx';
import { useColumnControls } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import { catalogueColumns } from '../catalogue-columns.tsx';
import { CORPORATE_HOME_HREF, CORPORATE_NEW_QUOTATION_HREF } from '../corporate-chrome.tsx';
import { PickedLinesBar } from '../corporate-parts.tsx';

/**
 * `/corporate/catalogue/{programme}` — the negotiated lines for one programme, priced. From the
 * corporate canvas's Catalogue board (2026-11-10), in the kitchen's list look:
 *
 * - **The lens:** the figures All lines / Meals / Bulk packages (a figure is the kind filter), New
 *   quotation at their end, then search, the filter in force, "N of M" and Show columns.
 * - **The table:** a pick box, then Item, Kind, Pack and Contract price. A row opens the line; its
 *   menu has View and Ask for a price.
 * - **Picked lines** gather in the dark bar at the foot, whose one action asks for a price on all
 *   of them at once.
 *
 * There is no basket. A corporate buyer cannot buy here: they ask for a price, and accepting the
 * priced quotation is what places the order.
 *
 * ## This is one of the screens allowed to show a contract price
 *
 * Every figure carries the `contract-price-` marker (`../format.ts`) — the price column's cell
 * renders it (`../catalogue-columns.tsx`).
 *
 * ## The catalogue is scoped to a programme because the contract scopes it
 *
 * `CatalogueFilter` requires a `programmeId`. There is no cross-programme listing and this screen
 * does not simulate one.
 */

export interface CorporateCatalogueScreenProps {
    readonly programmeId: string | undefined;
}

type KindFilter = 'all' | CatalogueItemKind;

/** The figures in the board's order; a plan figure appears only when the programme has plans. */
const KIND_FIGURES: readonly { readonly kind: KindFilter; readonly tone?: LensTone }[] = [
    { kind: 'all' },
    { kind: 'meal', tone: 'brand' },
    { kind: 'bulk_package', tone: 'info' },
    { kind: 'meal_plan', tone: 'neutral' },
];

/** The builder, seeded with the lines asked about. */
export function quotationBuilderHref(
    programmeId: string,
    itemIds: readonly string[] = [],
    quantity?: number,
): string {
    const items = itemIds.length === 0 ? '' : `&items=${itemIds.map(encodeURIComponent).join(',')}`;
    const qty = quantity === undefined ? '' : `&qty=${String(quantity)}`;
    return `${CORPORATE_NEW_QUOTATION_HREF}?programme=${encodeURIComponent(programmeId)}${items}${qty}`;
}

/** A catalogue line's own address, carrying its programme so the page behind it can be drawn. */
export function catalogueLineHref(programmeId: string, itemId: string): string {
    return `/corporate/items/${encodeURIComponent(itemId)}?programme=${encodeURIComponent(programmeId)}`;
}

export function CorporateCatalogueScreen({ programmeId }: CorporateCatalogueScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);

    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<KindFilter>('all');
    const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

    const catalogue = useCorporateCatalogueQuery(parsed === null ? null : { programmeId: parsed });
    const all = useMemo<readonly CatalogueItem[]>(
        () => catalogue.data?.items ?? [],
        [catalogue.data],
    );
    const items = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return all.filter(
            (item) =>
                (kind === 'all' || item.kind === kind) &&
                (needle === '' ||
                    `${item.name} ${item.description}`.toLowerCase().includes(needle)),
        );
    }, [all, kind, query]);

    const togglePick = (id: string, next: boolean) => {
        setPicked((current) => {
            const copy = new Set(current);
            if (next) copy.add(id);
            else copy.delete(id);
            return copy;
        });
    };
    const shownPicked = items.filter((item) => picked.has(item.id));

    const pickColumn: ControlledColumn<CatalogueItem, DataTableColumn<CatalogueItem>> = {
        key: 'pick',
        label: t('business:picked.pickAll'),
        width: 40,
        priority: 99,
        grow: false,
        sort: false,
        value: () => '',
        renderHeader: () => (
            <Checkbox
                labelHidden
                testID="corporate-catalogue-pick-all"
                label={t('business:picked.pickAll')}
                checked={items.length > 0 && shownPicked.length === items.length}
                mixed={shownPicked.length > 0 && shownPicked.length < items.length}
                onChange={(next) => {
                    setPicked((current) => {
                        const copy = new Set(current);
                        for (const item of items) {
                            if (next) copy.add(item.id);
                            else copy.delete(item.id);
                        }
                        return copy;
                    });
                }}
            />
        ),
        render: (item) => (
            <Checkbox
                labelHidden
                testID={`catalogue-item-${item.id}-pick`}
                label={t('business:picked.pickOne', { name: item.name })}
                checked={picked.has(item.id)}
                onChange={(next) => {
                    togglePick(item.id, next);
                }}
            />
        ),
    };

    const columns = [pickColumn, ...catalogueColumns(t, formatter)];
    const controls = useColumnControls(items, columns, 'corporate-catalogue', {
        picker: {
            defaults: ['pick', 'name', 'kind', 'pack', 'price'],
            locked: ['pick', 'name'],
        },
    });

    if (parsed === null) {
        return (
            <Cascade space="md" testID="corporate-catalogue-screen">
                <Callout
                    testID="corporate-catalogue-not-found"
                    role="alert"
                    tone="warning"
                    icon="warning"
                    title={t('business:catalogue.notFoundTitle')}
                    body={t('business:catalogue.notFoundBody')}
                    actions={
                        <Button
                            testID="corporate-catalogue-back"
                            size="sm"
                            variant="secondary"
                            label={t('business:catalogue.back')}
                            onPress={() => {
                                router.push(CORPORATE_HOME_HREF as never);
                            }}
                        />
                    }
                />
            </Cascade>
        );
    }

    const programme = String(parsed);
    const pending = catalogue.isPending;
    const listFailure = toFailure(catalogue.error);
    const unfiltered = query === '' && kind === 'all' && !controls.filtered;
    const clearFilters = () => {
        setQuery('');
        setKind('all');
        controls.clearFilters();
    };
    const count = (value: KindFilter) =>
        value === 'all' ? all.length : all.filter((item) => item.kind === value).length;

    const figures = KIND_FIGURES.filter(
        (figure) => figure.kind !== 'meal_plan' || count('meal_plan') > 0,
    ).map((figure, index): LensFigure => ({
        key: figure.kind,
        label:
            figure.kind === 'all'
                ? t('business:catalogue.figureAll')
                : t(`business:builder.kindPlural.${figure.kind}`),
        value: pending ? null : count(figure.kind),
        ...(figure.tone === undefined ? {} : { tone: figure.tone }),
        separated: index === 1,
        active: kind === figure.kind,
        onPress: () => {
            setKind(figure.kind);
        },
    }));
    const kindToken =
        kind === 'all'
            ? null
            : t('business:catalogue.kindToken', {
                  kind: t(`business:builder.kindPlural.${kind}`),
              });
    const joined = !pending && listFailure === null && controls.rows.length > 0;
    const pickedNames = all.filter((item) => picked.has(item.id)).map((item) => item.name);

    return (
        <Cascade space="md" testID="corporate-catalogue-screen">
            <View className={joined ? 'z-10' : 'z-10 gap-4'}>
                <LensBar
                    testID="corporate-catalogue-toolbar"
                    layout="split"
                    joined={joined}
                    label={t('kitchen:lens.label')}
                    figures={figures}
                    actions={
                        <Button
                            testID="corporate-catalogue-build-quotation"
                            size="sm"
                            label={t('business:nav.newQuotation')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                router.push(quotationBuilderHref(programme) as never);
                            }}
                        />
                    }
                    search={query}
                    onSearchChange={setQuery}
                    searchLabel={t('business:catalogue.searchLabel')}
                    searchPlaceholder={t('business:catalogue.searchPlaceholder')}
                    tokens={
                        kindToken === null
                            ? []
                            : [
                                  {
                                      key: 'kind',
                                      label: kindToken,
                                      removeLabel: t('kitchen:toolbar.removeFilter', {
                                          filter: kindToken,
                                      }),
                                      onRemove: () => {
                                          setKind('all');
                                      },
                                  },
                              ]
                    }
                    result={
                        pending
                            ? null
                            : t('kitchen:lens.result', {
                                  shown: controls.rows.length,
                                  total: all.length,
                              })
                    }
                    clearLabel={t('kitchen:lens.clear')}
                    {...(unfiltered ? {} : { onClear: clearFilters })}
                    trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                />

                {pending ? (
                    <TableSkeleton testID="corporate-catalogue-loading" />
                ) : listFailure !== null ? (
                    <ErrorState
                        testID="corporate-catalogue-error"
                        title={t('business:catalogue.loadErrorTitle')}
                        failure={listFailure}
                        onRetry={() => {
                            void catalogue.refetch();
                        }}
                        retrying={catalogue.isFetching}
                    />
                ) : controls.rows.length === 0 ? (
                    <EmptyState
                        testID="corporate-catalogue-empty"
                        title={t(
                            unfiltered
                                ? 'business:catalogue.emptyUnfilteredTitle'
                                : 'business:catalogue.emptyTitle',
                        )}
                        body={t(
                            unfiltered
                                ? 'business:catalogue.emptyUnfilteredBody'
                                : 'business:catalogue.emptyBody',
                        )}
                        actions={
                            unfiltered ? undefined : (
                                <Button
                                    testID="corporate-catalogue-clear"
                                    variant="secondary"
                                    size="sm"
                                    label={t('business:catalogue.clearFilters')}
                                    onPress={clearFilters}
                                />
                            )
                        }
                    />
                ) : (
                    <DataTable<CatalogueItem>
                        testID="corporate-catalogue-list"
                        joined
                        label={t('business:catalogue.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(item) => item.id}
                        density="sm"
                        onRowPress={(item) => {
                            router.push(catalogueLineHref(programme, item.id) as never);
                        }}
                        rowActionsLabel={t('business:catalogue.rowActions')}
                        rowActions={(item): readonly MenuItem[] => [
                            {
                                key: 'open',
                                label: t('business:quotations.view'),
                                icon: DATA_TABLE_ROW_ICONS.view,
                                testID: `catalogue-item-${item.id}-open`,
                                onSelect: () => {
                                    router.push(catalogueLineHref(programme, item.id) as never);
                                },
                            },
                            {
                                key: 'quote',
                                label: t('business:picked.ask'),
                                icon: 'fileText',
                                testID: `catalogue-item-${item.id}-quote`,
                                onSelect: () => {
                                    router.push(
                                        quotationBuilderHref(programme, [item.id]) as never,
                                    );
                                },
                            },
                        ]}
                    />
                )}
            </View>

            <PickedLinesBar
                testID="corporate-catalogue-picked"
                names={pickedNames}
                onClear={() => {
                    setPicked(new Set());
                }}
                onAsk={() => {
                    router.push(
                        quotationBuilderHref(
                            programme,
                            all.filter((item) => picked.has(item.id)).map((item) => item.id),
                        ) as never,
                    );
                }}
            />
        </Cascade>
    );
}
