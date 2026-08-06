import { Breadcrumbs, Button, Heading, Stack, Text } from '@healthy360/design-system';
import type { KitchenFilter } from '@healthy360/api-client/contracts';
import type { SalesChannel } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { FilterBar, useMarketplaceFilters } from '../filter-bar.tsx';
import { CardGrid, CardGridItem } from '../section-header.tsx';
import { KitchenCard } from '../kitchen-card.tsx';
import { QueryStates } from '../query-states.tsx';

/**
 * Consumer listing channel switches a public kitchen directory may require.
 *
 * Maps to `MarketplaceChannels::listingKinds` (`b2c_web` → `b2c`, plus
 * `marketplace`). Filtering only for `marketplace` hides kitchens that sell
 * solely through their own web shop — Verdant's demo channel is exactly that.
 */
const LISTING_CHANNELS: readonly SalesChannel[] = ['b2c', 'marketplace'];

/** Cuisines offered as filters. Fixed rather than derived, so the control does not reflow per page. */
const CUISINES: readonly string[] = [
    'Levantine',
    'Mediterranean',
    'Coastal',
    'Home cooking',
    'Contemporary',
    'Grill',
];

const CHANNEL_OPTIONS: readonly SalesChannel[] = ['delivery', 'pickup', 'subscription'];

const GROUP_KEYS = ['cuisine', 'channel'] as const;

/**
 * The kitchen directory.
 *
 * Every kitchen shown here runs at least one consumer listing channel (`b2c`
 * and/or `marketplace`). Extra chips narrow further; they never replace that
 * baseline.
 */
export function KitchensScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);

    const { query: searchTerm, selected } = filters;

    const filter = useMemo<KitchenFilter>(() => {
        const cuisines = selected['cuisine'] ?? [];
        const channels = (selected['channel'] ?? []) as readonly SalesChannel[];
        return {
            channels: [...LISTING_CHANNELS, ...channels],
            ...(searchTerm === '' ? {} : { query: searchTerm }),
            ...(cuisines.length === 0 ? {} : { cuisines }),
        };
    }, [searchTerm, selected]);

    const query = useKitchensQuery(filter);
    const kitchens = query.data?.items ?? [];

    return (
        <Stack space="lg" testID="kitchens-screen">
            <Breadcrumbs
                testID="kitchens-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('marketplace:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'kitchens', label: t('marketplace:nav.kitchens') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="kitchens-title">
                    {t('marketplace:kitchens.title')}
                </Heading>
                <Text tone="secondary">{t('marketplace:kitchens.subtitle')}</Text>
            </Stack>

            <FilterBar
                testID="kitchens-filter"
                state={filters}
                searchLabel={t('marketplace:kitchens.searchLabel')}
                searchPlaceholder={t('marketplace:kitchens.searchPlaceholder')}
                resultCount={query.data === undefined ? undefined : kitchens.length}
                groups={[
                    {
                        key: 'cuisine',
                        label: t('marketplace:filters.cuisine'),
                        options: CUISINES.map((cuisine) => ({ value: cuisine, label: cuisine })),
                    },
                    {
                        key: 'channel',
                        label: t('marketplace:filters.howToGetIt'),
                        options: CHANNEL_OPTIONS.map((channel) => ({
                            value: channel,
                            label: t(`marketplace:channels.${channel}`),
                        })),
                    },
                ]}
            />

            <QueryStates
                query={query}
                isEmpty={kitchens.length === 0}
                emptyTitle={t('marketplace:kitchens.emptyTitle')}
                emptyBody={t('marketplace:kitchens.emptyBody')}
                emptyActions={
                    filters.isFiltered ? (
                        <Button
                            testID="kitchens-empty-clear"
                            variant="secondary"
                            label={t('marketplace:filters.clear')}
                            onPress={filters.clear}
                        />
                    ) : undefined
                }
                testID="kitchens"
            >
                <CardGrid testID="kitchens-grid">
                    {kitchens.map((kitchen) => (
                        <CardGridItem key={String(kitchen.id)}>
                            <KitchenCard
                                kitchen={kitchen}
                                onPress={() => {
                                    router.push(`/kitchens/${String(kitchen.id)}` as never);
                                }}
                            />
                        </CardGridItem>
                    ))}
                </CardGrid>
            </QueryStates>
        </Stack>
    );
}
