import {
    Button,
    Callout,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    InfoTip,
    TableSkeleton,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { MealId } from '@healthy360/domain-types';
import { CATALOGUE_ITEM_KINDS } from '@healthy360/api-client/contracts';
import type {
    CatalogueFilter,
    CatalogueItem,
    CatalogueItemKind,
} from '@healthy360/api-client/contracts';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCorporateCatalogueQuery,
    useCorporateProgrammeQuery,
    useB2bAddCatalogueItemMutation,
    B2B_CART_CHANNEL_CODE,
} from '../../../data/business-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../../kitchen-admin/catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../../kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { CataloguePageHeader } from '../../kitchen-admin/catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../../kitchen-admin/catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../../kitchen-admin/catalogue/catalogue-toolbar.tsx';
import { ColumnPicker } from '../../kitchen-admin/catalogue/column-picker.tsx';
import { useColumnControls } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import { catalogueColumns } from '../catalogue-columns.tsx';
import { CORPORATE_HOME_HREF } from '../corporate-chrome.tsx';
import { catalogueKindKey } from '../format.ts';

/**
 * `/corporate/catalogue/{programme}` — the negotiated lines for one programme, priced.
 *
 * Drawn as an admin list (`kitchen-admin/screens/ingredients-screen.tsx` is the reference): the
 * summary cards, one toolbar row, and the lines as a table whose row opens the line and whose row
 * menu carries the buying actions. The rail and the trail are the way back; there is no Back
 * button.
 *
 * ## This is one of the two screens allowed to show a contract price
 *
 * Every figure here carries the `contract-price-` marker (`../format.ts`) — the price column's cell
 * renders it (`../catalogue-columns.tsx`). The marker is meaningful in both directions: the privacy
 * sweep asserts its absence on a consumer route *and* its presence here, because a marker nobody
 * applies proves nothing.
 *
 * ## The catalogue is scoped to a programme because the contract scopes it
 *
 * `CatalogueFilter` requires a `programmeId`. There is no cross-programme listing and this screen
 * does not simulate one — a negotiated catalogue is paperwork between one buyer and this business,
 * and merging two of them would show a buyer a rate they are not party to.
 *
 * ## The currency card is the multi-currency proof
 *
 * One fixture line is priced in SAR while the rest are AED. When a programme's lines span more than
 * one currency the card says so and the screen offers no total at all, rather than adding riyals to
 * dirhams behind a plausible-looking number.
 */

export interface CorporateCatalogueScreenProps {
    readonly programmeId: string | undefined;
}

const KIND_FILTERS = ['all', ...CATALOGUE_ITEM_KINDS] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

/** A line the basket can take: a meal, or anything already tied to one. */
function isOrderable(item: CatalogueItem): boolean {
    return item.mealId !== null || item.kind === 'meal';
}

export function CorporateCatalogueScreen({ programmeId }: CorporateCatalogueScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const toast = useToast();

    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);

    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<KindFilter>('all');

    const programme = useCorporateProgrammeQuery(parsed);
    const addToCart = useB2bAddCatalogueItemMutation();

    const filter: CatalogueFilter | null =
        parsed === null
            ? null
            : {
                  programmeId: parsed,
                  ...(query.trim() === '' ? {} : { query: query.trim() }),
                  ...(kind === 'all' ? {} : { kinds: [kind as CatalogueItemKind] }),
              };

    const catalogue = useCorporateCatalogueQuery(filter);
    const items: readonly CatalogueItem[] = catalogue.data?.items ?? [];

    const columns: readonly ControlledColumn<CatalogueItem, CatalogueColumn<CatalogueItem>>[] =
        catalogueColumns(t, formatter);
    const controls = useColumnControls(items, columns, 'corporate-catalogue', {
        picker: { defaults: ['name', 'kind', 'price', 'minimum', 'lead-time', 'weekdays'] },
    });

    const onAddToCart = (item: CatalogueItem, onSuccess?: () => void) => {
        const mealId = item.mealId ?? MealId.unsafe(item.id);
        addToCart.mutate(
            { mealId, quantity: item.minimumOrderQuantity },
            {
                onSuccess: (cart) => {
                    toast.show({
                        testID: `catalogue-item-${item.id}-added`,
                        tone: 'success',
                        message: t('business:catalogue.addedToCart', { items: cart.itemCount }),
                    });
                    onSuccess?.();
                },
            },
        );
    };

    const onPlaceOrder = (item: CatalogueItem) => {
        onAddToCart(item, () => {
            router.push(
                `/customer/checkout?channel=${encodeURIComponent(B2B_CART_CHANNEL_CODE)}` as never,
            );
        });
    };

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

    const currencies = [
        ...new Set(
            items
                .map((item) => item.contractPrice?.currency)
                .filter((code): code is NonNullable<typeof code> => code !== undefined),
        ),
    ];
    const listFailure = toFailure(catalogue.error);
    const unfiltered = query === '' && kind === 'all' && !controls.filtered;
    const clearFilters = () => {
        setQuery('');
        setKind('all');
        controls.clearFilters();
    };
    const buildQuotation = (itemId?: string) => {
        router.push(
            `/corporate/quotations/new?programme=${String(parsed)}${
                itemId === undefined ? '' : `&item=${itemId}`
            }` as never,
        );
    };

    return (
        <Cascade space="md" testID="corporate-catalogue-screen">
            <CataloguePageHeader
                testID="corporate-catalogue-header"
                titleTestID="corporate-catalogue-programme"
                title={
                    programme.data === undefined
                        ? t('business:catalogue.programmeLoading')
                        : programme.data.name
                }
                titleAside={
                    <InfoTip
                        testID="corporate-catalogue-privacy"
                        label={t('business:catalogue.privacyTitle')}
                        text={t('business:catalogue.privacyBody')}
                    />
                }
            />

            {listFailure !== null ? null : (
                <CatalogueStatCards
                    testID="corporate-catalogue-stats"
                    pending={catalogue.isPending}
                    cards={[
                        {
                            key: 'lines',
                            label: t('business:catalogue.statLines'),
                            value: formatter.formatNumber(items.length),
                            unit: t('business:catalogue.statLinesUnit'),
                            mark: 'list',
                            tone: 'brand',
                            onPress: clearFilters,
                            accessibilityLabel: t('business:catalogue.clearFilters'),
                        },
                        {
                            key: 'orderable',
                            label: t('business:catalogue.statOrderable'),
                            value: formatter.formatNumber(items.filter(isOrderable).length),
                            unit: t('business:catalogue.statLinesUnit'),
                            mark: 'shoppingCart',
                        },
                        {
                            key: 'recurring',
                            label: t('business:catalogue.statRecurring'),
                            value: formatter.formatNumber(
                                items.filter((item) => item.supportsRecurringOrder).length,
                            ),
                            unit: t('business:catalogue.statLinesUnit'),
                            mark: 'calendarRange',
                        },
                        {
                            key: 'currency',
                            label: t('business:catalogue.statCurrency'),
                            value:
                                currencies.length > 1
                                    ? t('business:catalogue.statCurrencyMixed')
                                    : (currencies[0] ?? t('business:catalogue.noCurrency')),
                            caption:
                                currencies.length > 1
                                    ? t('business:catalogue.mixedCurrencyShort', {
                                          currencies: currencies.join(
                                              t('business:common.listSeparator'),
                                          ),
                                      })
                                    : undefined,
                            mark: 'coins',
                            tone: currencies.length > 1 ? 'warning' : 'default',
                        },
                    ]}
                />
            )}

            <CatalogueToolbar<KindFilter>
                testID="corporate-catalogue-toolbar"
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('business:catalogue.searchLabel')}
                searchPlaceholder={t('business:catalogue.searchPlaceholder')}
                statusLabel={t('business:catalogue.kindLabel')}
                statusSegments={KIND_FILTERS.map((value) => ({
                    value,
                    label:
                        value === 'all'
                            ? t('business:catalogue.kindAll')
                            : t(catalogueKindKey(value)),
                }))}
                status={kind}
                onStatusChange={setKind}
            >
                <ColumnPicker {...controls.picker} />
                <Button
                    testID="corporate-catalogue-build-quotation"
                    label={t('business:catalogue.buildQuotation')}
                    iconStart={<Icon name="plus" size="sm" />}
                    onPress={() => {
                        buildQuotation();
                    }}
                />
            </CatalogueToolbar>

            {catalogue.isPending ? (
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
                <CatalogueList<CatalogueItem>
                    testID="corporate-catalogue-list"
                    label={t('business:catalogue.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(item) => item.id}
                    density="sm"
                    onRowPress={(item) => {
                        router.push(`/corporate/items/${item.id}` as never);
                    }}
                    rowActionsLabel={t('business:catalogue.rowActions')}
                    rowActions={(item): readonly MenuItem[] => [
                        {
                            key: 'open',
                            label: t('business:catalogue.open'),
                            icon: CATALOGUE_ROW_ICONS.view,
                            testID: `catalogue-item-${item.id}-open`,
                            onSelect: () => {
                                router.push(`/corporate/items/${item.id}` as never);
                            },
                        },
                        ...(isOrderable(item)
                            ? [
                                  {
                                      key: 'cart',
                                      label: t('business:catalogue.addToCart'),
                                      icon: 'shoppingCart' as const,
                                      testID: `catalogue-item-${item.id}-cart`,
                                      disabled: addToCart.isPending,
                                      onSelect: () => {
                                          onAddToCart(item);
                                      },
                                  },
                                  {
                                      key: 'order',
                                      label: t('business:catalogue.placeOrder'),
                                      icon: 'send' as const,
                                      testID: `catalogue-item-${item.id}-order`,
                                      disabled: addToCart.isPending,
                                      onSelect: () => {
                                          onPlaceOrder(item);
                                      },
                                  },
                              ]
                            : []),
                        {
                            key: 'quote',
                            label: t('business:catalogue.quote'),
                            icon: 'fileText',
                            testID: `catalogue-item-${item.id}-quote`,
                            onSelect: () => {
                                buildQuotation(item.id);
                            },
                        },
                    ]}
                />
            )}
        </Cascade>
    );
}
