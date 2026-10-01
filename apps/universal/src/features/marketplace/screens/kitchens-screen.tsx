import { Button, Checkbox, SearchInput, Select, useBreakpoint } from '@healthy360/design-system';
import type {
    CustomerAddress,
    Kitchen,
    KitchenFilter,
    MealFilter,
} from '@healthy360/api-client/contracts';
import { DIET_CLASSIFICATIONS } from '@healthy360/domain-types';
import type { DietClassification, SalesChannel } from '@healthy360/domain-types';
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
import { PillChip } from '../../../ui/pill-chip.tsx';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { useMarketplaceFilters } from '../filter-bar.tsx';
import { KitchenFinderCard } from '../kitchen-finder-card.tsx';
import {
    availableKitchenSorts,
    defaultKitchenSort,
    deliversFast,
    narrowByDiets,
    openToday,
    parseKitchenSort,
    pickSpotlight,
    profileDietsOf,
    sortKitchens,
    toRows,
} from '../kitchen-finder.ts';
import type { KitchenSort } from '../kitchen-finder.ts';
import { KitchenSpotlight } from '../kitchen-spotlight.tsx';
import { QueryStates } from '../query-states.tsx';

/**
 * `/kitchens` — the kitchen finder, HealthZone's `discover` screen (the header's "Kitchens").
 *
 * Top to bottom, as the design draws it: an intro row (eyebrow, two-line display title and lede on
 * the start side; a "Delivering to … / Change" box above the search field on the end side); a sticky
 * filter bar (diet pill chips, a divider, two checkbox toggles, SORT and its select at the end); a
 * canopy spotlight beside a three-photograph mosaic; the kitchen grid; and "Eat by goal". All of it
 * is bound to what the API answers. Where the design's data has no source, the stand-in is described
 * where it is drawn — `kitchen-finder.ts`, `kitchen-finder-card.tsx`, `kitchen-spotlight.tsx`.
 *
 * ## The profile, the address, and who has them
 *
 * A signed-in shopper has a dietary profile and saved addresses on the account API; a visitor has
 * neither. So the lede's preference link, the "best match" order, the cards' DIET MATCH pill and
 * the delivery box read the account when there is one, and say plainly what to do when there is
 * not — "set your preferences", "Sign in to use a saved address" — in the same places and shapes.
 * The eyebrow does not repeat the design's "for 94110": the directory is not narrowed to the
 * shopper's area (an address's area and a zone's label need not match as text — see
 * `CustomerAddress.isDeliverable`), so naming the area there would claim a filter that is not on.
 *
 * ## The search field searches kitchens, by name
 *
 * It writes `?q=`, which this screen sends as `KitchenFilter.query` — the API matches it against the
 * kitchen's name, so the placeholder says "by name" rather than the design's "kitchens or cuisines"
 * (the presenter answers `cuisines: []`, so a cuisine term could never match).
 *
 * ## Which filters exist, and why these
 *
 * - **Diet chips** — the kitchen's own `dietClassifications`, derived from the kitchens the server
 *   query returned, so the row only offers a diet some kitchen cooks. They narrow on the client,
 *   over a directory small enough to be fetched whole ({@link DIRECTORY_LIMIT}).
 * - **"Under 30 min"** — the design's own chip: the fastest advertised delivery, on the client.
 * - **"Collection"** — a sales channel sent to the API. Kept from the first pass as one more chip at
 *   the end of the row rather than a third toggle: the chip row already mixes diets with a delivery
 *   fact and already varies in length with the data, so it costs the bar nothing. The first pass's
 *   "Delivers" toggle is not drawn — nearly every listed kitchen delivers — but `?channel=delivery`
 *   in a shared link is still honoured.
 * - **"Open today" / "Offers plans"** — the design's two toggles. "Open now" is a claim about this
 *   instant in the kitchen's time zone, which `storefront-facts.ts` explains is not reliably
 *   available on native; "today" is what the published hours can answer.
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

/** The whole consumer directory — what the eyebrow counts and the "of N" in the list header. */
const DIRECTORY_FILTER: KitchenFilter = { channels: LISTING_CHANNELS, limit: DIRECTORY_LIMIT };

const GROUP_KEYS = ['channel', 'diet', 'open', 'fast'] as const;
const SORT_KEYS = ['sort'] as const;

/** `?open=today` — the one value the "Open today" toggle writes. */
const OPEN_TODAY = 'today';
/** `?fast=30` — the one value the "Under 30 min" chip writes. */
const FAST = '30';

/** How long a typed term waits before it becomes the URL's `?q=` and a request. */
const SEARCH_DEBOUNCE_MS = 300;

/** The design's grid tracks: `minmax(330px,1fr)` for kitchens, `minmax(220px,1fr)` for goals. */
const KITCHEN_TRACK = 330;
const GOAL_TRACK = 220;
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
 * the generated pattern rather than to nothing. The design's "Clinical plans" tile has no backing
 * classification, so its place is taken by low carb, which does.
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

/** The address the box names: the default one, else the first saved. */
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
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.kitchens', testID: 'kitchens' });

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

    const spotlight = useMemo(
        () => (filters.isFiltered ? null : pickSpotlight(kitchens, profileDiets)),
        [filters.isFiltered, kitchens, profileDiets],
    );

    const loaded = query.data !== undefined;
    const directoryLoaded = directoryQuery.data !== undefined;
    const cookingToday = openToday(directory).length;
    const defaultSort = defaultKitchenSort(profileDiets);

    const sortSelect = (
        <View className="flex-row items-center gap-2">
            <Eyebrow>{t('marketplace:kitchens.finder.sortLabel')}</Eyebrow>
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
    );

    return (
        <View className="flex-col" testID="kitchens-screen">
            {/* The opening: the count, the claim and the lede; the address and the search. */}
            <View
                testID="kitchens-intro"
                className="flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
            >
                <View className="max-w-[640px] flex-col">
                    {/* Announced rather than merely redrawn: the design's eyebrow is a live count. */}
                    <View role="status" aria-live="polite">
                        <Eyebrow testID="kitchens-eyebrow">
                            {!directoryLoaded
                                ? t('marketplace:kitchens.finder.eyebrowPending')
                                : cookingToday > 0
                                  ? t('marketplace:kitchens.finder.eyebrowOpen', {
                                        count: cookingToday,
                                    })
                                  : t('marketplace:kitchens.finder.eyebrowListed', {
                                        count: directory.length,
                                    })}
                        </Eyebrow>
                    </View>
                    <RNText
                        testID="kitchens-title"
                        accessibilityRole="header"
                        aria-level={1}
                        className="mt-3 font-display text-3xl font-bold leading-none tracking-display text-content-primary text-start lg:text-4xl xl:text-5xl"
                    >
                        {t('marketplace:kitchens.finder.title')}
                    </RNText>
                    <ProfileLede
                        signedIn={signedIn}
                        profileDiets={profileDiets}
                        onOpen={() => {
                            router.push((signedIn ? '/customer/account' : '/sign-in') as never);
                        }}
                    />
                </View>
                <View className="w-full flex-col gap-2 lg:w-[360px]">
                    <AddressBox
                        signedIn={signedIn}
                        pending={
                            signedIn && addresses.data === undefined && addresses.error === null
                        }
                        address={deliveryAddress(addresses.data)}
                        onChange={() => {
                            router.push(
                                (signedIn ? '/customer/account/addresses' : '/sign-in') as never,
                            );
                        }}
                    />
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
            </View>

            {/*
             * The filter bar. Sticky on the web against the shell's scroll port — `top-0` pins it
             * just under the marketplace bar, never the design's literal 115px. One row that
             * scrolls sideways on a phone rather than wrapping into a band that eats the screen;
             * the sort sits outside the scroller so its listbox is never clipped by it, and below
             * `md` moves down beside the list's title.
             */}
            <View
                testID="kitchens-filters"
                role="toolbar"
                aria-label={t('marketplace:kitchens.finder.filtersLabel')}
                className="z-10 mt-5 flex-row items-center gap-3 border-b border-stroke bg-surface-base py-3 web:sticky web:top-0"
            >
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="min-w-0 flex-1"
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
                        testID="kitchens-filter-channel-pickup"
                        label={t('marketplace:kitchens.finder.toggle.pickup')}
                        selected={selectedChannels.includes('pickup')}
                        onPress={() => {
                            filters.toggle(
                                'channel',
                                'pickup',
                                !selectedChannels.includes('pickup'),
                            );
                        }}
                    />

                    <View aria-hidden className="mx-1 h-[22px] w-px bg-stroke-strong" />

                    <Checkbox
                        testID="kitchens-filter-open-today"
                        label={t('marketplace:kitchens.finder.toggle.openToday')}
                        checked={onlyOpenToday}
                        onChange={(next) => {
                            filters.select('open', next ? OPEN_TODAY : null);
                        }}
                    />
                    <Checkbox
                        testID="kitchens-filter-channel-subscription"
                        label={t('marketplace:kitchens.finder.toggle.subscription')}
                        checked={selectedChannels.includes('subscription')}
                        onChange={(next) => {
                            filters.toggle('channel', 'subscription', next);
                        }}
                    />
                </ScrollView>
                {atLeast('md') ? <View className="ps-3">{sortSelect}</View> : null}
            </View>

            {spotlight === null ? null : (
                <KitchenSpotlight spotlight={spotlight} profileDiets={profileDiets} />
            )}

            <View
                testID="kitchens-results"
                className="mb-4 mt-8 flex-row flex-wrap items-baseline justify-between gap-3"
            >
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {filters.isFiltered
                        ? t('marketplace:kitchens.finder.listMatching')
                        : t('marketplace:kitchens.finder.listAll')}
                </RNText>
                {loaded && directoryLoaded ? (
                    <Eyebrow testID="kitchens-results-count" className="tabular-nums">
                        {t('marketplace:kitchens.finder.count', {
                            shown: kitchens.length,
                            count: Math.max(directory.length, kitchens.length),
                            sort: t(`marketplace:kitchens.finder.sort.${sort}`),
                        })}
                    </Eyebrow>
                ) : null}
                {atLeast('md') ? null : <View className="w-full">{sortSelect}</View>}
            </View>

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
                    track={KITCHEN_TRACK}
                    fallback={atLeast('xl') ? 3 : atLeast('md') ? 2 : 1}
                >
                    {kitchens.map((kitchen) => (
                        <KitchenFinderCard
                            key={String(kitchen.id)}
                            kitchen={kitchen}
                            onAdd={basket.add}
                            profileDiets={profileDiets}
                        />
                    ))}
                </TrackGrid>
            </QueryStates>

            <View testID="kitchens-goals" className="mt-10 flex-col gap-4">
                <View
                    testID="kitchens-goals-header"
                    className="flex-row flex-wrap items-baseline justify-between gap-2"
                >
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
                    >
                        {t('marketplace:kitchens.finder.goalsTitle')}
                    </RNText>
                    <Eyebrow>{t('marketplace:kitchens.finder.goalsMeta')}</Eyebrow>
                </View>
                <TrackGrid
                    track={GOAL_TRACK}
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

            {basket.dialog}
        </View>
    );
}

/**
 * The lede: "Matched against your profile — high protein · vegan. Every dish lists …", the diets
 * a link to where they are set. Without a profile it says so in the same sentence and the link
 * reads "set your preferences" — to the account for a shopper, to sign-in for a visitor.
 */
function ProfileLede({
    signedIn,
    profileDiets,
    onOpen,
}: {
    readonly signedIn: boolean;
    readonly profileDiets: readonly DietClassification[];
    readonly onOpen: () => void;
}) {
    const { t } = useTranslation();
    const hasProfile = signedIn && profileDiets.length > 0;
    const link = hasProfile
        ? profileDiets
              .map((diet) => t(`marketplace:diets.${diet}`).toLocaleLowerCase())
              .join(t('marketplace:kitchens.areaSeparator'))
        : t('marketplace:kitchens.finder.ledeSetPreferences');

    return (
        <RNText
            testID="kitchens-lede"
            className="mt-2.5 max-w-[540px] text-base leading-relaxed text-content-secondary text-start"
        >
            {hasProfile
                ? t('marketplace:kitchens.finder.ledeMatched')
                : t('marketplace:kitchens.finder.ledeUnmatched')}
            <RNText
                testID="kitchens-lede-preferences"
                role="link"
                accessibilityRole="link"
                onPress={onOpen}
                className="font-semibold text-content-on-brand-subtle"
            >
                {link}
            </RNText>
            {t('marketplace:kitchens.finder.ledeTail')}
        </RNText>
    );
}

/**
 * "Delivering to 1420 Valencia St · Change". The shopper's default saved address (else the first),
 * with Change opening the address book; with none saved, an "Add" in the same place; for a visitor,
 * a sign-in in the same place — nothing here invents an address.
 */
function AddressBox({
    signedIn,
    pending,
    address,
    onChange,
}: {
    readonly signedIn: boolean;
    readonly pending: boolean;
    readonly address: CustomerAddress | null;
    readonly onChange: () => void;
}) {
    const { t } = useTranslation();
    const value = !signedIn
        ? null
        : pending
          ? t('marketplace:kitchens.finder.addressPending')
          : address === null
            ? t('marketplace:kitchens.finder.addressNone')
            : address.line1;
    const action = !signedIn
        ? t('marketplace:kitchens.finder.addressSignIn')
        : address === null
          ? t('marketplace:kitchens.finder.addressAdd')
          : t('marketplace:kitchens.finder.addressChange');

    return (
        <View
            testID="kitchens-address"
            className="flex-row items-center justify-between gap-2.5 rounded-lg border border-stroke-strong bg-surface-raised px-3.5"
        >
            <RNText
                testID="kitchens-address-value"
                numberOfLines={1}
                className="min-w-0 shrink py-2.5 text-sm text-content-secondary text-start"
            >
                {value === null ? (
                    t('marketplace:kitchens.finder.addressSignedOut')
                ) : (
                    <>
                        {t('marketplace:kitchens.finder.deliveringTo')}
                        <RNText className="font-semibold text-content-primary">{value}</RNText>
                    </>
                )}
            </RNText>
            {pending ? null : (
                <Pressable
                    testID="kitchens-address-change"
                    role="link"
                    accessibilityRole="link"
                    onPress={onChange}
                    className="min-h-touch justify-center"
                >
                    <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                        {action}
                    </RNText>
                </Pressable>
            )}
        </View>
    );
}

/** One "Eat by goal" tile — photograph, title, line, and the real meal count where the API has one. */
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
                <RNText className="text-sm leading-normal text-content-secondary text-start">
                    {t(`marketplace:kitchens.finder.goal.${goal.key}.body`)}
                </RNText>
                <Eyebrow
                    testID={`kitchens-goal-${goal.key}-count`}
                    tone="brand"
                    className="mt-1 tabular-nums"
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
