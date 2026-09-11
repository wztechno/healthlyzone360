import { Badge } from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useReviewQueueQuery } from '../../data/kitchen-admin-hooks.ts';
import { useConsumptionExceptionCountQuery } from '../../data/kitchen-ops-hooks.ts';
import { permittedNavigation } from '../../navigation/items.ts';
import { useAccessState } from '../../session/session-provider.tsx';
import { OVERVIEW_HREF, isKitchenNavActive, kitchenNavSections } from './kitchen-nav.ts';
import { buildReviewQueue } from './review-queue.ts';

/**
 * The kitchen area's sidebar: the family rail.
 *
 * `kitchenNavSections()` existed before this file and fed only the breadcrumbs; this is the rail
 * it was written for. Everything here derives from the same registry the hub cards and the
 * `<Gate>`s read, so a destination is offered exactly when its screen would open. Imported only by
 * `app/kitchen/_layout.tsx` — the chrome ships with the kitchen area, not with the entry bundle.
 */

/** KITCHEN.md sidebar spec: the family rail is 232px. */
export const KITCHEN_SIDEBAR_WIDTH = 232;

/**
 * The canopy gradient behind the rail, over the shell's flat `surface-canopy`.
 *
 * Hexes in a prop, not a class, the same way `PageHero` and the marketplace brand mark carry
 * theirs — these are `surface-canopy` → `surface-canopy-deep` from the token set, which a
 * `LinearGradient` cannot read as classNames.
 */
export function KitchenCanopyGradient() {
    return (
        <LinearGradient
            colors={['#0b3b26', '#124f33']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ flex: 1 }}
        />
    );
}

/**
 * Brand block at the top of the rail: the violet-to-green mark the marketplace top bar uses, the
 * wordmark, and the area line under it. No branch name — the access state carries only branch ids,
 * and a made-up label would be worse than none.
 */
export function KitchenBrandBlock() {
    const { t } = useTranslation();

    return (
        <View testID="kitchen-rail-brand" className="flex-row items-center gap-2 px-4 pb-2 pt-4">
            <LinearGradient
                colors={['#6d28d9', '#16a34a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 32, height: 32, borderRadius: 8 }}
            >
                <View className="h-full w-full items-center justify-center">
                    <RNText className="text-base font-bold text-content-on-canopy">
                        {t('marketplace:brand.name').slice(0, 1)}
                    </RNText>
                </View>
            </LinearGradient>
            <View className="min-w-0 flex-1">
                <RNText
                    numberOfLines={1}
                    className="text-base font-bold text-content-on-canopy text-start"
                >
                    {t('marketplace:brand.name')}
                </RNText>
                <RNText
                    numberOfLines={1}
                    className="text-xs text-content-on-canopy-muted text-start"
                >
                    {t('kitchen:nav.railTitle')}
                </RNText>
            </View>
        </View>
    );
}

/**
 * The rail's destinations: Overview, then the permitted families in their registry groups, then
 * the workspace trio the sidebar carried before this rail existed — kept reachable, under its own
 * heading, with its `nav-*` test ids intact.
 *
 * The review and exceptions badges read the same queries their pages count with, so the sidebar
 * number and the page number cannot disagree (the KITCHEN.md acceptance check). The review
 * aggregate is seven reads; the layout mounts once per kitchen session and shares the hub's query
 * key, so it costs one flight.
 * ponytail: default staleTime means a focus refetch per source; give these two queries a staleTime
 * if that ever shows up in the network tab as churn.
 */
export function useKitchenNavigation(): readonly NavigationItem[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const state = useAccessState();

    const sections = useMemo(() => kitchenNavSections(state), [state]);
    const permitted = useMemo(
        () => new Set(sections.flatMap((section) => section.items.map((item) => item.key))),
        [sections],
    );

    const reviewSources = useReviewQueueQuery(permitted.has('review'));
    const exceptions = useConsumptionExceptionCountQuery(permitted.has('consumption-exceptions'));

    const reviewTotal = useMemo(() => {
        const data = reviewSources.data;
        if (data === undefined) return null;
        return buildReviewQueue({
            ingredients: data.ingredients,
            quarantinedRecipes: data.quarantinedRecipes,
            staleRecipes: data.staleRecipes,
            products: data.products,
            meals: data.meals,
            plans: data.plans,
            priceLists: data.priceLists,
        }).total;
    }, [reviewSources.data]);
    const exceptionTotal = exceptions.data ?? null;

    return useMemo(() => {
        const queueCount = (key: string): number | null => {
            if (key === 'review') return reviewTotal;
            if (key === 'consumption-exceptions') return exceptionTotal;
            return null;
        };

        const familyItem = (item: {
            readonly key: string;
            readonly nameKey: string;
            readonly icon: NavigationItem['icon'];
            readonly href: string;
        }): NavigationItem => {
            const count = queueCount(item.key);
            return {
                key: item.key,
                label: t(item.nameKey),
                icon: item.icon,
                active: isKitchenNavActive(pathname, item.href),
                testID: `nav-${item.key}`,
                ...(count === null || count === 0
                    ? {}
                    : {
                          badge: (
                              <Badge
                                  testID={`nav-${item.key}-badge`}
                                  tone="warning"
                                  label={String(count)}
                              />
                          ),
                      }),
                onPress: () => {
                    router.push(item.href as never);
                },
            };
        };

        return [
            {
                key: 'overview',
                label: t('kitchen:nav.overview'),
                icon: 'home',
                active: isKitchenNavActive(pathname, OVERVIEW_HREF),
                testID: 'nav-overview',
                onPress: () => {
                    router.push(OVERVIEW_HREF as never);
                },
            },
            ...sections.flatMap((section) =>
                section.items.map((item) => ({
                    ...familyItem(item),
                    group: t(section.labelKey),
                })),
            ),
            ...permittedNavigation(state).map((item): NavigationItem => ({
                key: item.key,
                label: t(item.labelKey),
                icon: item.icon,
                group: t('kitchen:nav.groups.workspace'),
                active: pathname === item.href,
                testID: `nav-${item.key}`,
                onPress: () => {
                    router.push(item.href as never);
                },
            })),
        ];
    }, [sections, state, pathname, reviewTotal, exceptionTotal, router, t]);
}
