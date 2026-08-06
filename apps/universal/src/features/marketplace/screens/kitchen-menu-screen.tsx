import { Breadcrumbs, Button, Heading, Stack, Text } from '@healthy360/design-system';
import type { MealFilter } from '@healthy360/api-client/contracts';
import { KitchenId } from '@healthy360/domain-types';
import type { MealType } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { FilterBar, useMarketplaceFilters } from '../filter-bar.tsx';
import { CardGrid, CardGridItem } from '../section-header.tsx';
import { MealCard } from '../meal-card.tsx';
import { QueryStates } from '../query-states.tsx';

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const ITEM_TYPES = ['meal', 'product'] as const;
const GROUP_KEYS = ['itemType', 'mealType'] as const;

export interface KitchenMenuScreenProps {
    readonly kitchenId: string | undefined;
}

/**
 * A kitchen's consumer menu — prepared meals and sellable products together.
 *
 * Pressing a listing navigates to `/meals/{id}` (the marketplace show endpoint
 * accepts both published meals and products). Filter chips narrow by catalogue
 * item type and, for meals, by meal type when that axis is known.
 *
 * Uses the same cursor paging as the global meals catalogue: a Verdant product
 * sheet alone is already more than one page, and a single-shot query would
 * silently truncate the menu.
 */
export function KitchenMenuScreen({ kitchenId }: KitchenMenuScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);

    const parsed = kitchenId === undefined ? null : KitchenId.safeParse(kitchenId);
    const kitchen = useKitchenQuery(parsed);

    const { query: searchTerm, selected: selectedFilters } = filters;
    const filter = useMemo<MealFilter | undefined>(() => {
        if (parsed === null) {
            return undefined;
        }

        const mealTypes = (selectedFilters['mealType'] ?? []) as readonly MealType[];
        const itemTypes = (selectedFilters['itemType'] ?? []) as readonly ('meal' | 'product')[];
        return {
            kitchenIds: [parsed],
            ...(searchTerm === '' ? {} : { query: searchTerm }),
            ...(itemTypes.length === 0 ? {} : { itemTypes }),
            ...(mealTypes.length === 0 ? {} : { mealTypes }),
        };
    }, [parsed, searchTerm, selectedFilters]);

    const menu = useMealsQuery(filter, parsed !== null);
    const meals = mealsFromPages(menu.data?.pages);

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
                        key: 'itemType',
                        label: t('marketplace:filters.itemType'),
                        mode: 'single',
                        options: ITEM_TYPES.map((itemType) => ({
                            value: itemType,
                            label: t(`marketplace:itemTypes.${itemType}`),
                        })),
                    },
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
                <Stack space="md">
                    <CardGrid testID="kitchen-menu-grid">
                        {meals.map((meal) => (
                            <CardGridItem key={meal.id}>
                                <MealCard
                                    meal={meal}
                                    onPress={() => {
                                        router.push(`/meals/${String(meal.id)}` as never);
                                    }}
                                />
                            </CardGridItem>
                        ))}
                    </CardGrid>

                    {menu.hasNextPage ? (
                        <Button
                            testID="kitchen-menu-load-more"
                            variant="secondary"
                            label={
                                menu.isFetchingNextPage
                                    ? t('marketplace:menu.loadingMore')
                                    : t('marketplace:menu.loadMore')
                            }
                            disabled={menu.isFetchingNextPage}
                            onPress={() => {
                                void menu.fetchNextPage();
                            }}
                        />
                    ) : (
                        <Text testID="kitchen-menu-all-loaded" tone="secondary" variant="caption">
                            {t('marketplace:menu.allLoaded')}
                        </Text>
                    )}
                </Stack>
            </QueryStates>

            <MedicalDisclaimer />
        </Stack>
    );
}
