import { Button, Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { CustomerAddress, Kitchen, KitchenFilter } from '@healthy360/api-client/contracts';
import { neutral } from '@healthy360/design-tokens';
import { DIET_CLASSIFICATIONS } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { useAddressesQuery, useDietaryProfileQuery } from '../../../data/account-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import {
    useCurrentHref,
    useGoToAuth,
    useRememberQuery,
} from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { InkSortMenu } from '../../../ui/ink-sort-menu.tsx';
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
 * As the accepted shop board draws it: the title, a count pill and where the food goes on one line;
 * one white bar — the search, the filters as chips, the sort — pinned while the grid scrolls; and the
 * kitchens three across (`kitchen-finder-card.tsx`), each with its own Quick look.
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

/** The board's three-across grid: `minmax(340px,1fr)` cells, as many as fit. */
const TRACK = 340;
/** The board's 22px gutter, in the unit the measured width comes back in. */
const GRID_GAP = 22;

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
    const here = useCurrentHref();
    const goToAuth = useGoToAuth();
    const { atLeast } = useBreakpoint();
    const { me } = useSession();
    const signedIn = me !== null;
    const wide = atLeast('lg');
    const [searchFocused, setSearchFocused] = useState(false);
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const sorting = useMarketplaceFilters(SORT_KEYS);
    // The search, chips and sort, so a storefront's "Kitchens" crumb comes back to the directory
    // as it was left rather than to the bare list (browse-05).
    useRememberQuery();

    // The account answers only for a signed-in shopper; a visitor's page never asks.
    const profile = useDietaryProfileQuery(signedIn);
    const addresses = useAddressesQuery(signedIn);
    const profileDiets = useMemo(
        () => (signedIn ? profileDietsOf(profile.data?.dietCategoryCode) : []),
        [signedIn, profile.data],
    );

    const { query: searchTerm, selected, setQuery } = filters;

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

    // A sort or a chip with no data behind it stays off the page until there is some.
    const hasRatings = useMemo(
        () => directory.some((kitchen) => kitchen.rating !== null),
        [directory],
    );
    const anyFast = useMemo(() => deliversFast(directory).length > 0, [directory]);
    const rawSort = sorting.selected['sort']?.[0];
    const sort = useMemo(
        () => parseKitchenSort(rawSort, profileDiets, hasRatings),
        [rawSort, profileDiets, hasRatings],
    );

    const kitchens = useMemo(() => {
        const byDiet = narrowByDiets(listed, selectedDiets);
        const bySpeed = onlyFast ? deliversFast(byDiet) : byDiet;
        const byHours = onlyOpenToday ? openToday(bySpeed) : bySpeed;
        return sortKitchens(byHours, sort, profileDiets);
    }, [listed, selectedDiets, onlyFast, onlyOpenToday, sort, profileDiets]);

    const loaded = query.data !== undefined && directoryQuery.data !== undefined;
    const total = Math.max(directory.length, kitchens.length);
    const defaultSort = defaultKitchenSort(profileDiets, hasRatings);

    const toggleChannel = (channel: SalesChannel) => {
        filters.toggle('channel', channel, !selectedChannels.includes(channel));
    };

    return (
        <View className="flex-col pb-11" testID="kitchens-screen">
            {/* The title, the count and where the food goes, on one line. */}
            <View testID="kitchens-header" className="flex-row flex-wrap items-center gap-3.5 pt-1">
                <RNText
                    testID="kitchens-header-title"
                    role="heading"
                    aria-level={1}
                    className="font-display text-3xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('marketplace:kitchens.title')}
                </RNText>
                {loaded ? (
                    <View className="h-[30px] justify-center rounded-full bg-surface-brand-subtle px-3">
                        <RNText
                            testID="kitchens-results-count"
                            className="text-sm font-medium tabular-nums text-content-on-brand-subtle"
                        >
                            {kitchens.length === total
                                ? t('marketplace:kitchens.finder.count', { count: total })
                                : t('marketplace:kitchens.finder.countOf', {
                                      shown: kitchens.length,
                                      count: total,
                                  })}
                        </RNText>
                    </View>
                ) : null}
                <AddressControl
                    signedIn={signedIn}
                    pending={signedIn && addresses.data === undefined && addresses.error === null}
                    address={deliveryAddress(addresses.data)}
                    onPress={() => {
                        // Signed out, "Add address" starts with signing in, and comes back here
                        // (AUTH-14). Signed in with none, it opens the form and comes back here;
                        // with one, it is a change, made on the account page.
                        if (!signedIn) {
                            goToAuth('/sign-in');
                        } else if (deliveryAddress(addresses.data) === null) {
                            router.push(
                                withReturnTo('/customer/account/addresses/new', here) as never,
                            );
                        } else {
                            router.push('/customer/account?section=addresses' as never);
                        }
                    }}
                />
            </View>

            {/*
             * One white bar — the search, the filters as chips, the sort — pinned on the web against
             * the shell's scroll port while the grid scrolls. The chips scroll sideways rather than
             * wrapping; the sort sits outside that scroller so its list is never clipped by it.
             */}
            <View className="z-10 bg-surface-base pb-2 pt-4 web:sticky web:top-0">
                <View
                    testID="kitchens-filters"
                    role="toolbar"
                    aria-label={t('marketplace:kitchens.finder.filtersLabel')}
                    className={cx(
                        'z-auto rounded-3xl border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-2',
                        wide ? 'flex-row items-center gap-1.5' : 'flex-col gap-2',
                    )}
                >
                    <View
                        className={cx(
                            'h-[52px] flex-row items-center gap-2 rounded-2xl border-2 bg-surface-base px-4',
                            searchFocused ? 'border-surface-brand-subtle' : 'border-transparent',
                            wide ? 'min-w-[200px] flex-1 basis-[240px]' : 'w-full',
                        )}
                    >
                        <Icon name="search" size="sm" className="text-content-secondary" />
                        <TextInput
                            testID="kitchens-search-input"
                            accessibilityLabel={t('marketplace:kitchens.finder.searchLabel')}
                            placeholder={t('marketplace:kitchens.finder.searchPlaceholder')}
                            placeholderTextColor={neutral[600]}
                            value={draft}
                            onChangeText={setDraft}
                            onSubmitEditing={() => {
                                setQuery(draft.trim());
                            }}
                            onFocus={() => {
                                setSearchFocused(true);
                            }}
                            onBlur={() => {
                                setSearchFocused(false);
                            }}
                            returnKeyType="search"
                            autoCapitalize="none"
                            autoCorrect={false}
                            className="h-full min-w-0 flex-1 text-sm text-content-primary text-start web:outline-none"
                        />
                    </View>
                    {wide ? <View aria-hidden className="mx-1.5 h-[30px] w-px bg-stroke" /> : null}
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        className={wide ? 'shrink' : 'w-full'}
                        contentContainerClassName="flex-row items-center gap-1"
                    >
                        {dietOptions.map((diet) => {
                            const on = selectedDiets.includes(diet);
                            return (
                                <KitchenChip
                                    key={diet}
                                    testID={`kitchens-filter-diet-${diet}`}
                                    icon="leaf"
                                    label={t(`marketplace:diets.${diet}`)}
                                    selected={on}
                                    onPress={() => {
                                        filters.toggle('diet', diet, !on);
                                    }}
                                />
                            );
                        })}
                        <KitchenChip
                            testID="kitchens-filter-open-today"
                            icon="clock"
                            label={t('marketplace:kitchens.finder.toggle.openToday')}
                            selected={onlyOpenToday}
                            onPress={() => {
                                filters.select('open', onlyOpenToday ? null : OPEN_TODAY);
                            }}
                        />
                        {anyFast || onlyFast ? (
                            <KitchenChip
                                testID="kitchens-filter-fast"
                                icon="bike"
                                label={t('marketplace:kitchens.finder.under30')}
                                selected={onlyFast}
                                onPress={() => {
                                    filters.select('fast', onlyFast ? null : FAST);
                                }}
                            />
                        ) : null}
                        <KitchenChip
                            testID="kitchens-filter-channel-subscription"
                            icon="calendarDays"
                            label={t('marketplace:kitchens.finder.toggle.subscription')}
                            selected={selectedChannels.includes('subscription')}
                            onPress={() => {
                                toggleChannel('subscription');
                            }}
                        />
                        <KitchenChip
                            testID="kitchens-filter-channel-pickup"
                            icon="store"
                            label={t('marketplace:kitchens.finder.toggle.pickup')}
                            selected={selectedChannels.includes('pickup')}
                            onPress={() => {
                                toggleChannel('pickup');
                            }}
                        />
                    </ScrollView>
                    <View className={cx('z-auto', wide ? 'ms-auto' : 'self-start')}>
                        <InkSortMenu<KitchenSort>
                            testID="kitchens-sort"
                            label={t('marketplace:kitchens.finder.sortFieldLabel')}
                            accessibilityLabel={t('catalogue:filters.sortCurrent', {
                                label: t('marketplace:kitchens.finder.sortFieldLabel'),
                                value: t(`marketplace:kitchens.finder.sort.${sort}`),
                            })}
                            value={sort}
                            options={availableKitchenSorts(profileDiets, hasRatings).map(
                                (option) => ({
                                    value: option,
                                    label: t(`marketplace:kitchens.finder.sort.${option}`),
                                }),
                            )}
                            onChange={(next) => {
                                sorting.select('sort', next === defaultSort ? null : next);
                            }}
                        />
                    </View>
                </View>
            </View>

            <View className="mt-5">
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
                        fallback={atLeast('lg') ? 3 : atLeast('sm') ? 2 : 1}
                    >
                        {kitchens.map((kitchen) => (
                            <KitchenFinderCard key={String(kitchen.id)} kitchen={kitchen} />
                        ))}
                    </TrackGrid>
                </QueryStates>
            </View>
        </View>
    );
}

/** One filter chip on the bar: an icon in its own square, the label, a soft fill when on. */
function KitchenChip({
    testID,
    icon,
    label,
    selected,
    onPress,
}: {
    readonly testID: string;
    readonly icon: IconName;
    readonly label: string;
    readonly selected: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            aria-pressed={selected}
            accessibilityState={{ selected }}
            onPress={onPress}
            className={cx(
                'h-[52px] flex-row items-center gap-2 rounded-2xl pe-3 ps-2 transition duration-normal ease-standard active:scale-95',
                selected ? 'bg-surface-brand-subtle' : 'hover:bg-surface-base',
            )}
        >
            <View
                className={cx(
                    'h-8 w-8 items-center justify-center rounded-[11px]',
                    selected ? 'bg-surface-brand' : 'bg-surface-base',
                )}
            >
                <Icon
                    name={icon}
                    size="sm"
                    className={selected ? 'text-content-on-brand' : 'text-content-secondary'}
                />
            </View>
            <RNText
                numberOfLines={1}
                className={cx(
                    'text-sm font-semibold',
                    selected ? 'text-content-on-brand-subtle' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/**
 * Where the food goes, at the end of the title row: a pin and "Delivering to Home · Antelias", or
 * "Add address" for a shopper with none and for a visitor. One press, to the address book or to
 * sign-in. Nothing here invents an address.
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
          ? t('marketplace:kitchens.finder.addressName', {
                label: address.label,
                area: address.areaName,
            })
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
            className="ms-auto min-h-touch flex-row items-center gap-2 rounded-full px-2 hover:bg-surface-brand-subtle"
        >
            <Icon name="mapPin" size="sm" className="text-content-secondary" />
            {value === null ? null : (
                <RNText className="text-sm text-content-secondary">
                    {t('marketplace:kitchens.finder.deliveringPrefix')}
                </RNText>
            )}
            <RNText
                testID="kitchens-address-value"
                numberOfLines={1}
                className={cx(
                    'max-w-[260px] text-sm font-semibold text-start',
                    value === null ? 'text-content-on-brand-subtle' : 'text-content-primary',
                )}
            >
                {value ?? t('marketplace:kitchens.finder.addressAdd')}
            </RNText>
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
            className="flex-col gap-[22px]"
            onLayout={(event: LayoutChangeEvent) => {
                setWidth(event.nativeEvent.layout.width);
            }}
        >
            {rows.map((row, rowIndex) => (
                <View key={rowIndex} className="flex-row gap-[22px]">
                    {row}
                    {Array.from({ length: columns - row.length }, (_, index) => (
                        <View key={`pad-${String(index)}`} className="flex-1" />
                    ))}
                </View>
            ))}
        </View>
    );
}
