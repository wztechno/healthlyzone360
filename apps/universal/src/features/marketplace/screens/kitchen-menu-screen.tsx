import { Breadcrumbs, Heading, Stack, Text } from '@healthy360/design-system';
import type { MarketplaceMeal, MealFilter } from '@healthy360/api-client/contracts';
import { KitchenId } from '@healthy360/domain-types';
import type { MealType } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKitchenMenuQuery, useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { FilterBar, useMarketplaceFilters } from '../filter-bar.tsx';
import { CardGrid, CardGridItem } from '../section-header.tsx';
import { MealCard } from '../meal-card.tsx';
import { MealDetailDrawer } from '../meal-detail-drawer.tsx';
import { QueryStates } from '../query-states.tsx';

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const GROUP_KEYS = ['mealType'] as const;

export interface KitchenMenuScreenProps {
    readonly kitchenId: string | undefined;
}

/**
 * A kitchen's consumer menu.
 *
 * Pressing a meal opens the in-place detail drawer rather than navigating to `/meals/{meal}` — see
 * `../meal-detail-drawer.tsx` for why, and for what the catalogue wave replaces.
 *
 * The medical disclaimer is on the page and not only in the drawer: the cards themselves carry
 * energy and protein figures, and a figure on screen is a figure that needs its caveat beside it.
 */
export function KitchenMenuScreen({ kitchenId }: KitchenMenuScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const [selected, setSelected] = useState<MarketplaceMeal | null>(null);

    const parsed = kitchenId === undefined ? null : KitchenId.safeParse(kitchenId);
    const kitchen = useKitchenQuery(parsed);

    const { query: searchTerm, selected: selectedFilters } = filters;
    const filter = useMemo<Omit<MealFilter, 'kitchenIds'>>(() => {
        const mealTypes = (selectedFilters['mealType'] ?? []) as readonly MealType[];
        return {
            ...(searchTerm === '' ? {} : { query: searchTerm }),
            ...(mealTypes.length === 0 ? {} : { mealTypes }),
        };
    }, [searchTerm, selectedFilters]);

    const menu = useKitchenMenuQuery(parsed, filter);
    const meals = menu.data?.items ?? [];

    return (
        <Stack space="lg" testID="kitchen-menu-screen">
            <Breadcrumbs
                testID="kitchen-menu-breadcrumbs"
                items={[
                    {
                        key: 'kitchens',
                        label: t('marketplace:nav.kitchens'),
                        onPress: () => {
                            router.push('/kitchens');
                        },
                    },
                    {
                        key: 'kitchen',
                        label: kitchen.data?.name ?? t('marketplace:kitchen.loading'),
                        onPress: () => {
                            if (parsed !== null) {
                                router.push(`/kitchens/${String(parsed)}` as never);
                            }
                        },
                    },
                    { key: 'menu', label: t('marketplace:menu.title') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="kitchen-menu-title">
                    {kitchen.data === undefined
                        ? t('marketplace:menu.title')
                        : t('marketplace:menu.titleFor', { kitchen: kitchen.data.name })}
                </Heading>
                <Text tone="secondary">{t('marketplace:menu.subtitle')}</Text>
            </Stack>

            <FilterBar
                testID="kitchen-menu-filter"
                state={filters}
                searchLabel={t('marketplace:menu.searchLabel')}
                searchPlaceholder={t('marketplace:menu.searchPlaceholder')}
                resultCount={menu.data === undefined ? undefined : meals.length}
                groups={[
                    {
                        key: 'mealType',
                        label: t('marketplace:filters.mealType'),
                        options: MEAL_TYPES.map((mealType) => ({
                            value: mealType,
                            label: t(`marketplace:mealTypes.${mealType}`),
                        })),
                    },
                ]}
            />

            <QueryStates
                query={menu}
                isEmpty={meals.length === 0}
                emptyTitle={t('marketplace:menu.emptyTitle')}
                emptyBody={t('marketplace:menu.emptyBody')}
                testID="kitchen-menu"
            >
                <CardGrid testID="kitchen-menu-grid">
                    {meals.map((meal) => (
                        <CardGridItem key={meal.id}>
                            <MealCard
                                meal={meal}
                                onPress={() => {
                                    setSelected(meal);
                                }}
                            />
                        </CardGridItem>
                    ))}
                </CardGrid>
            </QueryStates>

            <MedicalDisclaimer />

            <MealDetailDrawer
                meal={selected}
                onClose={() => {
                    setSelected(null);
                }}
            />
        </Stack>
    );
}
