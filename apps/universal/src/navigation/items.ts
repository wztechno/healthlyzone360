import type { IconName } from '@healthy360/design-system';
import type { AppMode, RouteArea } from '@healthy360/domain-types';
import { can, evaluateArea, modeAllows } from '@healthy360/permissions';
import type { AccessState } from '@healthy360/permissions';

import { isAreaAvailable } from '../features/availability.ts';

/**
 * Navigation declared as data.
 *
 * Two things follow from that. First, "which destinations may this person see?" becomes a pure
 * function of an `AccessState`, so it is table-testable without rendering anything. Second, the
 * sidebar cannot drift from the guards: both read the same registry, so a link is only ever offered
 * when the gate behind it would actually open.
 */
export interface NavigationDescriptor {
    readonly key: string;
    /** i18next key for the label. Never a literal string. */
    readonly labelKey: string;
    readonly href: string;
    readonly icon: IconName;
    /** Permission required to see the item at all. */
    readonly requiredPermission?: string | undefined;
    /** Route area the destination lives in — the mode and gate check runs against it. */
    readonly area?: RouteArea | undefined;
}

/** Destinations available inside a workspace, in display order. */
export const WORKSPACE_NAVIGATION: readonly NavigationDescriptor[] = [
    {
        key: 'workspace',
        labelKey: 'common:nav.workspace',
        href: '/workspace',
        icon: 'organisation',
    },
    {
        key: 'profile',
        labelKey: 'common:nav.profile',
        href: '/profile',
        icon: 'user',
    },
    {
        key: 'devices',
        labelKey: 'common:nav.devices',
        href: '/devices',
        icon: 'device',
        requiredPermission: 'device.manage_own',
    },
    {
        key: 'showcase',
        labelKey: 'common:nav.showcase',
        href: '/platform-admin/showcase',
        icon: 'prototype',
        requiredPermission: 'organisation.manage_platform',
        area: 'platform-admin',
    },
];

/** The thirteen registry areas minus the two that are not workspaces. */
export const WORKSPACE_AREAS: readonly RouteArea[] = [
    'customer',
    'patient',
    'dietitian',
    'clinic',
    'kitchen',
    'kds',
    'driver',
    'partner',
    'corporate',
    'insurance',
    'platform-admin',
];

export function areaHref(area: RouteArea): string {
    return `/${area}`;
}

/**
 * A glyph per workspace area, for the tiles on `/workspace`.
 *
 * **Decoration, never the message.** Every tile renders the area's translated name beside this
 * glyph and the `Icon` is left unlabelled, so the name is what a screen reader announces and what a
 * reader who cannot tell `◇` from `◈` relies on. That is also why choosing a glyph needs no new
 * translation key: nothing here carries meaning the name does not already carry.
 *
 * Typed against the whole of `RouteArea` rather than only the eleven in `WORKSPACE_AREAS`, so a
 * thirteenth area added to the registry fails the typecheck here instead of rendering a tile with a
 * hole where its icon should be. `public` and `auth` are not workspaces and never reach a tile;
 * they are present only to keep the record total.
 *
 * The set is deliberately all-distinct. Two areas sharing a glyph would make the grid read as a
 * mistake, and the pairs that tempt one — clinic and patient, partner and corporate — are exactly
 * the ones a person needs to tell apart at a glance.
 */
export const AREA_ICONS: Readonly<Record<RouteArea, IconName>> = {
    public: 'home',
    auth: 'user',
    customer: 'home',
    patient: 'user',
    dietitian: 'leaf',
    clinic: 'medicalCross',
    kitchen: 'plate',
    kds: 'device',
    driver: 'basket',
    partner: 'branch',
    corporate: 'organisation',
    insurance: 'lock',
    'platform-admin': 'prototype',
};

/** Filters the descriptors down to what this state may actually reach. */
export function permittedNavigation(
    state: AccessState,
    descriptors: readonly NavigationDescriptor[] = WORKSPACE_NAVIGATION,
): readonly NavigationDescriptor[] {
    return descriptors.filter((item) => {
        if (item.requiredPermission !== undefined && !can(state, item.requiredPermission)) {
            return false;
        }
        if (item.area !== undefined && !modeAllows(state.mode, item.area)) return false;
        return true;
    });
}

export interface WorkspaceAreaOption {
    readonly area: RouteArea;
    readonly href: string;
    /** True when the area's own gate would let this state in right now. */
    readonly available: boolean;
}

/**
 * Which workspace areas this state may open, evaluated through the *same* kernel the route layouts
 * use. `available: false` entries are dropped rather than shown greyed out — offering a destination
 * that refuses on arrival is worse than not offering it.
 *
 * Two independent filters, in this order. `modeAllows` is a *packaging* question — is this area
 * compiled into this build family — and `isAreaAvailable` is a *backend* one: an area whose
 * endpoints do not exist would redirect straight back here, so it never becomes a tile.
 * `WORKSPACE_AREAS` itself stays complete; it is the registry, not the menu.
 */
export function availableWorkspaceAreas(state: AccessState): readonly WorkspaceAreaOption[] {
    return WORKSPACE_AREAS.filter((area) => modeAllows(state.mode, area) && isAreaAvailable(area))
        .map((area) => ({
            area,
            href: areaHref(area),
            available: evaluateArea(state, area).status === 'allow',
        }))
        .filter((option) => option.available);
}

/** Areas compiled into a build family, regardless of the current user. Used by the showcase. */
export function areasForMode(mode: AppMode): readonly RouteArea[] {
    return WORKSPACE_AREAS.filter((area) => modeAllows(mode, area));
}
