import type { IconName } from '@healthy360/design-system';
import type { AppMode, RouteArea } from '@healthy360/domain-types';
import { can, evaluateArea, modeAllows } from '@healthy360/permissions';
import type { AccessState } from '@healthy360/permissions';

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
        requiredPermission: 'session.view_own',
    },
    {
        key: 'showcase',
        labelKey: 'common:nav.showcase',
        href: '/platform-admin/showcase',
        icon: 'prototype',
        requiredPermission: 'platform.access_admin',
        area: 'platform-admin',
    },
];

/** The fourteen registry areas minus the two that are not workspaces. */
export const WORKSPACE_AREAS: readonly RouteArea[] = [
    'customer',
    'patient',
    'dietitian',
    'clinic',
    'kitchen',
    'pos',
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
 */
export function availableWorkspaceAreas(state: AccessState): readonly WorkspaceAreaOption[] {
    return WORKSPACE_AREAS.filter((area) => modeAllows(state.mode, area))
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
