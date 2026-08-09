import { Breadcrumbs } from '@healthy360/design-system';
import type { BreadcrumbItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAccessState } from '../../session/session-provider.tsx';
import { OVERVIEW_HREF, isKitchenNavActive, kitchenNavSections } from './kitchen-nav.ts';

/**
 * Kitchen area content chrome — a trail back to the hub, and padding.
 *
 * ## Why there is a trail at all
 *
 * Destinations live on the hub as a card grid rather than in a second sidebar or a cramped icon
 * strip on every route — that decision stands. What it cost was the way back: once you pressed
 * through to `/kitchen/ingredients` there was no control anywhere on the page that returned you to
 * `/kitchen`. Editors had "back to list" and lists had nothing, so the hub was reachable only by the
 * browser's back button, which native does not have at all.
 *
 * It sits here rather than in the thirteen screens because this component already wraps every
 * kitchen route, so a family added tomorrow gets its trail without anybody remembering to add one.
 * The labels come from the same entity registry the hub cards and the `<Gate>`s read, which is what
 * stops a crumb naming a page differently from the card that led to it.
 *
 * ## Two crumbs, not three
 *
 * On a list the trail is `Kitchen workspace › Ingredients`, the second being the page you are on.
 * On an editor below it the family crumb becomes a link to its list, and no third crumb is added:
 * the record's own name is the heading of the screen you are looking at, and the shell has no
 * business guessing it from a route parameter. The editor keeps its own "back to list" control;
 * this adds the step above that one.
 */

export interface KitchenOpsShellProps {
    readonly children: ReactNode;
}

export function KitchenOpsShell({ children }: KitchenOpsShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const accessState = useAccessState();

    const crumbs = useMemo<readonly BreadcrumbItem[]>(() => {
        // The hub is its own page; a trail that says "Kitchen workspace" on the kitchen workspace
        // is furniture.
        if (isKitchenNavActive(pathname, OVERVIEW_HREF)) return [];

        const family = kitchenNavSections(accessState)
            .flatMap((section) => section.items)
            .find((item) => isKitchenNavActive(pathname, item.href));

        // A route the registry does not know — permission-filtered away, or new and unregistered.
        // Still offer the way home rather than rendering nothing.
        if (family === undefined) {
            return [{ key: 'hub', label: t('kitchen:hub.title'), testID: 'kitchen-crumb-hub' }];
        }

        const onFamilyRoute = pathname === family.href;
        return [
            {
                key: 'hub',
                label: t('kitchen:hub.title'),
                testID: 'kitchen-crumb-hub',
                onPress: () => {
                    router.push(OVERVIEW_HREF as never);
                },
            },
            {
                key: family.key,
                label: t(family.nameKey),
                testID: 'kitchen-crumb-family',
                ...(onFamilyRoute
                    ? {}
                    : {
                          onPress: () => {
                              router.push(family.href as never);
                          },
                      }),
            },
        ];
    }, [accessState, pathname, router, t]);

    return (
        <View testID="kitchen-ops-shell" className="min-h-0 flex-1 gap-4 p-4 md:p-5">
            {crumbs.length === 0 ? null : (
                <Breadcrumbs testID="kitchen-breadcrumbs" items={crumbs} />
            )}
            <View testID="kitchen-ops-content" className="min-h-0 min-w-0 flex-1">
                {children}
            </View>
        </View>
    );
}
