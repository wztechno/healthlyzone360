import type { AccessState } from '@healthy360/permissions';

import { ENTITY_GROUPS, permittedFamilies } from './entity-registry.ts';
import type { EntityFamily, EntityGroup } from './entity-registry.ts';

/**
 * Kitchen-local navigation derived from the entity registry.
 *
 * The app shell sidebar stays workspace-level (workspace / profile / devices). This module is the
 * secondary rail inside `/kitchen` so family destinations cannot drift from hub cards or `<Gate>`s.
 */

export const OVERVIEW_HREF = '/kitchen';

export interface KitchenNavItem {
    readonly key: string;
    readonly nameKey: string;
    readonly icon: EntityFamily['icon'];
    readonly href: string;
}

export interface KitchenNavSection {
    readonly group: EntityGroup;
    readonly labelKey: string;
    readonly items: readonly KitchenNavItem[];
}

const GROUP_LABEL_KEYS: Readonly<Record<EntityGroup, string>> = {
    orderDesk: 'kitchen:nav.groups.orderDesk',
    workbench: 'kitchen:nav.groups.workbench',
    catalogue: 'kitchen:nav.groups.catalogue',
    commercial: 'kitchen:nav.groups.commercial',
    operations: 'kitchen:nav.groups.operations',
};

/** Overview + permitted families, sectioned for the ops rail. Empty sections are dropped. */
export function kitchenNavSections(state: AccessState): readonly KitchenNavSection[] {
    const families = permittedFamilies(state);
    const sections: KitchenNavSection[] = [];

    for (const group of ENTITY_GROUPS) {
        const items = families
            .filter((family) => family.group === group)
            .map((family): KitchenNavItem => ({
                key: family.key,
                nameKey: family.nameKey,
                icon: family.icon,
                href: family.href,
            }));
        if (items.length === 0) continue;
        sections.push({
            group,
            labelKey: GROUP_LABEL_KEYS[group],
            items,
        });
    }

    return sections;
}

/**
 * Whether a pathname is this nav item (exact or a nested editor under the list).
 *
 * `/kitchen` alone is Overview — not every family. `/kitchen/ingredients/new` still lights
 * Ingredients.
 */
export function isKitchenNavActive(pathname: string, href: string): boolean {
    if (href === OVERVIEW_HREF) {
        return pathname === '/kitchen' || pathname === '/kitchen/';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}
