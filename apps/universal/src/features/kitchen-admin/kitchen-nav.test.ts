import type { AccessState } from '@healthy360/permissions';

import { ENTITY_FAMILIES } from './entity-registry.ts';
import { isKitchenNavActive, kitchenNavSections } from './kitchen-nav.ts';

const managerState: AccessState = {
    mode: 'all-dev',
    session: 'authenticated',
    emailVerified: true,
    permissions: new Set(
        ENTITY_FAMILIES.flatMap((family) =>
            [family.permission, family.managePermission].filter(
                (code): code is string => code !== null,
            ),
        ),
    ),
    entitlements: new Set<string>(),
};

describe('kitchen nav', () => {
    it('sections permitted families without empty groups', () => {
        const sections = kitchenNavSections(managerState);
        expect(sections.map((section) => section.group)).toEqual([
            'workbench',
            'catalogue',
            'commercial',
            'operations',
        ]);
        expect(sections.every((section) => section.items.length > 0)).toBe(true);
    });

    it('marks list and editor paths active for the same family', () => {
        expect(isKitchenNavActive('/kitchen', '/kitchen')).toBe(true);
        expect(isKitchenNavActive('/kitchen/ingredients', '/kitchen')).toBe(false);
        expect(isKitchenNavActive('/kitchen/ingredients', '/kitchen/ingredients')).toBe(true);
        expect(isKitchenNavActive('/kitchen/ingredients/new', '/kitchen/ingredients')).toBe(true);
    });
});
