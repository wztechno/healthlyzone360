import type { IconName, NavigationItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../access/gate.tsx';
import { useReviewQueueQuery } from '../../data/kitchen-admin-hooks.ts';
import { useCashWaiting } from '../../data/order-desk-hooks.ts';
import {
    useConsumptionExceptionCountQuery,
    useKitchenSetupQuery,
} from '../../data/kitchen-ops-hooks.ts';
import { guardNavigation } from '../../navigation/use-unsaved-guard.ts';
import { AreaRailTop, DESK_SIDEBAR_WIDTH } from '../../shell/area-brand-block.tsx';
import { useAccessState } from '../../session/session-provider.tsx';
import {
    OVERVIEW_HREF,
    activeKitchenNavHref,
    isKitchenNavActive,
    kitchenNavSections,
} from './kitchen-nav.ts';
import { ORDER_SETTLE_CASH_PERMISSION } from './entity-registry.ts';
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
    buying: 'shoppingCart',
    foodSafety: 'badgeCheck',
    reports: 'chartColumn',
    access: 'shield',
};

/** The admin frame's page panel width, shared by every desk area. */
export const KITCHEN_SIDEBAR_WIDTH = DESK_SIDEBAR_WIDTH;

/** The top of the green module rail: the brand's leaf — see `AreaRailTop`. */
export function KitchenRailTop() {
    return <AreaRailTop testID="kitchen-rail-top" />;
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

    const allSections = useMemo(() => kitchenNavSections(state), [state]);
    const permitted = useMemo(
        () => new Set(allSections.flatMap((section) => section.items.map((item) => item.key))),
        [allSections],
    );
    const setup = useKitchenSetupQuery(permitted.has('setup'));
    const isLive = setup.data?.isLive === true;
    // Setup is done once the kitchen is live: drop it, and the section if it empties.
    const sections = useMemo(
        () =>
            isLive
                ? allSections
                      .map((section) => ({
                          ...section,
                          items: section.items.filter((item) => item.key !== 'setup'),
                      }))
                      .filter((section) => section.items.length > 0)
                : allSections,
        [allSections, isLive],
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
    // The Cash row adds up what its tabs say is waiting. Only for whoever may settle.
    const cashWaiting = useCashWaiting(useCan(ORDER_SETTLE_CASH_PERMISSION));
    const cashTotal =
        cashWaiting.settle === null && cashWaiting.close === null
            ? null
            : (cashWaiting.settle ?? 0) + (cashWaiting.close ?? 0);

    return useMemo(() => {
        const activeHref = activeKitchenNavHref(
            pathname,
            sections.flatMap((section) => section.items.map((item) => item.href)),
        );

        const queueCount = (key: string): number | null => {
            if (key === 'review') return reviewTotal;
            if (key === 'consumption-exceptions') return exceptionTotal;
            if (key === 'cash') return cashTotal === 0 ? null : cashTotal;
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
                ...(count === null ? {} : { count }),
                onPress: () => {
                    guardNavigation(() => {
                        router.push(item.href as never);
                    });
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
                    guardNavigation(() => {
                        router.push(OVERVIEW_HREF as never);
                    });
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
    }, [sections, pathname, reviewTotal, exceptionTotal, cashTotal, router, t]);
}
