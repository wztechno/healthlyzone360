import { Breadcrumbs, useBreakpoint } from '@healthy360/design-system';
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
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { QueryStates } from '../query-states.tsx';
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
 * The breadcrumb, the canopy band (`StorefrontCanopy`), a sticky tab row, then the open tab beside
 * the 320px order panel from `lg` up.
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
 *
 * ## The menu is read whole
 *
 * The shelf chips count dishes and the safety tab tallies allergens, and both are claims about the
 * whole kitchen. Counted over the first page of a paged list they are claims about part of it — and
 * "nothing here contains sesame" read off twenty-five of sixty dishes is the expensive kind of
 * wrong. So the storefront asks for the largest page the API serves and keeps fetching until there
 * is no next one, and neither tab renders until it has the lot.
 *
 * ## `/kitchens/{id}/menu` still exists
 *
 * It is the searchable view — the search box and the item-type and meal-type filters the Menu tab
 * does not carry. HealthZone draws no search on the storefront, so "Start an order" is the way in:
 * it is the one control the design gives for beginning to order, and the searchable menu is where
 * ordering from this kitchen starts.
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
    const router = useRouter();

    const parsed = kitchenId === undefined ? null : KitchenId.safeParse(kitchenId);
    const query = useKitchenQuery(parsed);
    const kitchen = query.data;

    return (
        <View className="flex-col gap-3" testID="kitchen-profile-screen">
            <Breadcrumbs
                testID="kitchen-breadcrumbs"
                items={[
                    {
                        key: 'kitchens',
                        label: t('marketplace:nav.kitchens'),
                        onPress: () => {
                            router.push('/kitchens');
                        },
                    },
                    { key: 'kitchen', label: kitchen?.name ?? t('marketplace:kitchen.loading') },
                ]}
            />

            <QueryStates
                query={query}
                isEmpty={query.data === undefined && !query.isPending}
                emptyTitle={t('marketplace:kitchen.notFoundTitle')}
                emptyBody={t('marketplace:kitchen.notFoundBody')}
                skeletonCount={2}
                testID="kitchen"
            >
                {kitchen === undefined ? null : <Storefront kitchen={kitchen} />}
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

function Storefront({ kitchen }: { readonly kitchen: Kitchen }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    const params = useLocalSearchParams<{ tab?: string }>();
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
    const openFullMenu = () => {
        router.push(`/kitchens/${String(kitchen.id)}/menu` as never);
    };

    const orderPanel = (
        <StorefrontOrderPanel
            kitchen={kitchen}
            cutOff={cutOff}
            clock={clock}
            onStartOrder={openFullMenu}
            onSeePlans={() => {
                openTab('plans');
            }}
        />
    );

    const panels: Record<StorefrontTab, ReactNode> = {
        menu: (
            <QueryStates
                query={menuState}
                isEmpty={meals.length === 0}
                emptyTitle={t('marketplace:storefront.menu.emptyTitle')}
                emptyBody={t('marketplace:storefront.menu.emptyBody')}
                testID="kitchen-menu"
            >
                <StorefrontMenuTab
                    meals={meals}
                    cutOff={cutOff}
                    onOpen={openMeal}
                    onAdd={basket.add}
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
                onPickFromMenu={() => {
                    openTab('menu');
                }}
            />
        ),
        plans: <KitchenPlans kitchen={kitchen} />,
        safety: (
            <QueryStates
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
            <StorefrontCanopy kitchen={kitchen} />

            {wide ? null : <View className="mt-5">{orderPanel}</View>}

            {/*
             * Sticky on the web, under the shell's top bar: `top-0` resolves against the shell's
             * scroll port, not the document. The page surface behind it so the dishes scrolling
             * underneath do not show through the row.
             */}
            <View className="z-sticky mt-5 bg-surface-base web:sticky web:top-0">
                <StorefrontTabs<StorefrontTab>
                    testID="kitchen-tabs"
                    label={t('marketplace:storefront.tabs.label')}
                    value={tab}
                    onChange={openTab}
                    items={STOREFRONT_TABS.map((value) => ({
                        value,
                        label: t(`marketplace:storefront.tabs.${value}`),
                        testID: `kitchen-tab-${value}`,
                    }))}
                />
            </View>

            <View className="mt-6 flex-col gap-6 lg:flex-row lg:items-start">
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
                    <View className="w-[320px] shrink-0 self-start web:sticky web:top-16">
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
