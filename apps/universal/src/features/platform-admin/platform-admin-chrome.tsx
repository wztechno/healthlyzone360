import { Badge } from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../access/gate.tsx';
import { usePlatformB2bApplicationsQuery } from '../../data/platform-b2b-hooks.ts';
import { AreaBrandBlock } from '../../shell/area-brand-block.tsx';

/**
 * The platform console's rail: Kitchens and B2B applications. Imported only by
 * `app/platform-admin/_layout.tsx`, the way `corporate-chrome.tsx` serves the corporate area.
 *
 * The B2B entry counts what is waiting on a reviewer — `submitted` applications nobody has claimed.
 * Everything else in the queue is waiting on the applicant or already decided, and a badge that
 * counted it would be a number nobody can act on. The count reads only the first page; a queue
 * longer than a page shows the page's worth, which is still the right signal.
 */

export const PLATFORM_KITCHENS_HREF = '/platform-admin';
export const PLATFORM_B2B_HREF = '/platform-admin/b2b';

export function platformB2bApplicationHref(applicationId: string): string {
    return `${PLATFORM_B2B_HREF}/${encodeURIComponent(applicationId)}`;
}

const B2B_VIEW_PERMISSION = 'b2b_application.view_platform';

export function PlatformAdminBrandBlock() {
    const { t } = useTranslation();
    return (
        <AreaBrandBlock testID="platform-admin-rail-brand" subtitle={t('platformAdmin:title')} />
    );
}

export function usePlatformAdminNavigation(): readonly NavigationItem[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const canReviewB2b = useCan(B2B_VIEW_PERMISSION);
    const waiting = usePlatformB2bApplicationsQuery({ status: 'submitted' }, canReviewB2b);

    const count = waiting.data?.pages[0]?.items.length ?? 0;

    return useMemo(() => {
        const inB2b = pathname.startsWith(PLATFORM_B2B_HREF);
        const go = (href: string) => () => {
            router.push(href as never);
        };

        const items: NavigationItem[] = [
            {
                key: 'platform-kitchens',
                label: t('platformAdmin:nav.kitchens'),
                icon: 'organisation',
                active: !inB2b,
                testID: 'nav-platform-kitchens',
                onPress: go(PLATFORM_KITCHENS_HREF),
            },
        ];

        if (canReviewB2b) {
            items.push({
                key: 'platform-b2b',
                label: t('platformAdmin:nav.b2b'),
                icon: 'building',
                active: inB2b,
                testID: 'nav-platform-b2b',
                ...(count === 0
                    ? {}
                    : {
                          badge: (
                              <Badge
                                  testID="nav-platform-b2b-badge"
                                  tone="warning"
                                  label={String(count)}
                              />
                          ),
                      }),
                onPress: go(PLATFORM_B2B_HREF),
            });
        }

        return items;
    }, [canReviewB2b, count, pathname, router, t]);
}
