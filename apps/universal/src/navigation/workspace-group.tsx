import { Badge } from '@healthy360/design-system';
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
    /** The area the shell is drawing, badged "Current" in the list. */
    readonly currentArea?: RouteArea | undefined;
}

/**
 * The Workspace module: the first icon on every workspace rail.
 *
 * One panel, two runs. **Workspaces** goes straight to each area this person can open — the same
 * list, through the same gates, as the tiles on `/workspace`, so the panel never offers an area that
 * would refuse on arrival. **Account** is Profile, Devices and the showcase, filtered as before.
 *
 * The current area is badged, never `active`: an active item would make the shell open this module
 * on every page of the area, hiding the area's own modules behind it.
 */
export function workspaceGroup({
    state,
    t,
    pathname,
    navigate,
    currentArea,
}: WorkspaceGroupOptions): readonly NavigationItem[] {
    const group = t('common:nav.workspace');
    const workspaces = t('common:nav.sectionWorkspaces');
    const account = t('common:nav.sectionAccount');

    const areas = availableWorkspaceAreas(state).map((option): NavigationItem => ({
        key: `area-${option.area}`,
        label: t(`access:area.${option.area}`),
        icon: AREA_ICONS[option.area],
        group,
        groupIcon: 'layers',
        section: workspaces,
        testID: `nav-area-${option.area}`,
        ...(option.area === currentArea
            ? {
                  badge: (
                      <Badge
                          testID={`nav-area-${option.area}-current`}
                          tone="brand"
                          label={t('common:nav.current')}
                      />
                  ),
              }
            : {}),
        onPress: () => {
            navigate(option.href);
        },
    }));

    const settings = permittedNavigation(state)
        // The tile page is still the landing after sign-in; the panel above replaces its link.
        .filter((item) => item.key !== 'workspace')
        .map((item): NavigationItem => ({
            key: item.key,
            label: t(item.labelKey),
            icon: item.icon,
            group,
            groupIcon: 'layers',
            section: account,
            active: pathname === item.href,
            testID: `nav-${item.key}`,
            onPress: () => {
                navigate(item.href);
            },
        }));

    return [...areas, ...settings];
}
