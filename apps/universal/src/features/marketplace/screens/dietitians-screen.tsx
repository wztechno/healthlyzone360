import { Breadcrumbs, Button, Heading, Stack, Text } from '@healthy360/design-system';
import type { DietitianFilter } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDietitiansQuery } from '../../../data/marketplace-hooks.ts';
import { FilterBar, useMarketplaceFilters } from '../filter-bar.tsx';
import { CardGrid, CardGridItem } from '../section-header.tsx';
import { DietitianCard } from '../dietitian-card.tsx';
import { QueryStates } from '../query-states.tsx';

/**
 * Specialisms offered as filters.
 *
 * A representative subset rather than every string in the data, because the contract's
 * `DietitianFilter.specialism` accepts exactly one and a fifteen-chip single-select row is a menu
 * pretending to be a filter.
 */
const SPECIALISMS: readonly string[] = [
    'Weight management',
    'Sports nutrition',
    'Family nutrition',
    'Plant-based nutrition',
    'Allergy management',
];

const GROUP_KEYS = ['specialism', 'availability'] as const;

export function DietitiansScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);

    const specialism = (filters.selected['specialism'] ?? [])[0];
    const acceptingOnly = (filters.selected['availability'] ?? []).includes('accepting');

    const filter = useMemo<DietitianFilter>(
        () => ({
            ...(filters.query === '' ? {} : { query: filters.query }),
            ...(specialism === undefined ? {} : { specialism }),
            ...(acceptingOnly ? { acceptingClients: true } : {}),
        }),
        [acceptingOnly, filters.query, specialism],
    );

    const query = useDietitiansQuery(filter);
    const dietitians = query.data?.items ?? [];

    return (
        <Stack space="lg" testID="dietitians-screen">
            <Breadcrumbs
                testID="dietitians-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('marketplace:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'dietitians', label: t('marketplace:nav.dietitians') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="dietitians-title">
                    {t('marketplace:dietitians.title')}
                </Heading>
                <Text tone="secondary">{t('marketplace:dietitians.subtitle')}</Text>
            </Stack>

            <FilterBar
                testID="dietitians-filter"
                state={filters}
                searchLabel={t('marketplace:dietitians.searchLabel')}
                searchPlaceholder={t('marketplace:dietitians.searchPlaceholder')}
                resultCount={query.data === undefined ? undefined : dietitians.length}
                groups={[
                    {
                        key: 'specialism',
                        label: t('marketplace:filters.specialism'),
                        mode: 'single',
                        options: SPECIALISMS.map((value) => ({ value, label: value })),
                    },
                    {
                        key: 'availability',
                        label: t('marketplace:filters.availability'),
                        options: [
                            {
                                value: 'accepting',
                                label: t('marketplace:dietitians.accepting'),
                            },
                        ],
                    },
                ]}
            />

            <QueryStates
                query={query}
                isEmpty={dietitians.length === 0}
                emptyTitle={t('marketplace:dietitians.emptyTitle')}
                emptyBody={t('marketplace:dietitians.emptyBody')}
                emptyActions={
                    filters.isFiltered ? (
                        <Button
                            testID="dietitians-empty-clear"
                            variant="secondary"
                            label={t('marketplace:filters.clear')}
                            onPress={filters.clear}
                        />
                    ) : undefined
                }
                testID="dietitians"
            >
                <CardGrid testID="dietitians-grid">
                    {dietitians.map((dietitian) => (
                        <CardGridItem key={dietitian.id}>
                            <DietitianCard
                                dietitian={dietitian}
                                onPress={() => {
                                    router.push(`/dietitians/${String(dietitian.id)}` as never);
                                }}
                            />
                        </CardGridItem>
                    ))}
                </CardGrid>
            </QueryStates>
        </Stack>
    );
}
