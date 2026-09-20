import {
    ENTITY_FAMILIES,
    PAGE_EXTRAS,
    extrasForFamily,
    familiesInGroup,
} from './entity-registry.ts';
import type { EntityFamily } from './entity-registry.ts';
import {
    applyExtra,
    applyPageLevel,
    codesNamedByPages,
    levelsFor,
    pageLevelFor,
    pageSections,
    toSavedCodes,
    unmappedCodes,
} from './page-permissions.ts';

/*
 * The Pages tab is a lossless projection over a role's permission codes, and these are the four
 * claims that makes true. The last one is the load-bearing one: a save from this tab must never
 * drop a code no page can show, because a role edited on Pages would otherwise silently lose its
 * publish rights.
 */

function family(key: string): EntityFamily {
    const found = ENTITY_FAMILIES.find((candidate) => candidate.key === key);
    if (found === undefined) throw new Error(`No family ${key}`);
    return found;
}

describe('levels a family offers', () => {
    it('offers None and View where nobody can write from this workspace', () => {
        // Nine families have no manage code. A Manage option there would be an offer the backend
        // cannot honour.
        const readOnly = ENTITY_FAMILIES.filter((f) => f.managePermission === null);

        expect(readOnly.length).toBeGreaterThan(0);
        for (const f of readOnly) {
            expect(levelsFor(f)).toEqual(['none', 'view']);
        }
    });

    it('offers None and Manage where the reading code is the writing code', () => {
        // The supply-order book: the registry is explicit that there is no view-only reading of who
        // this kitchen buys from, so a middle option would be a lie.
        expect(levelsFor(family('supplyOrders'))).toEqual(['none', 'manage']);
    });

    it('offers all three where the pair genuinely splits', () => {
        expect(levelsFor(family('ingredients'))).toEqual(['none', 'view', 'manage']);
    });
});

describe('reading a level off a code set', () => {
    it('reads None, View and Manage from the codes the backend would check', () => {
        const ingredients = family('ingredients');

        expect(pageLevelFor(ingredients, new Set())).toBe('none');
        expect(pageLevelFor(ingredients, new Set(['catalogue.view_organisation']))).toBe('view');
        expect(
            pageLevelFor(
                ingredients,
                new Set(['catalogue.view_organisation', 'catalogue.manage_organisation']),
            ),
        ).toBe('manage');
    });

    it('reads Manage from one code where the family has only one', () => {
        expect(
            pageLevelFor(
                family('supplyOrders'),
                new Set(['inventory.order_supplies_organisation']),
            ),
        ).toBe('manage');
    });

    it('reads a level for every family without throwing', () => {
        // The table-driven sweep the registry's shape is meant to make possible.
        const everything = new Set(
            ENTITY_FAMILIES.flatMap((f) =>
                f.managePermission === null ? [f.permission] : [f.permission, f.managePermission],
            ),
        );

        for (const f of ENTITY_FAMILIES) {
            expect(levelsFor(f)).toContain(pageLevelFor(f, everything));
            expect(pageLevelFor(f, new Set())).toBe('none');
        }
    });
});

describe('the grid', () => {
    it('names the siblings a shared code moves with it', () => {
        // `catalogue.view_organisation` gates eleven families. The row has to say so, because
        // setting one and watching ten others move is otherwise indistinguishable from a bug.
        const sections = pageSections(new Set());
        const rows = sections.flatMap((section) => section.rows);
        const ingredients = rows.find((row) => row.family.key === 'ingredients');

        expect(ingredients).toBeDefined();
        expect(ingredients?.alsoOpens.length).toBeGreaterThan(5);
        for (const sibling of ingredients?.alsoOpens ?? []) {
            expect(sibling.permission).toBe('catalogue.view_organisation');
            expect(sibling.key).not.toBe('ingredients');
        }
    });

    it('leaves a family that owns its code with no siblings', () => {
        const rows = pageSections(new Set()).flatMap((section) => section.rows);

        expect(rows.find((row) => row.family.key === 'supplyOrders')?.alsoOpens).toEqual([]);
    });

    it('moves the siblings when one of them is set', () => {
        // The projection, stated. Setting Ingredients to View is setting eleven pages to View,
        // because that is what the one code the backend checks actually does.
        const next = applyPageLevel(new Set(), family('ingredients'), 'view');
        const rows = pageSections(next).flatMap((row) => row.rows);

        expect(rows.find((row) => row.family.key === 'products')?.level).toBe('view');
        expect(rows.find((row) => row.family.key === 'meals')?.level).toBe('view');
        // And nothing on a different code moved.
        expect(rows.find((row) => row.family.key === 'orders')?.level).toBe('none');
    });

    it('covers every family exactly once, in group order', () => {
        const rows = pageSections(new Set()).flatMap((section) => section.rows);

        expect(rows).toHaveLength(ENTITY_FAMILIES.length);
        expect(rows.map((row) => row.family.key).sort()).toEqual(
            ENTITY_FAMILIES.map((f) => f.key).sort(),
        );
    });

    it('draws every extra under the family that owns it', () => {
        const rows = pageSections(new Set()).flatMap((section) => section.rows);

        for (const extra of PAGE_EXTRAS) {
            const parent = rows.find((row) => row.family.key === extra.familyKey);
            expect(parent).toBeDefined();
            expect(parent?.extras.map((entry) => entry.extra.key)).toContain(extra.key);
        }
    });

    it('draws the access group last', () => {
        // Not decoration: the group order is "how immediate is this", and nobody is waiting on
        // access administration.
        const sections = pageSections(new Set());

        expect(sections.at(-1)?.group).toBe('access');
        expect(familiesInGroup('access').map((f) => f.key)).toEqual(['team', 'roles']);
    });
});

describe('writing back', () => {
    it('makes Manage imply View', () => {
        // The registry's pairs are cumulative: a manage code without its partner is a state no
        // screen reaches and no backend role holds.
        const next = applyPageLevel(new Set(), family('ingredients'), 'manage');

        expect(next.has('catalogue.view_organisation')).toBe(true);
        expect(next.has('catalogue.manage_organisation')).toBe(true);
    });

    it('drops the manage code when a row falls back to View', () => {
        const manage = applyPageLevel(new Set(), family('ingredients'), 'manage');
        const view = applyPageLevel(manage, family('ingredients'), 'view');

        expect(view.has('catalogue.view_organisation')).toBe(true);
        expect(view.has('catalogue.manage_organisation')).toBe(false);
    });

    it('drops both when a row falls to None', () => {
        const manage = applyPageLevel(new Set(), family('ingredients'), 'manage');
        const none = applyPageLevel(manage, family('ingredients'), 'none');

        expect(none.has('catalogue.view_organisation')).toBe(false);
        expect(none.has('catalogue.manage_organisation')).toBe(false);
    });

    it('round-trips every family through every level it offers', () => {
        for (const f of ENTITY_FAMILIES) {
            for (const level of levelsFor(f)) {
                expect(pageLevelFor(f, applyPageLevel(new Set(), f, level))).toBe(level);
            }
        }
    });

    it('toggles an extra without touching its parent', () => {
        const extra = extrasForFamily('order-desk')[0];
        expect(extra).toBeDefined();

        const on = applyExtra(new Set(['order.view_organisation']), extra!, true);
        expect(on.has(extra!.permission)).toBe(true);
        expect(on.has('order.view_organisation')).toBe(true);

        const off = applyExtra(on, extra!, false);
        expect(off.has(extra!.permission)).toBe(false);
        expect(off.has('order.view_organisation')).toBe(true);
    });
});

describe('the codes no page can show', () => {
    it('never removes one', () => {
        // **The invariant.** A role edited entirely on the Pages tab keeps its publish rights, its
        // customer-contact code and its own-scope six — none of which any row names.
        const held = new Set([
            'catalogue.view_organisation',
            'recipe.publish_organisation',
            'plan.publish_organisation',
            'order.view_customer_contact_organisation',
            'profile.update_own',
        ]);

        let next: ReadonlySet<string> = held;
        for (const f of ENTITY_FAMILIES) {
            next = applyPageLevel(next, f, 'none');
        }

        expect(next.has('recipe.publish_organisation')).toBe(true);
        expect(next.has('plan.publish_organisation')).toBe(true);
        expect(next.has('order.view_customer_contact_organisation')).toBe(true);
        expect(next.has('profile.update_own')).toBe(true);
        // And the one a page *does* name is gone, which is the other half of the claim.
        expect(next.has('catalogue.view_organisation')).toBe(false);
    });

    it('lists exactly what the grid could not express', () => {
        const held = new Set([
            'catalogue.view_organisation',
            'recipe.publish_organisation',
            'profile.update_own',
        ]);

        expect(unmappedCodes(held)).toEqual(['profile.update_own', 'recipe.publish_organisation']);
    });

    it('names every registry code and no more', () => {
        const named = codesNamedByPages();

        for (const f of ENTITY_FAMILIES) {
            expect(named.has(f.permission)).toBe(true);
            if (f.managePermission !== null) expect(named.has(f.managePermission)).toBe(true);
        }
        for (const extra of PAGE_EXTRAS) {
            expect(named.has(extra.permission)).toBe(true);
        }
        expect(named.has('recipe.publish_organisation')).toBe(false);
        expect(named.has('role.manage_organisation')).toBe(true);
    });
});

describe('saving', () => {
    it('sorts, so two saves that changed nothing produce the same array', () => {
        expect(toSavedCodes(new Set(['b.view_organisation', 'a.view_organisation']))).toEqual([
            'a.view_organisation',
            'b.view_organisation',
        ]);
    });
});
