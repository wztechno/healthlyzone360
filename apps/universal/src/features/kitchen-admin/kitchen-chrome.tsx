import { Badge } from '@healthy360/design-system';
import type { IconName, NavigationItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useReviewQueueQuery } from '../../data/kitchen-admin-hooks.ts';
import { useConsumptionExceptionCountQuery } from '../../data/kitchen-ops-hooks.ts';
import { AreaBrandBlock, AreaRailTop, DESK_SIDEBAR_WIDTH } from '../../shell/area-brand-block.tsx';
import { useAccessState } from '../../session/session-provider.tsx';
import {
    OVERVIEW_HREF,
    activeKitchenNavHref,
    isKitchenNavActive,
    kitchenNavSections,
} from './kitchen-nav.ts';
import type { EntityGroup } from './entity-registry.ts';
import { buildReviewQueue } from './review-queue.ts';

/**
 * The kitchen area's sidebar: the family rail.
 *
 * `kitchenNavSections()` existed before this file and fed only the breadcrumbs; this is the rail
 * it was written for. Everything here derives from the same registry the hub cards and the
 * `<Gate>`s read, so a destination is offered exactly when its screen would open. Imported only by
 * `app/kitchen/_layout.tsx` — the chrome ships with the kitchen area, not with the entry bundle.
 */

/**
 * Each module's mark on the rail, where a group is drawn as one icon. Drawn on the web (Lucide, see
 * `icon-drawing.web.tsx`); on native each falls back to the glyph it replaced.
 */
const GROUP_ICONS: Readonly<Record<EntityGroup, IconName>> = {
    orderDesk: 'receipt',
    workbench: 'clipboardCheck',
    catalogue: 'chefHat',
    commercial: 'tag',
    operations: 'package',
    access: 'shield',
};

/** KITCHEN.md sidebar spec: the family rail is 232px. */
export const KITCHEN_SIDEBAR_WIDTH = DESK_SIDEBAR_WIDTH;

/** The top of the green module rail: empty — see `AreaRailTop`. */
export function KitchenRailTop() {
    return <AreaRailTop testID="kitchen-rail-top" />;
}

/**
 * Brand block at the top of the rail. No branch name — the access state carries only branch ids,
 * and a made-up label would be worse than none.
 */
export function KitchenBrandBlock() {
    const { t } = useTranslation();
    return <AreaBrandBlock testID="kitchen-rail-brand" subtitle={t('kitchen:nav.railTitle')} />;
}

/**
 * The rail's destinations: Overview, then the permitted families in their registry groups. The
 * other areas and the account pages are the shell's bottom bar (`AreaShell`), not a rail module.
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
        const activeHref = activeKitchenNavHref(
            pathname,
            sections.flatMap((section) => section.items.map((item) => item.href)),
        );

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
                active: item.href === activeHref,
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
                icon: 'dashboard',
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
                    groupIcon: GROUP_ICONS[section.group],
                })),
            ),
        ];
    }, [sections, pathname, reviewTotal, exceptionTotal, router, t]);
}
