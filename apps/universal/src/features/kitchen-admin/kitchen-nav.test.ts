import type { AccessState } from '@healthy360/permissions';

import { ENTITY_FAMILIES } from './entity-registry.ts';
import { activeKitchenNavHref, isKitchenNavActive, kitchenNavSections } from './kitchen-nav.ts';

const managerState: AccessState = {
    mode: 'all-dev',
    session: 'authenticated',
    emailVerified: true,
    hasActiveMembership: true,
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
            // The desk is first: it is the only group whose contents are somebody else's clock.
            'orderDesk',
            'workbench',
            'catalogue',
            'commercial',
            'operations',
            // AA1. A kitchen manager reads the staff list — the registry has always granted
            // `membership.view_organisation` to the role, and the fixture had simply never said so.
            // Last, because the group order is "how immediate is this" and nobody is waiting on
            // access administration.
            'access',
        ]);
        expect(sections.every((section) => section.items.length > 0)).toBe(true);
    });

    it('withholds the access group from somebody who cannot read the staff list', () => {
        const cook: AccessState = {
            ...managerState,
            permissions: new Set(['catalogue.view_organisation', 'recipe.view_organisation']),
        };

        expect(kitchenNavSections(cook).map((section) => section.group)).not.toContain('access');
    });

    it('shows a permissions administrator the access group and nothing else', () => {
        const administrator: AccessState = {
            ...managerState,
            permissions: new Set(['role.view_organisation', 'membership.view_organisation']),
        };

        const sections = kitchenNavSections(administrator);

        expect(sections.map((section) => section.group)).toEqual(['access']);
        expect(sections[0]?.items.map((item) => item.key)).toEqual(['team', 'roles']);
    });

    it('marks list and editor paths active for the same family', () => {
        expect(isKitchenNavActive('/kitchen', '/kitchen')).toBe(true);
        expect(isKitchenNavActive('/kitchen/ingredients', '/kitchen')).toBe(false);
        expect(isKitchenNavActive('/kitchen/ingredients', '/kitchen/ingredients')).toBe(true);
        expect(isKitchenNavActive('/kitchen/ingredients/new', '/kitchen/ingredients')).toBe(true);
    });

    it('marks only the most specific item when a page lives under another', () => {
        const hrefs = ['/kitchen/order-desk', '/kitchen/order-desk/requirements'];
        expect(activeKitchenNavHref('/kitchen/order-desk/requirements', hrefs)).toBe(
            '/kitchen/order-desk/requirements',
        );
        expect(activeKitchenNavHref('/kitchen/order-desk', hrefs)).toBe('/kitchen/order-desk');
        // A page with no item of its own still belongs to the one above it.
        expect(activeKitchenNavHref('/kitchen/order-desk/sale', hrefs)).toBe('/kitchen/order-desk');
        expect(activeKitchenNavHref('/kitchen/stock', hrefs)).toBeNull();
    });
});
