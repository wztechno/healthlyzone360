import {
    Button,
    Icon,
    SearchInput,
    Select,
    cx,
    inputFrameClassName,
    useBreakpoint,
} from '@healthy360/design-system';
import type {
    CustomerAddress,
    Kitchen,
    KitchenFilter,
    MealFilter,
} from '@healthy360/api-client/contracts';
import { DIET_CLASSIFICATIONS } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { useAddressesQuery, useDietaryProfileQuery } from '../../../data/account-hooks.ts';
import { totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';
import { useMarketplaceFilters } from '../filter-bar.tsx';
import { KitchenFinderCard } from '../kitchen-finder-card.tsx';
import {
    availableKitchenSorts,
    defaultKitchenSort,
    deliversFast,
    narrowByDiets,
    openToday,
    parseKitchenSort,
    profileDietsOf,
    sortKitchens,
    toRows,
} from '../kitchen-finder.ts';
import type { KitchenSort } from '../kitchen-finder.ts';
import { QueryStates } from '../query-states.tsx';

/**
 * `/kitchens` — the kitchen finder (the header's "Kitchens").
 *
 * Top to bottom: the listing title with its count; a sticky toolbar of two rows — the search, the
 * delivery address and the sort on one line, every filter as one row of pill chips under it; the
 * kitchen grid; and "Eat by goal". Kept deliberately plain: one shape of control per row, every
 * control on the row's centre line, and no prose the page does not need.
 *
 * ## The profile, the address, and who has them
 *
 * A signed-in shopper has a dietary profile and saved addresses on the account API; a visitor has
 * neither. The profile only changes the default order ("best match"); the address control names the
 * shopper's default address, or offers to add one — to the address book for a shopper, to sign-in
 * for a visitor. The directory is not narrowed to the shopper's area (an address's area and a
 * zone's label need not match as text — see `CustomerAddress.isDeliverable`).
 *
 * ## The search field searches kitchens, by name
 *
 * It writes `?q=`, which this screen sends as `KitchenFilter.query` — the API matches it against the
 * kitchen's name (the presenter answers `cuisines: []`, so a cuisine term could never match).
 *
 * ## Which filters exist, and why these
 *
 * - **Diet chips** — the kitchen's own `dietClassifications`, derived from the kitchens the server
 *   query returned, so the row only offers a diet some kitchen cooks. They narrow on the client,
 *   over a directory small enough to be fetched whole ({@link DIRECTORY_LIMIT}).
 * - **"Under 30 min"** — the fastest advertised delivery, on the client.
 * - **"Collection"** / **"Offers plans"** — sales channels sent to the API. `?channel=delivery` in
 *   a shared link is still honoured, though no chip draws it: nearly every listed kitchen delivers.
 * - **"Open today"** — "open now" is a claim about this instant in the kitchen's time zone, which
 *   `storefront-facts.ts` explains is not reliably available on native; "today" is what the
 *   published hours can answer.
 * - **Sort** — best match (with a profile), fastest, top rated, lowest fee, and name.
 */

/**
 * Consumer listing channel switches a public kitchen directory may require.
 *
 * Maps to `MarketplaceChannels::listingKinds` (`b2c_web` → `b2c`, plus `marketplace`). Filtering
 * only for `marketplace` hides kitchens that sell solely through their own web shop.
 */
const LISTING_CHANNELS: readonly SalesChannel[] = ['b2c', 'marketplace'];

/**
 * How much of the directory to fetch.
 *
 * Diet and "open today" narrow on the client, and client-side narrowing over a *page* of results
 * hides matches that were simply on the next page. If the marketplace outgrows this, those filters
 * belong in the repository query rather than in a larger number here.
 */
const DIRECTORY_LIMIT = 50;

/** The whole consumer directory — the "of N" in the count. */
const DIRECTORY_FILTER: KitchenFilter = { channels: LISTING_CHANNELS, limit: DIRECTORY_LIMIT };

const GROUP_KEYS = ['channel', 'diet', 'open', 'fast'] as const;
const SORT_KEYS = ['sort'] as const;

/** `?open=today` — the one value the "Open today" chip writes. */
const OPEN_TODAY = 'today';
/** `?fast=30` — the one value the "Under 30 min" chip writes. */
const FAST = '30';

/** How long a typed term waits before it becomes the URL's `?q=` and a request. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * One track for both grids — `minmax(260px,1fr)` — so the kitchens and the goal tiles under them
 * share their column lines at every width.
 */
const TRACK = 260;
/** `gap-4` between cells, in the unit the measured width comes back in. */
const GRID_GAP = 16;

interface Goal {
    readonly key: string;
    readonly href: string;
    readonly image: string;
    /** The count query — the same narrowing `/meals` applies for the tile's link. */
    readonly filter: Omit<MealFilter, 'cursor'>;
}

/**
 * The collections the page closes on, each landing on a filter `/meals` already applies.
 *
 * Images are the diet heroes the manifest already carries; a key with no photograph falls back to
 * the generated pattern rather than to nothing.
 */
const GOALS: readonly Goal[] = [
    {
        key: 'high_protein',
        href: '/meals?diet=high_protein',
        image: 'diets/high-protein.hero',
        filter: { itemTypes: ['meal'], dietClassifications: ['high_protein'], limit: 1 },
    },
    {
        key: 'vegan',
        href: '/meals?diet=vegan',
        image: 'diets/plant-based.hero',
        filter: { itemTypes: ['meal'], dietClassifications: ['vegan'], limit: 1 },
    },
    {
        key: 'under500',
        href: '/meals?energyMax=500',
        image: 'diets/weight-management.hero',
        filter: { itemTypes: ['meal'], energy: { max: 500 }, limit: 1 },
    },
    {
        key: 'low_carb',
        href: '/meals?diet=low_carb',
        image: 'diets/low-carb.hero',
        filter: { itemTypes: ['meal'], dietClassifications: ['low_carb'], limit: 1 },
    },
];

/** The address the control names: the default one, else the first saved. */
function deliveryAddress(
    addresses: readonly CustomerAddress[] | undefined,
): CustomerAddress | null {
    if (addresses === undefined) return null;
    return addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
}

export function KitchensScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const { me } = useSession();
    const signedIn = me !== null;
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const sorting = useMarketplaceFilters(SORT_KEYS);

    // The account answers only for a signed-in shopper; a visitor's page never asks.
    const profile = useDietaryProfileQuery(signedIn);
    const addresses = useAddressesQuery(signedIn);
    const profileDiets = useMemo(
        () => (signedIn ? profileDietsOf(profile.data?.dietCategoryCode) : []),
        [signedIn, profile.data],
    );

    const { query: searchTerm, selected, setQuery } = filters;
    const sort = parseKitchenSort(sorting.selected['sort']?.[0], profileDiets);

    /*
     * The field holds a draft and the URL holds the term. Each keystroke is not a request: the
     * draft settles for a moment first. And a term changed from elsewhere — "Clear filters", a
     * shared link — is copied back into the field so the two never disagree.
     */
    const [draft, setDraft] = useState(searchTerm);
    // Adjusted during render rather than in an effect, so the field never paints a stale term.
    const [syncedTerm, setSyncedTerm] = useState(searchTerm);
    if (syncedTerm !== searchTerm) {
        setSyncedTerm(searchTerm);
        setDraft(searchTerm);
    }
    useEffect(() => {
        const term = draft.trim();
        if (term === searchTerm) return undefined;
        const timer = setTimeout(() => {
            setQuery(term);
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [draft, searchTerm, setQuery]);

    const filter = useMemo<KitchenFilter>(() => {
        const channels = (selected['channel'] ?? []) as readonly SalesChannel[];
        return {
            channels: [...LISTING_CHANNELS, ...channels],
            limit: DIRECTORY_LIMIT,
            ...(searchTerm === '' ? {} : { query: searchTerm }),
        };
    }, [searchTerm, selected]);

    const query = useKitchensQuery(filter);
    // The same key as `query` whenever nothing server-side is applied, so usually no extra request.
    const directoryQuery = useKitchensQuery(DIRECTORY_FILTER);

    const listed = useMemo<readonly Kitchen[]>(() => query.data?.items ?? [], [query.data]);
    const directory = useMemo<readonly Kitchen[]>(
        () => directoryQuery.data?.items ?? [],
        [directoryQuery.data],
    );

    // Canonical order, not arrival order: a chip row that reshuffles between loads is a row nobody
    // can build a habit on.
    const dietOptions = useMemo(() => {
        const offered = new Set(listed.flatMap((kitchen) => kitchen.dietClassifications));
        return DIET_CLASSIFICATIONS.filter((diet) => offered.has(diet));
    }, [listed]);

    // Memoised: `?? []` on an unset key allocates per render and would re-narrow every time.
    const selectedDiets = useMemo(() => selected['diet'] ?? [], [selected]);
    const selectedChannels = useMemo(() => selected['channel'] ?? [], [selected]);
    const onlyOpenToday = (selected['open'] ?? []).includes(OPEN_TODAY);
    const onlyFast = (selected['fast'] ?? []).includes(FAST);

    const kitchens = useMemo(() => {
        const byDiet = narrowByDiets(listed, selectedDiets);
        const bySpeed = onlyFast ? deliversFast(byDiet) : byDiet;
        const byHours = onlyOpenToday ? openToday(bySpeed) : bySpeed;
        return sortKitchens(byHours, sort, profileDiets);
    }, [listed, selectedDiets, onlyFast, onlyOpenToday, sort, profileDiets]);

    const loaded = query.data !== undefined && directoryQuery.data !== undefined;
    const total = Math.max(directory.length, kitchens.length);
    const defaultSort = defaultKitchenSort(profileDiets);

    const toggleChannel = (channel: SalesChannel) => {
        filters.toggle('channel', channel, !selectedChannels.includes(channel));
    };

    return (
        <View className="flex-col" testID="kitchens-screen">
            <ListingHeader
                testID="kitchens-header"
                title={t('marketplace:kitchens.title')}
                metaTestID="kitchens-results-count"
                {...(loaded
                    ? {
                          meta:
                              kitchens.length === total
                                  ? t('marketplace:kitchens.finder.count', { count: total })
                                  : t('marketplace:kitchens.finder.countOf', {
                                        shown: kitchens.length,
                                        count: total,
                                    }),
                      }
                    : {})}
            />

            {/*
             * Sticky on the web against the shell's scroll port — `top-0` pins it just under the
             * marketplace bar. The chips scroll sideways on a phone rather than wrapping into a band
             * that eats the screen; the sort sits outside that scroller so its listbox is never
             * clipped by it.
             */}
            <View
                testID="kitchens-filters"
                role="toolbar"
                aria-label={t('marketplace:kitchens.finder.filtersLabel')}
                className="z-10 mt-6 flex-col gap-1 border-b border-stroke bg-surface-base pb-2 pt-2 web:sticky web:top-0"
            >
                <View className="flex-row flex-wrap items-center gap-2">
                    <View className="min-w-[240px] flex-1">
                        <SearchInput
                            testID="kitchens-search"
                            label={t('marketplace:kitchens.finder.searchLabel')}
                            placeholder={t('marketplace:kitchens.finder.searchPlaceholder')}
                            value={draft}
                            onChangeText={setDraft}
                            onSubmitEditing={() => {
                                setQuery(draft.trim());
                            }}
                            size="md"
                        />
                    </View>
                    <View className="w-full flex-row items-center gap-2 md:w-auto">
                        <AddressControl
                            signedIn={signedIn}
                            pending={
                                signedIn && addresses.data === undefined && addresses.error === null
                            }
                            address={deliveryAddress(addresses.data)}
                            onPress={() => {
                                router.push(
                                    (signedIn
                                        ? '/customer/account/addresses'
                                        : '/sign-in') as never,
                                );
                            }}
                        />
                        <Select<KitchenSort>
                            testID="kitchens-sort"
                            id="kitchens-sort"
                            label={t('marketplace:kitchens.finder.sortFieldLabel')}
                            labelHidden
                            value={sort}
                            options={availableKitchenSorts(profileDiets).map((option) => ({
                                value: option,
                                label: t(`marketplace:kitchens.finder.sort.${option}`),
                            }))}
                            onChange={(next) => {
                                sorting.select('sort', next === defaultSort ? null : next);
                            }}
                            className="min-w-[160px]"
                        />
                    </View>
                </View>

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerClassName="flex-row items-center gap-2"
                >
                    {dietOptions.map((diet) => {
                        const on = selectedDiets.includes(diet);
                        return (
                            <PillChip
                                key={diet}
                                testID={`kitchens-filter-diet-${diet}`}
                                label={t(`marketplace:diets.${diet}`)}
                                selected={on}
                                onPress={() => {
                                    filters.toggle('diet', diet, !on);
                                }}
                            />
                        );
                    })}
                    <PillChip
                        testID="kitchens-filter-fast"
                        label={t('marketplace:kitchens.finder.under30')}
                        selected={onlyFast}
                        onPress={() => {
                            filters.select('fast', onlyFast ? null : FAST);
                        }}
                    />
                    <PillChip
                        testID="kitchens-filter-open-today"
                        label={t('marketplace:kitchens.finder.toggle.openToday')}
                        selected={onlyOpenToday}
                        onPress={() => {
                            filters.select('open', onlyOpenToday ? null : OPEN_TODAY);
                        }}
                    />
                    <PillChip
                        testID="kitchens-filter-channel-pickup"
                        label={t('marketplace:kitchens.finder.toggle.pickup')}
                        selected={selectedChannels.includes('pickup')}
                        onPress={() => {
                            toggleChannel('pickup');
                        }}
                    />
                    <PillChip
                        testID="kitchens-filter-channel-subscription"
                        label={t('marketplace:kitchens.finder.toggle.subscription')}
                        selected={selectedChannels.includes('subscription')}
                        onPress={() => {
                            toggleChannel('subscription');
                        }}
                    />
                </ScrollView>
            </View>

            <RNText
                testID="kitchens-results"
                accessibilityRole="header"
                aria-level={2}
                className="mb-4 mt-8 font-display text-2xl font-bold tracking-display text-content-primary text-start"
            >
                {filters.isFiltered
                    ? t('marketplace:kitchens.finder.listMatching')
                    : t('marketplace:kitchens.finder.listAll')}
            </RNText>

            <QueryStates
                query={query}
                isEmpty={kitchens.length === 0}
                emptyTitle={t('marketplace:kitchens.finder.emptyTitle')}
                emptyBody={t('marketplace:kitchens.finder.emptyBody')}
                emptyActions={
                    filters.isFiltered ? (
                        <Button
                            testID="kitchens-empty-clear"
                            label={t('marketplace:filters.clear')}
                            onPress={filters.clear}
                        />
                    ) : undefined
                }
                testID="kitchens"
            >
                <TrackGrid
                    testID="kitchens-grid"
                    track={TRACK}
                    fallback={atLeast('lg') ? 4 : atLeast('sm') ? 2 : 1}
                >
                    {kitchens.map((kitchen) => (
                        <KitchenFinderCard key={String(kitchen.id)} kitchen={kitchen} />
                    ))}
                </TrackGrid>
            </QueryStates>

            <View testID="kitchens-goals" className="mt-12 flex-col gap-4">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('marketplace:kitchens.finder.goalsTitle')}
                </RNText>
                <TrackGrid
                    track={TRACK}
                    max={GOALS.length}
                    fallback={atLeast('lg') ? 4 : atLeast('sm') ? 2 : 1}
                >
                    {GOALS.map((goal) => (
                        <GoalCard
                            key={goal.key}
                            goal={goal}
                            onOpen={() => {
                                router.push(goal.href as never);
                            }}
                        />
                    ))}
                </TrackGrid>
            </View>
        </View>
    );
}

/**
 * The delivery address, drawn as a field so it sits level with the search beside it: a pin, the
 * shopper's default saved address (else the first) and "Change"; with none saved — or for a
 * visitor — "Add delivery address". One press target, to the address book or to sign-in. Nothing
 * here invents an address.
 */
function AddressControl({
    signedIn,
    pending,
    address,
    onPress,
}: {
    readonly signedIn: boolean;
    readonly pending: boolean;
    readonly address: CustomerAddress | null;
    readonly onPress: () => void;
}) {
    const { t } = useTranslation();
    const value = pending
        ? t('marketplace:kitchens.finder.addressPending')
        : signedIn && address !== null
          ? address.line1
          : null;

    return (
        <Pressable
            testID="kitchens-address"
            role="link"
            accessibilityRole="link"
            accessibilityLabel={
                value === null
                    ? t('marketplace:kitchens.finder.addressAdd')
                    : t('marketplace:kitchens.finder.deliveringTo', { address: value })
            }
            disabled={pending}
            onPress={onPress}
            className={cx(
                inputFrameClassName({ invalid: false, focused: false, disabled: false }),
                'min-w-0 flex-1 hover:border-stroke-strong md:w-[260px] md:flex-none',
            )}
        >
            <Icon name="mapPin" size="md" className="text-content-secondary" />
            <RNText
                testID="kitchens-address-value"
                numberOfLines={1}
                className={
                    value === null
                        ? 'min-w-0 flex-1 text-sm font-medium text-content-on-brand-subtle text-start'
                        : 'min-w-0 flex-1 text-sm font-medium text-content-primary text-start'
                }
            >
                {value ?? t('marketplace:kitchens.finder.addressAdd')}
            </RNText>
            {value === null || pending ? null : (
                <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                    {t('marketplace:kitchens.finder.addressChange')}
                </RNText>
            )}
        </Pressable>
    );
}

/** One "Eat by goal" tile — photograph, title, and the real meal count where the API has one. */
function GoalCard({ goal, onOpen }: { readonly goal: Goal; readonly onOpen: () => void }) {
    const { t } = useTranslation();
    const total = totalFromPages(useMealsQuery(goal.filter).data?.pages);
    const title = t(`marketplace:kitchens.finder.goal.${goal.key}.title`);

    return (
        <Pressable
            testID={`kitchens-goal-${goal.key}`}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={title}
            onPress={onOpen}
            className="flex-1 overflow-hidden rounded-panel border border-stroke bg-surface-raised hover:border-surface-brand"
        >
            <View className="h-[110px]">
                <EntityImage
                    source={resolveMarketingImage(goal.image)}
                    seed={`kitchens-goal-${goal.key}`}
                    label={title}
                    decorative
                    flush
                    className="h-full"
                />
            </View>
            <View className="flex-col gap-1 px-4 pb-4 pt-3">
                <RNText className="font-display text-base font-bold tracking-display text-content-primary text-start">
                    {title}
                </RNText>
                <Eyebrow
                    testID={`kitchens-goal-${goal.key}-count`}
                    tone="brand"
                    className="tabular-nums"
                >
                    {total === null
                        ? t('marketplace:kitchens.finder.goalAction')
                        : t('marketplace:kitchens.finder.goalCount', { count: total })}
                </Eyebrow>
            </View>
        </Pressable>
    );
}

/**
 * The design's `repeat(auto-fill, minmax(Npx, 1fr))`, measured: as many equal columns as fit at
 * `track` pixels each, worked out from the grid's own width rather than the window's, so the shell's
 * gutters and measure are already accounted for. Until the first layout pass it uses `fallback`.
 *
 * Drawn as rows of equal cells (see `toRows`), padded on the last row so every cell keeps the same
 * width. Rows stretch their cells to the tallest, so cards in one row end on one line.
 */
function TrackGrid({
    children,
    track,
    fallback,
    max,
    testID,
}: {
    readonly children: readonly ReactNode[];
    readonly track: number;
    readonly fallback: number;
    readonly max?: number | undefined;
    readonly testID?: string | undefined;
}) {
    const [width, setWidth] = useState<number | null>(null);
    const fit =
        width === null || width === 0
            ? fallback
            : Math.max(1, Math.floor((width + GRID_GAP) / (track + GRID_GAP)));
    const columns = max === undefined ? fit : Math.min(max, fit);
    const rows = toRows(children, columns);

    return (
        <View
            testID={testID}
            className="flex-col gap-4"
            onLayout={(event: LayoutChangeEvent) => {
                setWidth(event.nativeEvent.layout.width);
            }}
        >
            {rows.map((row, rowIndex) => (
                <View key={rowIndex} className="flex-row gap-4">
                    {row}
                    {Array.from({ length: columns - row.length }, (_, index) => (
                        <View key={`pad-${String(index)}`} className="flex-1" />
                    ))}
                </View>
            ))}
        </View>
    );
}
