import { Badge } from '@healthy360/design-system';
import type { BreadcrumbItem, NavigationItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCorporateProgrammesQuery, useQuotationsQuery } from '../../data/business-hooks.ts';
import { AreaBrandBlock } from '../../shell/area-brand-block.tsx';
import { useTrailLeafState } from '../../shell/area-trail.tsx';

/**
 * The corporate area's chrome: the rail, the trail and the brand block — the kitchen's desk shell
 * (`kitchen-admin/kitchen-chrome.tsx`, `kitchen-ops-shell.tsx`) with the corporate area's
 * destinations. Imported only by `app/corporate/_layout.tsx`.
 *
 * ## The catalogues are the programmes
 *
 * A negotiated catalogue is scoped to one programme by the contract (`CatalogueFilter` requires a
 * `programmeId`), so there is no "the catalogue" to link to. The rail draws one entry per
 * programme, named as the programme is, which is the same list the overview's table draws — the
 * rail and the page read one query and cannot disagree.
 *
 * ## The Quotations badge counts what is waiting on the buyer
 *
 * `quoted` is the one state in which the next move is this account's: the account manager has put a
 * price on it and it will expire. Everything else is waiting on somebody else, and a badge that
 * counted it would be a number nobody can act on.
 */

export const CORPORATE_HOME_HREF = '/corporate';
export const CORPORATE_QUOTATIONS_HREF = '/corporate/quotations';
export const CORPORATE_NEW_QUOTATION_HREF = '/corporate/quotations/new';
export const CORPORATE_WIND_DOWN_HREF = '/corporate/account/wind-down';

export function corporateCatalogueHref(programmeId: string): string {
    return `/corporate/catalogue/${programmeId}`;
}

/** The route's place in the area, read off the path. */
type CorporateRoute =
    | { readonly kind: 'home' }
    | { readonly kind: 'catalogue'; readonly programmeId: string }
    | { readonly kind: 'item' }
    | { readonly kind: 'quotations' }
    | { readonly kind: 'new-quotation' }
    | { readonly kind: 'wind-down' }
    | { readonly kind: 'other' };

export function corporateRoute(pathname: string): CorporateRoute {
    const path = pathname.replace(/\/+$/, '');
    if (path === '' || path === CORPORATE_HOME_HREF) return { kind: 'home' };
    const catalogue = /^\/corporate\/catalogue\/([^/]+)$/.exec(path);
    if (catalogue?.[1] !== undefined) {
        return { kind: 'catalogue', programmeId: decodeURIComponent(catalogue[1]) };
    }
    if (path.startsWith('/corporate/items/')) return { kind: 'item' };
    if (path === CORPORATE_NEW_QUOTATION_HREF) return { kind: 'new-quotation' };
    if (path === CORPORATE_QUOTATIONS_HREF) return { kind: 'quotations' };
    if (path === CORPORATE_WIND_DOWN_HREF) return { kind: 'wind-down' };
    return { kind: 'other' };
}

export function CorporateBrandBlock() {
    const { t } = useTranslation();
    return <AreaBrandBlock testID="corporate-rail-brand" subtitle={t('business:nav.railTitle')} />;
}

/**
 * The rail: Overview, then the purchasing module — one catalogue per programme, then the
 * quotations. The other areas are the shell's bottom bar (`AreaShell`), not a rail module.
 */
export function useCorporateNavigation(): readonly NavigationItem[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const programmes = useCorporateProgrammesQuery();
    const quotations = useQuotationsQuery();

    const awaiting = useMemo(
        () => (quotations.data?.items ?? []).filter((row) => row.state === 'quoted').length,
        [quotations.data],
    );

    return useMemo(() => {
        const route = corporateRoute(pathname);
        const go = (href: string) => () => {
            router.push(href as never);
        };
        const group = t('business:nav.group');

        const catalogues = (programmes.data ?? []).map((programme): NavigationItem => ({
            key: `catalogue-${String(programme.id)}`,
            label: programme.name,
            icon: 'bookOpen',
            group,
            groupIcon: 'building',
            section: t('business:nav.catalogues'),
            active: route.kind === 'catalogue' && route.programmeId === String(programme.id),
            testID: `nav-corporate-catalogue-${String(programme.id)}`,
            onPress: go(corporateCatalogueHref(String(programme.id))),
        }));

        return [
            {
                key: 'corporate-overview',
                label: t('business:nav.overview'),
                icon: 'dashboard',
                active: route.kind === 'home',
                testID: 'nav-corporate-overview',
                onPress: go(CORPORATE_HOME_HREF),
            },
            ...catalogues,
            {
                key: 'corporate-quotations',
                label: t('business:nav.quotations'),
                icon: 'fileText',
                group,
                groupIcon: 'building',
                section: t('business:nav.quotationsSection'),
                active: route.kind === 'quotations',
                testID: 'nav-corporate-quotations',
                ...(awaiting === 0
                    ? {}
                    : {
                          badge: (
                              <Badge
                                  testID="nav-corporate-quotations-badge"
                                  tone="warning"
                                  label={String(awaiting)}
                              />
                          ),
                      }),
                onPress: go(CORPORATE_QUOTATIONS_HREF),
            },
        ];
    }, [awaiting, pathname, programmes.data, router, t]);
}

/**
 * The crumbs for the current corporate route. Empty on the overview, where a trail naming the page
 * you are on is furniture — the caller's signal to draw the area title instead.
 *
 * Two crumbs on a page, three on a record: the record's name is the leaf a screen names through
 * `useTrailLeaf`, and the crumb above it becomes the way back — to the list by closing the record
 * where it opened in place (a quotation), or by navigating where it is a route of its own (a
 * catalogue line, whose screen hands the trail a callback that returns to its programme).
 */
export function useCorporateTrail(): readonly BreadcrumbItem[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const programmes = useCorporateProgrammesQuery();
    const { leaf, back } = useTrailLeafState();

    return useMemo<readonly BreadcrumbItem[]>(() => {
        const route = corporateRoute(pathname);
        if (route.kind === 'home') return [];

        const home: BreadcrumbItem = {
            key: 'home',
            label: t('business:nav.overview'),
            testID: 'corporate-crumb-home',
            onPress: () => {
                router.push(CORPORATE_HOME_HREF as never);
            },
        };
        const toQuotations = () => {
            router.push(CORPORATE_QUOTATIONS_HREF as never);
        };

        // The page's own crumb, and whether pressing it does anything. It is a link whenever a
        // record is open beneath it; otherwise it is the page, and the last crumb is never a link.
        const page = (
            key: string,
            label: string,
            onPress: (() => void) | null,
        ): readonly BreadcrumbItem[] => {
            const withLeaf = leaf !== null && onPress !== null;
            return [
                home,
                {
                    key,
                    label,
                    testID: 'corporate-crumb-page',
                    ...(withLeaf ? { onPress } : {}),
                },
                ...(withLeaf ? [{ key: 'leaf', label: leaf, testID: 'corporate-crumb-leaf' }] : []),
            ];
        };

        switch (route.kind) {
            case 'catalogue': {
                const programme = (programmes.data ?? []).find(
                    (candidate) => String(candidate.id) === route.programmeId,
                );
                return page('catalogue', programme?.name ?? t('business:nav.catalogue'), null);
            }
            case 'item':
                return page('catalogue', t('business:nav.catalogue'), back);
            case 'quotations':
                return page('quotations', t('business:nav.quotations'), back);
            case 'new-quotation':
                return [
                    home,
                    {
                        key: 'quotations',
                        label: t('business:nav.quotations'),
                        testID: 'corporate-crumb-page',
                        onPress: toQuotations,
                    },
                    {
                        key: 'leaf',
                        label: t('business:nav.newQuotation'),
                        testID: 'corporate-crumb-leaf',
                    },
                ];
            case 'wind-down':
                return page('wind-down', t('business:nav.windDown'), null);
            case 'other':
                return [home];
        }
    }, [back, leaf, pathname, programmes.data, router, t]);
}
