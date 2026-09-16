import {
    ENTITY_FAMILIES,
    ENTITY_GROUPS,
    PAGE_EXTRAS,
    extrasForFamily,
    familiesInGroup,
} from './entity-registry.ts';
import type { EntityFamily, EntityGroup, PageExtra } from './entity-registry.ts';

/**
 * Turning a role's permission codes into a grid of pages, and back.
 *
 * The role editor's Pages tab exists because an administrator thinks in screens and the server
 * thinks in codes. This module is the whole of the translation, kept pure so it is table-testable
 * without rendering anything — the same reason `kitchen-nav.ts` is a pure function of an
 * `AccessState`.
 *
 * ## It is a projection, not a set of switches
 *
 * `catalogue.view_organisation` is the `permission` of eleven families, so Ingredients → View also
 * lights Products, Sauces, Meals, Packaging, Plans and more. There is no way around that: the
 * backend gates all eleven on one code, and inventing a per-page code would be inventing an
 * authority the server does not have.
 *
 * So the grid is **recomputed from the code set after every change** rather than holding per-row
 * state. The sibling rows visibly move at the same moment, each row says what else it opens, and
 * the tab can never show a combination the codes do not actually produce. A set of independent
 * switches would drift from the truth on the first toggle.
 *
 * ## The invariant that makes Pages and Advanced safe to mix
 *
 * ```
 * saved = existing − (every code any row or sub-row names) + (the codes the rows now select)
 * ```
 *
 * Pages owns exactly the codes the registry names and **never removes one it cannot express**. The
 * twenty-odd codes no page names — the publish codes, `order.view_customer_contact_organisation`,
 * the own-scope six — survive a save made entirely on this tab. {@link unmappedCodes} is what the
 * editor renders in its "not on any page" band so that they are visible rather than merely
 * preserved.
 */

/* ── levels ───────────────────────────────────────────────────────────────────────────────────── */

export const PAGE_LEVELS = ['none', 'view', 'manage'] as const;
export type PageLevel = (typeof PAGE_LEVELS)[number];

/**
 * Which levels a family can actually be set to.
 *
 * Three degenerate shapes, all read from the registry rather than listed by hand:
 *
 *  * `managePermission === null` — nine families nobody can write from this workspace. None / View.
 *  * `permission === managePermission` — the supply-order book, where the registry is explicit that
 *    there is no view-only reading: the code that opens it is the code that writes it. None /
 *    Manage, and the middle option would be a lie.
 *  * everything else — the full three.
 */
export function levelsFor(family: EntityFamily): readonly PageLevel[] {
    if (family.managePermission === null) return ['none', 'view'];
    if (family.managePermission === family.permission) return ['none', 'manage'];
    return PAGE_LEVELS;
}

/** The level a code set puts a family at. */
export function pageLevelFor(family: EntityFamily, codes: ReadonlySet<string>): PageLevel {
    const manages = family.managePermission !== null && codes.has(family.managePermission);

    // A family whose two codes are the same reads Manage from the one code, because that is what
    // holding it means — see `levelsFor`.
    if (manages && family.managePermission === family.permission) return 'manage';
    if (!codes.has(family.permission)) return 'none';
    return manages ? 'manage' : 'view';
}

/** Whether a sub-row's code is present. Sub-rows are a checkbox, not a level. */
export function extraEnabled(extra: PageExtra, codes: ReadonlySet<string>): boolean {
    return codes.has(extra.permission);
}

/* ── the rows ─────────────────────────────────────────────────────────────────────────────────── */

export interface PageRow {
    readonly family: EntityFamily;
    readonly level: PageLevel;
    readonly levels: readonly PageLevel[];
    /**
     * Other families that move with this one, because they share its `permission`. Empty for a
     * family that owns its code. The editor renders this as "this also opens: …" so that a row
     * moving its siblings looks deliberate rather than broken.
     */
    readonly alsoOpens: readonly EntityFamily[];
    readonly extras: readonly { readonly extra: PageExtra; readonly enabled: boolean }[];
}

export interface PageSection {
    readonly group: EntityGroup;
    readonly rows: readonly PageRow[];
}

/** The whole grid, derived from a code set. Recomputed on every change — see the module docblock. */
export function pageSections(
    codes: ReadonlySet<string>,
    families: readonly EntityFamily[] = ENTITY_FAMILIES,
    extras: readonly PageExtra[] = PAGE_EXTRAS,
): readonly PageSection[] {
    const sections: PageSection[] = [];

    for (const group of ENTITY_GROUPS) {
        const inGroup = familiesInGroup(group, families);
        if (inGroup.length === 0) continue;

        sections.push({
            group,
            rows: inGroup.map((family) => ({
                family,
                level: pageLevelFor(family, codes),
                levels: levelsFor(family),
                alsoOpens: families.filter(
                    (other) => other.key !== family.key && other.permission === family.permission,
                ),
                extras: extrasForFamily(family.key, extras).map((extra) => ({
                    extra,
                    enabled: extraEnabled(extra, codes),
                })),
            })),
        });
    }

    return sections;
}

/* ── writing back ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Every code any row or sub-row can express.
 *
 * The left-hand side of the invariant in the module docblock: these are the codes the Pages tab
 * owns, and the only ones a save from it may remove.
 */
export function codesNamedByPages(
    families: readonly EntityFamily[] = ENTITY_FAMILIES,
    extras: readonly PageExtra[] = PAGE_EXTRAS,
): ReadonlySet<string> {
    const named = new Set<string>();

    for (const family of families) {
        named.add(family.permission);
        if (family.managePermission !== null) named.add(family.managePermission);
    }

    for (const extra of extras) named.add(extra.permission);

    return named;
}

/** The codes a role holds that no page can show. Rendered read-only, and never dropped by a save. */
export function unmappedCodes(
    codes: ReadonlySet<string>,
    families: readonly EntityFamily[] = ENTITY_FAMILIES,
    extras: readonly PageExtra[] = PAGE_EXTRAS,
): readonly string[] {
    const named = codesNamedByPages(families, extras);

    return [...codes].filter((code) => !named.has(code)).sort();
}

/**
 * Set one family to a level, and return the new code set.
 *
 * Manage implies View, because the registry's pairs are cumulative — `catalogue.manage_organisation`
 * without its partner is a state no screen can reach and no backend role holds. Setting None
 * removes both.
 *
 * What it does **not** do is reason about the siblings. Removing `catalogue.view_organisation` takes
 * it away from all eleven families at once, which is exactly what the server would do, and
 * {@link pageSections} recomputed afterwards is what shows the person that it happened.
 */
export function applyPageLevel(
    codes: ReadonlySet<string>,
    family: EntityFamily,
    level: PageLevel,
): ReadonlySet<string> {
    const next = new Set(codes);

    if (level === 'none') {
        next.delete(family.permission);
        if (family.managePermission !== null) next.delete(family.managePermission);
        return next;
    }

    next.add(family.permission);

    if (family.managePermission !== null) {
        if (level === 'manage') next.add(family.managePermission);
        else next.delete(family.managePermission);
    }

    return next;
}

/** Turn a sub-row on or off. */
export function applyExtra(
    codes: ReadonlySet<string>,
    extra: PageExtra,
    enabled: boolean,
): ReadonlySet<string> {
    const next = new Set(codes);

    if (enabled) next.add(extra.permission);
    else next.delete(extra.permission);

    return next;
}

/** The order a grant list is saved in, so two saves that changed nothing produce the same array. */
export function toSavedCodes(codes: ReadonlySet<string>): readonly string[] {
    return [...codes].sort();
}
