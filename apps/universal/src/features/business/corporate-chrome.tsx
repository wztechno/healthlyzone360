import type { MenuItem, NavigationItem } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCorporateProgrammesQuery, useQuotationsQuery } from '../../data/business-hooks.ts';
import { useTrailLeafState } from '../../shell/area-trail.tsx';
import type { DeskCrumb } from '../kitchen-admin/desk-kit/desk-trail.tsx';

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
                          count: awaiting,
                      }),
                onPress: go(CORPORATE_QUOTATIONS_HREF),
            },
        ];
    }, [awaiting, pathname, programmes.data, router, t]);
}

/**
 * The crumbs for the current corporate route, in the kitchen's pill trail (`DeskTrail`, Phase C):
 *
 * ```
 *  (⌂) / Purchasing ⌄ / ( Test employee meals )            a page
 *  (⌂) / Purchasing ⌄ / Quotations / ( QUO-2026-… )         a record open over its list
 * ```
 *
 * Home is the overview. The module crumb's menu lists the Purchasing pages with the rail's counts.
 * On a record, the page crumb becomes the way back — to the list by closing the record where it
 * opened in place (a quotation), or by navigating where it is a route of its own (a catalogue line,
 * whose screen hands the trail a callback that returns to its programme).
 */
export function useCorporateTrail(): readonly DeskCrumb[] {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const navigation = useCorporateNavigation();
    const programmes = useCorporateProgrammesQuery();
    const { leaf, back } = useTrailLeafState();

    return useMemo<readonly DeskCrumb[]>(() => {
        const route = corporateRoute(pathname);
        const overview = t('business:nav.overview');
        if (route.kind === 'home') {
            return [
                { key: 'home', kind: 'current', label: overview, testID: 'corporate-crumb-home' },
            ];
        }

        const home: DeskCrumb = {
            key: 'home',
            kind: 'home',
            label: overview,
            testID: 'corporate-crumb-home',
            onPress: () => {
                router.push(CORPORATE_HOME_HREF as never);
            },
        };
        const pages: MenuItem[] = navigation
            .filter((item) => item.group !== undefined)
            .map((item) => ({
                key: item.key,
                label: item.label,
                selected: item.active,
                testID: `corporate-crumb-module-${item.key}`,
                ...(item.count === undefined ? {} : { count: item.count }),
                onSelect: item.onPress,
            }));
        const module: DeskCrumb = {
            key: 'module',
            kind: 'module',
            label: t('business:nav.group'),
            testID: 'corporate-crumb-module',
            pages,
        };

        // The page's own crumb: the current pill, or — with a record open beneath it — the way back.
        const page = (
            key: string,
            label: string,
            onPress: (() => void) | null,
        ): readonly DeskCrumb[] => {
            const withLeaf = leaf !== null && onPress !== null;
            return [
                home,
                module,
                withLeaf
                    ? { key, kind: 'page', label, testID: 'corporate-crumb-page', onPress }
                    : { key, kind: 'current', label, testID: 'corporate-crumb-page' },
                ...(withLeaf
                    ? [
                          {
                              key: 'leaf',
                              kind: 'current' as const,
                              label: leaf,
                              testID: 'corporate-crumb-leaf',
                          },
                      ]
                    : []),
            ];
        };

        switch (route.kind) {
            case 'catalogue': {
                const programme = (programmes.data ?? []).find(
                    (candidate) => String(candidate.id) === route.programmeId,
                );
                return page('catalogue', programme?.name ?? t('business:nav.catalogue'), back);
            }
            case 'item':
                return page('catalogue', t('business:nav.catalogue'), back);
            case 'quotations':
                return page('quotations', t('business:nav.quotations'), back);
            case 'new-quotation':
                return [
                    home,
                    module,
                    {
                        key: 'quotations',
                        kind: 'page',
                        label: t('business:nav.quotations'),
                        testID: 'corporate-crumb-page',
                        onPress: () => {
                            router.push(CORPORATE_QUOTATIONS_HREF as never);
                        },
                    },
                    {
                        key: 'leaf',
                        kind: 'current',
                        label: t('business:nav.newQuotation'),
                        testID: 'corporate-crumb-leaf',
                    },
                ];
            case 'wind-down':
                return page('wind-down', t('business:nav.windDown'), null);
            case 'other':
                return [{ ...home, kind: 'current', onPress: undefined }];
        }
    }, [back, leaf, navigation, pathname, programmes.data, router, t]);
}
