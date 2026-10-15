import type { NavigationItem } from '@healthy360/design-system';
import type { RouteArea } from '@healthy360/domain-types';
import type { AccessState } from '@healthy360/permissions';
import type { TFunction } from 'i18next';

import { AREA_ICONS, availableWorkspaceAreas, permittedNavigation } from './items.ts';

export interface WorkspaceGroupOptions {
    readonly state: AccessState;
    readonly t: TFunction;
    readonly pathname: string;
    readonly navigate: (href: string) => void;
    /** The area the shell is drawing, lit in the bar. */
    readonly currentArea?: RouteArea | undefined;
}

/**
 * The workspace switcher: the bottom tab bar on every admin page (`AppShell` `bottomNavigation`),
 * and the driver area's own tabs.
 *
 * Two runs. The areas this person can open come first — the same list, through the same gates, as
 * the tiles on `/workspace`, so the bar never offers an area that would refuse on arrival. Then the
 * account pages, Profile and Devices, filtered as before.
 *
 * It used to be the first module on every desk rail, where the current area could only be badged:
 * an active item made the shell open that module on every page of the area. In the bar nothing
 * opens, so the current area is simply the lit tab.
 */
export function workspaceGroup({
    state,
    t,
    pathname,
    navigate,
    currentArea,
}: WorkspaceGroupOptions): readonly NavigationItem[] {
    const areas = availableWorkspaceAreas(state).map((option): NavigationItem => ({
        key: `area-${option.area}`,
        label: t(`access:area.${option.area}`),
        icon: AREA_ICONS[option.area],
        active: option.area === currentArea,
        testID: `nav-area-${option.area}`,
        onPress: () => {
            navigate(option.href);
        },
    }));

    const settings = permittedNavigation(state)
        // The tile page is still the landing after sign-in; the bar above replaces its link.
        .filter((item) => item.key !== 'workspace')
        .map((item): NavigationItem => ({
            key: item.key,
            label: t(item.labelKey),
            icon: item.icon,
            active: pathname === item.href,
            testID: `nav-${item.key}`,
            onPress: () => {
                navigate(item.href);
            },
        }));

    return [...areas, ...settings];
}
