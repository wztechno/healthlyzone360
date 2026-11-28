import type { MenuItem, NavigationItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../access/gate.tsx';
import { usePlatformB2bApplicationsQuery } from '../../data/platform-b2b-hooks.ts';
import { useTrailLeafState } from '../../shell/area-trail.tsx';
import type { DeskCrumb } from '../kitchen-admin/desk-kit/desk-trail.tsx';

/**
 * The platform console's chrome, in the kitchen admin's look (Platform admin canvas, 2026-11-23).
 * Imported only by `app/platform-admin/_layout.tsx`, the way `corporate-chrome.tsx` serves the
 * corporate area.
 *
 * - **The rail** carries one module, Platform. Its page panel lists Kitchens under Tenants and
 *   B2B applications under Onboarding.
 * - **The B2B count** is what waits on a reviewer: `submitted` applications nobody has claimed.
 *   Everything else in the queue waits on the applicant or is decided, and a badge that counted it
 *   would be a number nobody can act on. It reads the first page only, which is still the signal.
 * - **The trail** is the desk's pill trail: ⌂ (Kitchens, the console's front door) / Platform ⌄
 *   (its pages) / the page, and the open record after it.
 */

export const PLATFORM_KITCHENS_HREF = '/platform-admin';
export const PLATFORM_NEW_KITCHEN_HREF = '/platform-admin/kitchens/new';
export const PLATFORM_B2B_HREF = '/platform-admin/b2b';

export function platformKitchenHref(slug: string): string {
    return `${PLATFORM_KITCHENS_HREF}?view=${encodeURIComponent(slug)}`;
}

export function platformB2bApplicationHref(applicationId: string): string {
    return `${PLATFORM_B2B_HREF}/${encodeURIComponent(applicationId)}`;
}

const B2B_VIEW_PERMISSION = 'b2b_application.view_platform';

type PlatformRoute =
    | { readonly kind: 'kitchens' }
    | { readonly kind: 'new-kitchen' }
    | { readonly kind: 'b2b' }
    | { readonly kind: 'application' }
    | { readonly kind: 'other' };

export function platformRoute(pathname: string): PlatformRoute {
    const path = pathname.replace(/\/+$/, '');
    if (path === '' || path === PLATFORM_KITCHENS_HREF) return { kind: 'kitchens' };
    if (path === PLATFORM_NEW_KITCHEN_HREF) return { kind: 'new-kitchen' };
    if (path.startsWith(`${PLATFORM_KITCHENS_HREF}/kitchens/`)) return { kind: 'kitchens' };
    if (path === PLATFORM_B2B_HREF) return { kind: 'b2b' };
    if (path.startsWith(`${PLATFORM_B2B_HREF}/`)) return { kind: 'application' };
    return { kind: 'other' };
}

export function usePlatformAdminNavigation(): readonly NavigationItem[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const canReviewB2b = useCan(B2B_VIEW_PERMISSION);
    const waiting = usePlatformB2bApplicationsQuery({ status: 'submitted' }, canReviewB2b);

    const count = waiting.data?.pages[0]?.items.length ?? 0;

    return useMemo(() => {
        const route = platformRoute(pathname);
        const go = (href: string) => () => {
            router.push(href as never);
        };
        const group = t('platformAdmin:nav.group');

        const items: NavigationItem[] = [
            {
                key: 'platform-kitchens',
                label: t('platformAdmin:nav.kitchens'),
                icon: 'store',
                group,
                groupIcon: 'shield',
                section: t('platformAdmin:nav.tenants'),
                active: route.kind === 'kitchens' || route.kind === 'new-kitchen',
                testID: 'nav-platform-kitchens',
                onPress: go(PLATFORM_KITCHENS_HREF),
            },
        ];

        if (canReviewB2b) {
            items.push({
                key: 'platform-b2b',
                label: t('platformAdmin:nav.b2b'),
                icon: 'building',
                group,
                groupIcon: 'shield',
                section: t('platformAdmin:nav.onboarding'),
                active: route.kind === 'b2b' || route.kind === 'application',
                testID: 'nav-platform-b2b',
                ...(count === 0 ? {} : { count }),
                onPress: go(PLATFORM_B2B_HREF),
            });
        }

        return items;
    }, [canReviewB2b, count, pathname, router, t]);
}

/**
 * The pill trail. A record open over its list — a kitchen in its pop-up — adds itself through
 * `useTrailLeaf`, and the page crumb before it closes it again. The B2B application is a page of
 * its own, so it names its leaf the same way with no way back of its own: the crumb navigates.
 */
export function usePlatformTrail(navigation: readonly NavigationItem[]): readonly DeskCrumb[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const { leaf, back } = useTrailLeafState();

    return useMemo<readonly DeskCrumb[]>(() => {
        const route = platformRoute(pathname);
        const home: DeskCrumb = {
            key: 'home',
            kind: 'home',
            label: t('platformAdmin:nav.kitchens'),
            testID: 'platform-crumb-home',
            onPress: () => {
                router.push(PLATFORM_KITCHENS_HREF as never);
            },
        };
        const pages: MenuItem[] = navigation.map((item) => ({
            key: item.key,
            label: item.label,
            selected: item.active,
            testID: `platform-crumb-module-${item.key}`,
            ...(item.count === undefined ? {} : { count: item.count }),
            onSelect: item.onPress,
        }));
        const module: DeskCrumb = {
            key: 'module',
            kind: 'module',
            label: t('platformAdmin:nav.group'),
            testID: 'platform-crumb-module',
            pages,
        };
        const current = (key: string, label: string): DeskCrumb => ({
            key,
            kind: 'current',
            label,
            testID: key === 'leaf' ? 'platform-crumb-leaf' : 'platform-crumb-page',
        });
        const link = (key: string, label: string, onPress: () => void): DeskCrumb => ({
            key,
            kind: 'page',
            label,
            testID: 'platform-crumb-page',
            onPress,
        });

        switch (route.kind) {
            case 'kitchens': {
                const label = t('platformAdmin:nav.kitchens');
                return leaf !== null && back !== null
                    ? [home, module, link('kitchens', label, back), current('leaf', leaf)]
                    : [home, module, current('kitchens', label)];
            }
            case 'new-kitchen':
                return [
                    home,
                    module,
                    link('kitchens', t('platformAdmin:nav.kitchens'), () => {
                        router.push(PLATFORM_KITCHENS_HREF as never);
                    }),
                    current('leaf', t('platformAdmin:create.title')),
                ];
            case 'b2b':
                return [home, module, current('b2b', t('platformAdmin:nav.b2b'))];
            case 'application':
                return [
                    home,
                    module,
                    link('b2b', t('platformAdmin:nav.b2b'), () => {
                        router.push(PLATFORM_B2B_HREF as never);
                    }),
                    ...(leaf === null ? [] : [current('leaf', leaf)]),
                ];
            case 'other':
                return [{ ...home, kind: 'current', onPress: undefined }];
        }
    }, [back, leaf, navigation, pathname, router, t]);
}
