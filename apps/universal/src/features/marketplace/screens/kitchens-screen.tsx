import { Button, Card, FilterChip, Stack, Text } from '@healthy360/design-system';
import type { Kitchen, KitchenFilter } from '@healthy360/api-client/contracts';
import { DIET_CLASSIFICATIONS } from '@healthy360/domain-types';
import type { DietClassification, SalesChannel } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { useMarketplaceFilters } from '../filter-bar.tsx';
import { BrowsePanel } from '../../../ui/browse-panel.tsx';
import { CardGrid, CardGridItem, SectionHeader } from '../section-header.tsx';
import { KitchenCard } from '../kitchen-card.tsx';
import { QueryStates } from '../query-states.tsx';

/**
 * `/kitchens` — the kitchen directory, as HealthZone's browse screen.
 *
 * ## The page opens on a claim wrapped around its own controls
 *
 * The canopy band is gone. HealthZone opens this surface with one raised panel that holds a live
 * count, a headline, and the chips that narrow the grid below it ({@link BrowsePanel}); then a
 * section rule with the match count on its trailing edge; then the cards. The question and the way
 * to answer it are the same object, rather than a coloured band followed by a form.
 *
 * ## There is no search field on this page
 *
 * The chips *are* the filter. `?q=` is still read — a shared or hand-written link with a term in it
 * still narrows the directory, and the "All kitchens" chip clears it along with everything else —
 * but nothing on this page writes it. The marketplace bar owns text search
 * (`shell/marketplace-shell.tsx`); two inputs on one parameter is two things to keep in step, and
 * the moment they disagree one of them is a bug.
 *
 * ## Which filters exist, and why these
 *
 * Cuisine is gone. `listKitchens` in `packages/api-client/src/api/marketplace-repository.ts` sends
 * `query`, `country_code`, `area` and `channels` and has never sent `cuisines`, and
 * `MarketplaceKitchenPresenter` answers `cuisines: []` for every kitchen — so a cuisine chip was a
 * control that could not narrow anything, which is exactly the dead control this product forbids.
 * What replaces it:
 *
 * - **How to get it** — delivery, collection, subscription. Appended to `LISTING_CHANNELS` and sent
 *   to the API, which filters on them. `KitchenFilter.channels` is an *every*, not a some: asking
 *   for delivery narrows to kitchens configured for it.
 * - **Diet** — the kitchen's own `dietClassifications`, which the presenter really does derive from
 *   the kitchen's meals. The repository has no parameter for it, so this one narrows on the client,
 *   over a directory small enough to be fetched whole (see {@link DIRECTORY_LIMIT}).
 *
 * The diet chips are derived from the kitchens the *channel* query returned, so the row only ever
 * offers a diet some kitchen actually cooks, and toggling a diet chip cannot remove another one:
 * the list it is derived from is the one before diet narrowing.
 *
 * ## Eat by goal
 *
 * The design closes on four collection tiles. There is no "goal" taxonomy for kitchens, so these
 * carry diet classifications and land on the meals catalogue filtered by one — a filter `/meals`
 * already applies and the API really does answer (`PublicMealIndexController`). The design's
 * "N MEALS" line is not reproduced: it would need a count query per tile, and a made-up number on a
 * storefront tile is a promise the page cannot keep.
 */

/**
 * Consumer listing channel switches a public kitchen directory may require.
 *
 * Maps to `MarketplaceChannels::listingKinds` (`b2c_web` → `b2c`, plus `marketplace`). Filtering
 * only for `marketplace` hides kitchens that sell solely through their own web shop — Verdant's
 * demo channel is exactly that.
 */
const LISTING_CHANNELS: readonly SalesChannel[] = ['b2c', 'marketplace'];

/**
 * How much of the directory to fetch.
 *
 * The diet chips narrow on the client, and client-side narrowing over a *page* of results is a lie:
 * it hides matches that were simply on the next page. Six seeded kitchens against a limit of fifty
 * means the page and the directory are the same set. If the marketplace ever outgrows this, diet
 * belongs in the repository query rather than in a larger number here.
 */
const DIRECTORY_LIMIT = 50;

/** The ways a shopper can receive an order, in the order the toolbar offers them. */
const CHANNEL_OPTIONS: readonly SalesChannel[] = ['delivery', 'pickup', 'subscription'];

/**
 * The four collections the page closes on.
 *
 * Chosen as the four the catalogue is thickest in rather than as an exhaustive list — a tile row is
 * an index, not a taxonomy, and `/meals` carries the full set of diet filters one press away.
 */
const GOALS: readonly DietClassification[] = [
    'high_protein',
    'vegan',
    'low_carb',
    'halal_friendly',
];

const GROUP_KEYS = ['channel', 'diet'] as const;

export function KitchensScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);

    const { query: searchTerm, selected } = filters;

    const filter = useMemo<KitchenFilter>(() => {
        const channels = (selected['channel'] ?? []) as readonly SalesChannel[];
        return {
            channels: [...LISTING_CHANNELS, ...channels],
            limit: DIRECTORY_LIMIT,
            ...(searchTerm === '' ? {} : { query: searchTerm }),
        };
    }, [searchTerm, selected]);

    const query = useKitchensQuery(filter);
    const listed = useMemo<readonly Kitchen[]>(() => query.data?.items ?? [], [query.data]);

    // Canonical order, not the order the kitchens happened to arrive in: a chip row that reshuffles
    // between two loads of the same page is a row nobody can build a habit on.
    const dietOptions = useMemo(() => {
        const offered = new Set(listed.flatMap((kitchen) => kitchen.dietClassifications));
        return DIET_CLASSIFICATIONS.filter((diet) => offered.has(diet));
    }, [listed]);

    // Memoised for the narrowing below: `?? []` on a key the URL has not set allocates a fresh
    // array per render, which would re-filter the whole directory every time regardless of state.
    const selectedDiets = useMemo(() => selected['diet'] ?? [], [selected]);
    const kitchens = useMemo(
        () =>
            selectedDiets.length === 0
                ? listed
                : listed.filter((kitchen) =>
                      kitchen.dietClassifications.some((diet) => selectedDiets.includes(diet)),
                  ),
        [listed, selectedDiets],
    );

    const loaded = query.data !== undefined;

    return (
        <Stack space="xl" testID="kitchens-screen">
            <BrowsePanel
                testID="kitchens"
                /*
                 * The design's eyebrow names a postcode — "18 kitchens delivering to 94110 right
                 * now". Nothing here knows where the reader is: `KitchenFilter.area` exists but no
                 * screen sets it, and inventing a district would be the one placeholder that reads
                 * as a fact. The count is real, so the count is what it says.
                 *
                 * It counts what the directory *holds*, not what survived the diet chips — that is
                 * the match count on the section rule below, and two lines reporting the same
                 * number would be one of them wasted.
                 */
                eyebrow={
                    loaded
                        ? t('marketplace:kitchens.heroEyebrow', { count: listed.length })
                        : t('marketplace:kitchens.heroEyebrowPending')
                }
                title={t('marketplace:kitchens.heroTitle')}
            >
                {/*
                 * Lit when nothing is applied, so the row always has exactly one settled state to
                 * return to, and pressing it is how the page is reset — including the `?q=` this
                 * screen reads but never writes.
                 */}
                <FilterChip
                    testID="kitchens-filter-all"
                    label={t('marketplace:kitchens.allKitchens')}
                    selected={!filters.isFiltered}
                    onChange={() => {
                        filters.clear();
                    }}
                />

                {CHANNEL_OPTIONS.map((channel) => (
                    <FilterChip
                        key={channel}
                        testID={`kitchens-filter-channel-${channel}`}
                        label={t(`marketplace:channels.${channel}`)}
                        selected={(selected['channel'] ?? []).includes(channel)}
                        onChange={(next) => {
                            filters.toggle('channel', channel, next);
                        }}
                    />
                ))}

                {dietOptions.map((diet) => (
                    <FilterChip
                        key={diet}
                        testID={`kitchens-filter-diet-${diet}`}
                        label={t(`marketplace:diets.${diet}`)}
                        selected={selectedDiets.includes(diet)}
                        onChange={(next) => {
                            filters.toggle('diet', diet, next);
                        }}
                    />
                ))}
            </BrowsePanel>

            <Stack space="md">
                <SectionHeader
                    testID="kitchens-results"
                    title={t('marketplace:kitchens.resultsTitle')}
                    {...(loaded
                        ? { meta: t('marketplace:kitchens.matches', { count: kitchens.length }) }
                        : {})}
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

            <Stack space="md" testID="kitchens-goals">
                <SectionHeader
                    testID="kitchens-goals-header"
                    title={t('marketplace:kitchens.goalsTitle')}
                />
                <CardGrid>
                    {GOALS.map((goal) => (
                        <CardGridItem key={goal}>
                            <Card
                                testID={`kitchens-goal-${goal}`}
                                padding="md"
                                interactive
                                className="grow"
                                onPress={() => {
                                    router.push(`/meals?diet=${goal}` as never);
                                }}
                                accessibilityLabel={t(`marketplace:diets.${goal}`)}
                            >
                                <View className="flex-col gap-1.5">
                                    <RNText className="font-display text-lg leading-tight text-content-primary text-start">
                                        {t(`marketplace:diets.${goal}`)}
                                    </RNText>
                                    <Text tone="secondary" variant="caption">
                                        {t(`marketplace:kitchens.goalBody.${goal}`)}
                                    </Text>
                                </View>
                            </Card>
                        </CardGridItem>
                    ))}
                </CardGrid>
            </Stack>
        </Stack>
    );
}
