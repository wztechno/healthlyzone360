import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { makeAccessState } from '@healthy360/testing';

import {
    ENTITY_FAMILIES,
    ENTITY_GROUPS,
    PAGE_EXTRAS,
    WORKSPACE_PERMISSIONS,
    familiesInGroup,
    permittedFamilies,
} from './entity-registry.ts';

/*
 * The file three consumers treat as the single source of truth — the hub grid, the rail and every
 * screen's `<Gate>` — and until AA1 it had no test of its own.
 *
 * The last block is the one worth having. It walks `app/kitchen/**` and asserts that every route on
 * disk is a family `href`, a path nested under one, or a declared `PAGE_EXTRAS` row. That is what
 * stops a new screen arriving with a permission gate and no registry entry: a page nobody can find
 * from the rail, and — now — a page the role editor cannot offer.
 */

const KITCHEN_ROUTES = join(__dirname, '..', '..', '..', 'app', 'kitchen');

/** Every route path under `app/kitchen`, as expo-router would address it. */
function routePaths(directory: string = KITCHEN_ROUTES, prefix = '/kitchen'): readonly string[] {
    const paths: string[] = [];

    for (const entry of readdirSync(directory).sort()) {
        const full = join(directory, entry);

        if (statSync(full).isDirectory()) {
            paths.push(...routePaths(full, `${prefix}/${entry}`));
            continue;
        }

        if (!entry.endsWith('.tsx')) continue;
        // `_layout` is chrome, not a destination.
        if (entry.startsWith('_')) continue;
        // Nor is a redirect. A route that only forwards somewhere else has no gate, no registry
        // family and nothing to permit — it exists so an old bookmark still lands. Counting it as
        // a page would demand a card for a path nobody should arrive at twice.
        if (isRedirectOnly(full)) continue;

        const name = entry.replace(/\.tsx$/, '');
        paths.push(name === 'index' ? prefix : `${prefix}/${name}`);
    }

    return paths;
}

/** A route file whose whole body is `<Redirect />` — see the walk above. */
function isRedirectOnly(file: string): boolean {
    const source = readFileSync(file, 'utf8');

    return source.includes('<Redirect ') && !source.includes('lazyScreen(');
}

describe('the permission vocabulary', () => {
    it('gates every family on an organisation-scoped code', () => {
        // The registry is split so no organisation role can hold a platform code. A family gated on
        // one would be a card nobody in a kitchen could ever see.
        for (const family of ENTITY_FAMILIES) {
            expect(family.permission).toMatch(/_(current|organisation|own)$/);
            if (family.managePermission !== null) {
                expect(family.managePermission).toMatch(/_(current|organisation|own)$/);
            }
        }
    });

    it('gates every extra on an organisation-scoped code', () => {
        for (const extra of PAGE_EXTRAS) {
            expect(extra.permission).toMatch(/_(current|organisation|own)$/);
        }
    });

    it('keys every family and extra uniquely', () => {
        const familyKeys = ENTITY_FAMILIES.map((family) => family.key);
        const extraKeys = PAGE_EXTRAS.map((extra) => extra.key);

        expect(new Set(familyKeys).size).toBe(familyKeys.length);
        expect(new Set(extraKeys).size).toBe(extraKeys.length);
    });

    it('draws every extra under a family that exists', () => {
        const keys = new Set(ENTITY_FAMILIES.map((family) => family.key));

        for (const extra of PAGE_EXTRAS) {
            expect(keys.has(extra.familyKey)).toBe(true);
        }
    });

    it('puts every family in a declared group, and leaves no group empty', () => {
        for (const family of ENTITY_FAMILIES) {
            expect(ENTITY_GROUPS).toContain(family.group);
        }
        for (const group of ENTITY_GROUPS) {
            expect(familiesInGroup(group).length).toBeGreaterThan(0);
        }
    });

    it('names i18n keys rather than literals', () => {
        for (const family of ENTITY_FAMILIES) {
            expect(family.nameKey).toMatch(/^[a-zA-Z]+:/);
            expect(family.descriptionKey).toMatch(/^[a-zA-Z]+:/);
        }
        for (const extra of PAGE_EXTRAS) {
            expect(extra.nameKey).toMatch(/^[a-zA-Z]+:/);
        }
    });
});

describe('the workspace gate', () => {
    it('is the deduplicated set of every family permission', () => {
        expect([...WORKSPACE_PERMISSIONS].sort()).toEqual(
            [...new Set(ENTITY_FAMILIES.map((family) => family.permission))].sort(),
        );
    });

    it('lets an access administrator into a workspace rather than a forbidden page', () => {
        // What `WORKSPACE_PERMISSIONS`' own docblock promises, and what the AA1 families are the
        // first to make testable: holding *one* of these opens the hub, and the grid then shows
        // exactly the cards that code reaches.
        const state = makeAccessState({ permissions: ['role.view_organisation'] });

        expect(WORKSPACE_PERMISSIONS).toContain('role.view_organisation');
        expect(permittedFamilies(state).map((family) => family.key)).toEqual(['roles']);
    });

    it('shows nothing at all to somebody holding none of them', () => {
        expect(permittedFamilies(makeAccessState({ permissions: ['profile.view_own'] }))).toEqual(
            [],
        );
    });
});

describe('every kitchen route is accounted for', () => {
    it('finds the routes on disk', () => {
        // A guard on the guard: if the walk ever returns nothing, the assertion below would pass
        // vacuously and stop protecting anything.
        expect(routePaths().length).toBeGreaterThan(30);
    });

    it('maps each one to a family, a path nested under one, or a declared extra', () => {
        const hrefs = ENTITY_FAMILIES.map((family) => family.href);
        const extras = new Set(PAGE_EXTRAS.map((extra) => extra.href));

        const orphans = routePaths().filter((path) => {
            // The hub itself, which is the workspace rather than a family.
            if (path === '/kitchen') return false;
            if (extras.has(path)) return false;
            return !hrefs.some((href) => path === href || path.startsWith(`${href}/`));
        });

        expect(orphans).toEqual([]);
    });

    it('gives every family a route that exists', () => {
        // The other direction, and the one that catches a card linking nowhere. A family is a rail
        // entry and a hub card as well as a gate, so an href with no file behind it is a dead link
        // in the one place a person looks to find a screen.
        const routes = new Set(routePaths());

        expect(ENTITY_FAMILIES.filter((family) => !routes.has(family.href))).toEqual([]);
    });

    it('gives every extra a route that exists', () => {
        const routes = new Set(routePaths());

        expect(PAGE_EXTRAS.filter((extra) => !routes.has(extra.href))).toEqual([]);
    });
});
