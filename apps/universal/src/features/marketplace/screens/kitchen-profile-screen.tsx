import { HideShellTopbar, cx, useBreakpoint } from '@healthy360/design-system';
import type { Kitchen, MarketplaceMeal, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { mealsFromPages, useMealsQuery, usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { useNavigateUp, useRememberQuery } from '../../../navigation/use-return-to.ts';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { QueryStates } from '../query-states.tsx';
import { ShopStateButton } from '../../../ui/shop-state.tsx';
import { isoWeekdayToday } from '../storefront-facts.ts';
import { StorefrontCanopy } from '../storefront/storefront-canopy.tsx';
import { latestCutOffToday } from '../storefront/storefront-menu.ts';
import { StorefrontMenuTab } from '../storefront/storefront-menu-tab.tsx';
import { StorefrontOrderPanel } from '../storefront/storefront-order-panel.tsx';
import { StorefrontPlansTab } from '../storefront/storefront-plans-tab.tsx';
import { StorefrontReviewsTab } from '../storefront/storefront-reviews-tab.tsx';
import { StorefrontSafetyTab } from '../storefront/storefront-safety-tab.tsx';
import { StorefrontTabs } from '../storefront/storefront-tabs.tsx';
import { StorefrontTodayTab } from '../storefront/storefront-today-tab.tsx';
import { kitchenTimeZone, useKitchenClock } from '../storefront/storefront-today.ts';

/**
 * One kitchen's storefront — HealthZone Customer `§isStorefront`.
 *
 * The cover (`StorefrontCanopy`) with its way back to the kitchens, a sticky tab row, then the open
 * tab beside the 330px order panel from `lg` up — the accepted shop board's storefront.
 *
 * ## The design's five tabs, each from what is real
 *
 * | Design tab           | Here                                                                 |
 * | -------------------- | -------------------------------------------------------------------- |
 * | Menu                 | The whole menu, by the kitchen's own shelves (`StorefrontMenuTab`).  |
 * | Today in the kitchen | The day the kitchen publishes — opening, cut-off, delivery windows — |
 * |                      | against its own clock. Production progress is not public, and its    |
 * |                      | card says so (`StorefrontTodayTab`).                                 |
 * | Plans                | `listPlans({ kitchenIds })`; an honest empty card for a kitchen that |
 * |                      | sells none.                                                          |
 * | Safety & allergens   | The menu's own allergen declarations, its diets, the disclaimer.     |
 * | Reviews              | The kitchen's average and count; no endpoint lists a written review  |
 * |                      | or a star distribution, so those read empty (`StorefrontReviewsTab`).|
 *
 * The tabs are in-page rather than routes — they are views of one kitchen, and switching them must
 * not cost a navigation — but the open one is mirrored to `?tab=` so a link can open the storefront
 * on its plans (the kitchen directory's "Plans" control does exactly that) and a reload keeps it.
 * The Menu tab's shelf is mirrored the same way, to `?shelf=` (browse-07): Back from a dish, a
 * reload or a trip to another tab used to drop the person on "All" again, because the shelf was
 * the tab panel's own state and both the page and the panel unmount on the way.
 *
 * ## The menu is read whole
 *
 * The shelf chips count dishes and the safety tab tallies allergens, and both are claims about the
 * whole kitchen. Counted over the first page of a paged list they are claims about part of it — and
 * "nothing here contains sesame" read off twenty-five of sixty dishes is the expensive kind of
 * wrong. So the storefront asks for the largest page the API serves and keeps fetching until there
 * is no next one, and neither tab renders until it has the lot.
 *
 * `/kitchens/{id}/menu` still exists as the searchable view — the search box and the item-type and
 * meal-type filters the Menu tab does not carry — and the Menu tab links to it by name, "Search
 * this menu", so the control says what it opens.
 *
 * ## The order panel's place on a phone
 *
 * Beside the tabs from `lg` up, sticky under them as the body scrolls. Below `lg` there is no
 * "beside", and the panel goes between the hero and the tabs: the minimum order and the fee are what
 * someone needs to know before they start adding dishes, not after the last one.
 */
export interface KitchenProfileScreenProps {
    /** Raw route parameter. `undefined` on the first frame of a deep link. */
    readonly kitchenId: string | undefined;
}

export function KitchenProfileScreen({ kitchenId }: KitchenProfileScreenProps) {
    const { t } = useTranslation();
    const navigateUp = useNavigateUp();
    // The open tab and shelf, for a meal's "{Kitchen}" crumb to come back to (browse-05).
    useRememberQuery();

    // An id or a slug: the server takes either, and refusing the slug here left the page loading.
    const requested =
        kitchenId === undefined || kitchenId === '' ? null : KitchenId.unsafe(kitchenId);
    const query = useKitchenQuery(requested);
    const kitchen = query.data;

    return (
        <View className="flex-col gap-3" testID="kitchen-profile-screen">
            <QueryStates
                query={query}
                isEmpty={query.data === undefined && !query.isPending}
                emptyTitle={t('marketplace:kitchen.notFoundTitle')}
                emptyBody={t('marketplace:kitchen.notFoundBody')}
                emptyIcon="store"
                emptyActions={
                    <ShopStateButton
                        testID="kitchen-browse"
                        icon="arrowForward"
                        iconAfter
                        label={t('marketplace:kitchen.browseKitchens')}
                        onPress={() => {
                            navigateUp('/kitchens');
                        }}
                    />
                }
                // Shop · Kitchens + storefront, pin 6: a kitchen that is gone is "not on the
                // marketplace", not "something went wrong".
                treatFailuresAsEmpty={['resource.not_found']}
                skeleton="page"
                skeletonCount={2}
                testID="kitchen"
            >
                {kitchen === undefined ? null : (
                    <Storefront
                        kitchen={kitchen}
                        onBack={() => {
                            // Up to the directory as it was left — its search and chips — rather
                            // than a fresh copy pushed on top of the storefront.
                            navigateUp('/kitchens');
                        }}
                    />
                )}
            </QueryStates>
        </View>
    );
}

const STOREFRONT_TABS = ['menu', 'today', 'plans', 'safety', 'reviews'] as const;
type StorefrontTab = (typeof STOREFRONT_TABS)[number];

function isStorefrontTab(value: string | undefined): value is StorefrontTab {
    return (STOREFRONT_TABS as readonly string[]).includes(value ?? '');
}

/** The largest page the marketplace serves (`CursorPage::MAX_LIMIT`). */
const MENU_PAGE_SIZE = 100;

function Storefront({
    kitchen,
    onBack,
}: {
    readonly kitchen: Kitchen;
    readonly onBack: () => void;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    // Shop · Kitchens, phone board: the cover to the screen's edges, no shop bar, a docked order bar.
    const phone = !atLeast('md');
    const params = useLocalSearchParams<{ tab?: string; shelf?: string }>();
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.kitchens', testID: 'kitchen' });

    // An unknown `?tab=` opens the menu.
    const requested: StorefrontTab = isStorefrontTab(params.tab) ? params.tab : 'menu';
    const [tab, setTab] = useState<StorefrontTab>(requested);
    // Follow the URL when it changes underneath the page — a link to this kitchen's plans pressed
    // while its menu is open. Adjusted during render rather than in an effect, so the page never
    // paints one frame of the old tab.
    const [followed, setFollowed] = useState<StorefrontTab>(requested);
    if (followed !== requested) {
        setFollowed(requested);
        setTab(requested);
    }
    const openTab = (next: StorefrontTab) => {
        setTab(next);
        router.setParams({ tab: next });
    };

    /*
     * The Menu tab's shelf, the same way: the URL holds it and the page follows it (browse-07).
     * Held here, not in the tab, because the tab panel unmounts on every switch. "All" is the
     * param's absence, so the plain storefront link and a cleared shelf are one address.
     */
    const requestedShelf =
        typeof params.shelf === 'string' && params.shelf !== '' ? params.shelf : null;
    const [shelf, setShelf] = useState<string | null>(requestedShelf);
    const [followedShelf, setFollowedShelf] = useState<string | null>(requestedShelf);
    if (followedShelf !== requestedShelf) {
        setFollowedShelf(requestedShelf);
        setShelf(requestedShelf);
    }
    const openShelf = (next: string | null) => {
        setShelf(next);
        router.setParams({ shelf: next ?? undefined } as never);
    };

    // The kitchen's own clock and day: what "today", the cut-off and the countdown are read in.
    const timeZone = kitchenTimeZone(kitchen);
    const { clock, now } = useKitchenClock(timeZone);
    const weekday = clock?.weekday ?? isoWeekdayToday(now);
    const cutOff = latestCutOffToday(kitchen, weekday);
    // Only with a resolved clock is the zone known to format in; otherwise the date is left out
    // rather than stated in the viewer's zone.
    const dateLabel =
        clock === null || timeZone === null
            ? null
            : formatter.formatDate(now, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                  timeZone,
              });

    const menu = useMealsQuery({ kitchenIds: [kitchen.id], limit: MENU_PAGE_SIZE });
    const meals = mealsFromPages(menu.data?.pages);
    const { hasNextPage, isFetchingNextPage, fetchNextPage, error: menuError } = menu;

    // Page through to the end — see "The menu is read whole" above. A failed page stops the loop
    // and is reported by `QueryStates` rather than retried here forever.
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && menuError === null) {
            void fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, menuError]);

    // Still paging counts as still loading, so neither tab draws a partial count.
    const menuState = {
        data: menu.data,
        error: menu.error,
        isFetching: menu.isFetching,
        refetch: menu.refetch,
        isPending: menu.isPending || (hasNextPage && menuError === null),
    };

    const openMeal = (meal: MarketplaceMeal) => {
        router.push(`/meals/${String(meal.id)}` as never);
    };
    const openSearchableMenu = () => {
        router.push(`/kitchens/${String(kitchen.id)}/menu` as never);
    };

    const orderPanel = (
        <StorefrontOrderPanel
            kitchen={kitchen}
            meals={meals}
            cutOff={cutOff}
            clock={clock}
            phone={phone}
        />
    );

    const panels: Record<StorefrontTab, ReactNode> = {
        menu: (
            <QueryStates
                query={menuState}
                isEmpty={meals.length === 0}
                emptyTitle={t('marketplace:storefront.menu.emptyTitle')}
                emptyBody={t('marketplace:storefront.menu.emptyBody')}
                emptyIcon="store"
                emptyActions={
                    <ShopStateButton
                        testID="kitchen-menu-browse"
                        icon="arrowForward"
                        iconAfter
                        label={t('marketplace:kitchen.browseKitchens')}
                        onPress={() => {
                            onBack();
                        }}
                    />
                }
                testID="kitchen-menu"
            >
                <StorefrontMenuTab
                    meals={meals}
                    cutOff={cutOff}
                    shelf={shelf}
                    onShelfChange={openShelf}
                    onOpen={openMeal}
                    onAdd={basket.add}
                    onSearch={openSearchableMenu}
                />
            </QueryStates>
        ),
        today: (
            <StorefrontTodayTab
                kitchen={kitchen}
                clock={clock}
                weekday={weekday}
                dateLabel={dateLabel}
                cutOff={cutOff}
            />
        ),
        plans: <KitchenPlans kitchen={kitchen} />,
        safety: (
            <QueryStates
                skeleton="rows"
                query={menuState}
                isEmpty={false}
                emptyTitle={t('marketplace:storefront.menu.emptyTitle')}
                testID="kitchen-safety"
            >
                <StorefrontSafetyTab kitchen={kitchen} meals={meals} />
            </QueryStates>
        ),
        reviews: <StorefrontReviewsTab kitchen={kitchen} />,
    };

    return (
        <View className="flex-col">
            {phone ? <HideShellTopbar /> : null}
            <StorefrontCanopy
                kitchen={kitchen}
                onBack={onBack}
                onSeePlans={() => {
                    openTab('plans');
                }}
            />

            {wide ? null : phone ? orderPanel : <View className="mt-5">{orderPanel}</View>}

            {/*
             * Sticky on the web, under the shell's top bar: `top-0` resolves against the shell's
             * scroll port, not the document. The page surface behind it so the dishes scrolling
             * underneath do not show through the row.
             */}
            <View
                className={cx(
                    'z-sticky bg-surface-base web:sticky web:top-0',
                    phone ? '-mx-4 mt-3 px-4' : 'mt-5 pb-1',
                )}
            >
                <StorefrontTabs<StorefrontTab>
                    testID="kitchen-tabs"
                    label={t('marketplace:storefront.tabs.label')}
                    value={tab}
                    onChange={openTab}
                    items={STOREFRONT_TABS.map((value) => ({
                        value,
                        label: t(`marketplace:storefront.tabs.${value}`),
                        // The dishes on the menu, once the whole menu is in.
                        ...(value === 'menu' && !menuState.isPending
                            ? { count: formatter.formatNumber(meals.length) }
                            : {}),
                        testID: `kitchen-tab-${value}`,
                    }))}
                />
            </View>

            <View
                className={cx(
                    'flex-col gap-6 lg:flex-row lg:items-start',
                    phone ? 'mt-3.5' : 'mt-[22px]',
                )}
            >
                <View
                    testID={`kitchen-panel-${tab}`}
                    role="tabpanel"
                    aria-label={t(`marketplace:storefront.tabs.${tab}`)}
                    className="min-w-0 flex-1"
                >
                    {panels[tab]}
                </View>

                {wide ? (
                    /*
                     * The design's 320 rather than a share of the row: the panel is a column of
                     * label/value pairs, and one that grows with the viewport puts each label and
                     * its figure at opposite ends of a very wide line. Sticky below the tab row —
                     * `top-16` clears the row's height, so the two never overlap.
                     */
                    <View className="w-[330px] shrink-0 self-start web:sticky web:top-20">
                        {orderPanel}
                    </View>
                ) : null}
            </View>

            {basket.dialog}
        </View>
    );
}

/**
 * The Plans tab's body. Its own component so the plan listing is asked for only when somebody opens
 * the tab — `usePlansQuery` has no `enabled` switch, and a storefront visit that never looks at
 * plans should not cost a request for them. A kitchen not configured to sell plans is not asked at
 * all: its card states there are none.
 */
function KitchenPlans({ kitchen }: { readonly kitchen: Kitchen }) {
    const router = useRouter();
    const openHowPlansWork = () => {
        router.push('/plans/how-it-works' as never);
    };
    const choose = (plan: SubscriptionPlan) => {
        router.push(`/plans/${String(plan.id)}` as never);
    };

    if (!kitchen.channels.subscription) {
        return (
            <StorefrontPlansTab
                kitchenName={kitchen.name}
                plans={[]}
                onChoose={choose}
                onHowPlansWork={openHowPlansWork}
            />
        );
    }
    return <SoldPlans kitchen={kitchen} onChoose={choose} onHowPlansWork={openHowPlansWork} />;
}

/**
 * The listing for a kitchen that sells plans. The answer is filtered to this kitchen again on the
 * way in: the filter asks the API for one kitchen, and a row for another kitchen on this kitchen's
 * page would be the worse failure if a repository ever ignored it.
 */
function SoldPlans({
    kitchen,
    onChoose,
    onHowPlansWork,
}: {
    readonly kitchen: Kitchen;
    readonly onChoose: (plan: SubscriptionPlan) => void;
    readonly onHowPlansWork: () => void;
}) {
    const { t } = useTranslation();
    const plans = usePlansQuery({ kitchenIds: [kitchen.id] });
    const kitchenPlans = (plans.data?.items ?? []).filter((plan) => plan.kitchenId === kitchen.id);

    return (
        <QueryStates
            skeleton="plans"
            query={plans}
            isEmpty={false}
            emptyTitle={t('marketplace:storefront.plans.empty')}
            testID="kitchen-plans"
        >
            <StorefrontPlansTab
                kitchenName={kitchen.name}
                plans={kitchenPlans}
                onChoose={onChoose}
                onHowPlansWork={onHowPlansWork}
            />
        </QueryStates>
    );
}
