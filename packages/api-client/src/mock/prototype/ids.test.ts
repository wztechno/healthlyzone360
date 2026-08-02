import { isUuid, uuidVersion } from '@healthy360/domain-types';
import { FIXTURE_IDS } from '@healthy360/testing';
import { describe, expect, it } from 'vitest';

import {
    MOCK_BRANCH_IDS,
    MOCK_DEVICE_IDS,
    MOCK_MEMBERSHIP_IDS,
    MOCK_ORGANISATION_IDS,
    MOCK_ROLE_IDS,
    MOCK_USER_IDS,
} from '../ids.ts';
import {
    PROTOTYPE_CATALOGUE_ITEMS,
    PROTOTYPE_DELIVERY_ZONES,
    PROTOTYPE_DIETITIANS,
    PROTOTYPE_GROCERY_LIST,
    PROTOTYPE_INGREDIENTS,
    PROTOTYPE_KITCHENS,
    PROTOTYPE_KITCHEN_BRANCHES,
    PROTOTYPE_MEALS,
    PROTOTYPE_PLANS,
    PROTOTYPE_PLAN_IDS,
    PROTOTYPE_PLAN_VARIANTS,
    PROTOTYPE_PROGRAMMES,
    PROTOTYPE_QUOTATIONS,
    PROTOTYPE_RECIPES,
    PROTOTYPE_REVIEW_QUEUE,
    PROTOTYPE_STORED_TARGET,
    PROTOTYPE_VD_SESSIONS,
    PROTOTYPE_WEEK_ENTRIES,
} from './fixtures/index.ts';
import {
    KITCHEN_ADMIN_ID_BANDS,
    PROTOTYPE_ID_BANDS,
    PROTOTYPE_ID_BAND_NAMES,
    PROTOTYPE_ID_PREFIX,
    PROTOTYPE_ORDINAL_LIMIT,
    PROTOTYPE_RUNTIME_ORDINAL_START,
    PrototypeIdRangeError,
    prototypeId,
} from './ids.ts';

/**
 * Identifier hygiene for the prototype world.
 *
 * Three properties, and all three are load-bearing rather than tidy: every identifier is a
 * well-formed UUIDv7 (so it survives a round trip through anything that validates one), none is
 * repeated (so a lookup by identifier is unambiguous), and none collides with the foundation's mock
 * store or the unit fixtures (so a test can hold both worlds at once).
 *
 * There are exactly **two deliberate exceptions** to the third, and they are asserted rather than
 * excused: kitchen one *is* the Verdant Kitchen organisation, and its Al Quoz branch *is* the mock
 * store's Al Quoz branch. The prototype marketplace and the foundation's organisation world are
 * describing one business.
 */

/** Identifiers the prototype deliberately shares with the foundation world. */
const DELIBERATE_REUSE: readonly string[] = [
    MOCK_ORGANISATION_IDS.verdantKitchen,
    MOCK_BRANCH_IDS.alQuoz,
];

/** Every identifier the fixture world mints, with a label so a failure says which one broke. */
function everyIdentifier(): readonly (readonly [string, string])[] {
    const rows: (readonly [string, string])[] = [];
    const add = (label: string, id: string) => rows.push([label, id]);

    for (const kitchen of PROTOTYPE_KITCHENS) add(`kitchen ${kitchen.slug}`, kitchen.id);
    for (const branch of PROTOTYPE_KITCHEN_BRANCHES) add(`branch ${branch.name}`, branch.id);
    for (const zone of PROTOTYPE_DELIVERY_ZONES) add(`zone ${zone.name}`, zone.id);
    for (const ingredient of PROTOTYPE_INGREDIENTS)
        add(`ingredient ${ingredient.key}`, ingredient.id);
    for (const recipe of PROTOTYPE_RECIPES) add(`recipe ${recipe.slug}`, recipe.id);
    for (const meal of PROTOTYPE_MEALS) add(`meal ${meal.slug}`, meal.id);
    for (const plan of PROTOTYPE_PLANS) add(`plan ${plan.slug}`, plan.id);
    for (const variant of PROTOTYPE_PLAN_VARIANTS) add(`variant ${variant.name}`, variant.id);
    for (const dietitian of PROTOTYPE_DIETITIANS)
        add(`dietitian ${dietitian.displayName}`, dietitian.id);
    for (const entry of PROTOTYPE_WEEK_ENTRIES)
        add(`entry ${entry.date} ${entry.mealType}`, entry.id);
    for (const session of PROTOTYPE_VD_SESSIONS) {
        add(`vd session ${session.state}`, session.id);
        for (const message of session.messages) add(`vd message ${message.id}`, message.id);
    }
    for (const programme of PROTOTYPE_PROGRAMMES) add(`programme ${programme.name}`, programme.id);
    for (const item of PROTOTYPE_CATALOGUE_ITEMS) {
        for (const tier of item.volumeTiers)
            add(`tier ${item.id} ${String(tier.minimumQuantity)}`, tier.id);
    }
    for (const quotation of PROTOTYPE_QUOTATIONS)
        add(`quotation ${quotation.reference}`, quotation.id);
    for (const item of PROTOTYPE_REVIEW_QUEUE) add(`review ${item.subject}`, item.id);

    add('grocery list', PROTOTYPE_GROCERY_LIST.id);
    add('nutrition target', PROTOTYPE_STORED_TARGET.id);
    add('plan (week)', PROTOTYPE_PLAN_IDS.week);
    add('plan (draft)', PROTOTYPE_PLAN_IDS.draft);
    add('plan (template)', PROTOTYPE_PLAN_IDS.template);

    return rows;
}

const IDENTIFIERS = everyIdentifier();

describe('the prototype identifier scheme', () => {
    it('gives every entity type its own two-hex band', () => {
        const bands = Object.values(PROTOTYPE_ID_BANDS);
        expect(new Set(bands).size).toBe(bands.length);
        for (const band of bands) expect(band).toMatch(/^[0-9a-f]{2}$/);
        expect(PROTOTYPE_ID_BAND_NAMES.length).toBe(bands.length);
    });

    it('builds a well-formed UUIDv7 from a band and an ordinal', () => {
        const id = prototypeId('meal', 7);
        expect(id).toBe(`${PROTOTYPE_ID_PREFIX}00000000c007`);
        expect(isUuid(id)).toBe(true);
        expect(uuidVersion(id)).toBe(7);
    });

    it('refuses an ordinal that would not fit in a byte', () => {
        expect(() => prototypeId('meal', -1)).toThrow(PrototypeIdRangeError);
        expect(() => prototypeId('meal', PROTOTYPE_ORDINAL_LIMIT + 1)).toThrow(
            PrototypeIdRangeError,
        );
        expect(() => prototypeId('meal', 1.5)).toThrow(PrototypeIdRangeError);
    });

    it('sits on its own prefix, one greater than the foundation store', () => {
        expect(PROTOTYPE_ID_PREFIX).toBe('01935f6d-0000-7000-8000-');
        expect(PROTOTYPE_ID_PREFIX).not.toBe('01935f6c-0000-7000-8000-');
    });

    /**
     * The K1 management bands. They are declared as a named set rather than discovered, so that the
     * *next* phase to add a band has to decide whether it belongs here — which is the question that
     * keeps "was this row seeded or created?" answerable from an identifier alone.
     */
    it('gives the kitchen-management rows bands of their own', () => {
        for (const band of KITCHEN_ADMIN_ID_BANDS) {
            expect(PROTOTYPE_ID_BAND_NAMES).toContain(band);
        }
        expect(new Set(KITCHEN_ADMIN_ID_BANDS).size).toBe(KITCHEN_ADMIN_ID_BANDS.length);

        // Nothing in a management band collides with a band the fixture world already used.
        const managementCodes = KITCHEN_ADMIN_ID_BANDS.map((band) => PROTOTYPE_ID_BANDS[band]);
        const otherCodes = PROTOTYPE_ID_BAND_NAMES.filter(
            (band) => !KITCHEN_ADMIN_ID_BANDS.includes(band),
        ).map((band) => PROTOTYPE_ID_BANDS[band]);
        expect(managementCodes.filter((code) => otherCodes.includes(code))).toEqual([]);
    });

    it('keeps the runtime ordinals above every fixture ordinal', () => {
        expect(PROTOTYPE_RUNTIME_ORDINAL_START).toBe(0x80);
        const seeded = IDENTIFIERS.filter(([, id]) => id.startsWith(PROTOTYPE_ID_PREFIX)).map(
            ([, id]) => Number.parseInt(id.slice(-2), 16),
        );
        expect(Math.max(...seeded)).toBeLessThan(PROTOTYPE_RUNTIME_ORDINAL_START);
    });
});

describe('every identifier in the fixture world', () => {
    it('has something to check', () => {
        // Guards against a refactor that quietly empties the collector.
        expect(IDENTIFIERS.length).toBeGreaterThan(200);
    });

    it('is a well-formed UUIDv7', () => {
        const malformed = IDENTIFIERS.filter(([, id]) => !isUuid(id) || uuidVersion(id) !== 7).map(
            ([label, id]) => `${label} → ${id}`,
        );
        expect(malformed).toEqual([]);
    });

    it('appears exactly once', () => {
        const seen = new Map<string, string>();
        const duplicates: string[] = [];
        for (const [label, id] of IDENTIFIERS) {
            const first = seen.get(id);
            if (first === undefined) seen.set(id, label);
            else duplicates.push(`${id} used by both "${first}" and "${label}"`);
        }
        expect(duplicates).toEqual([]);
    });

    it('is disjoint from the unit fixtures and the mock store, bar the two deliberate reuses', () => {
        const foundation = new Set<string>([
            ...Object.values(FIXTURE_IDS),
            ...Object.values(MOCK_USER_IDS),
            ...Object.values(MOCK_ORGANISATION_IDS),
            ...Object.values(MOCK_BRANCH_IDS),
            ...Object.values(MOCK_MEMBERSHIP_IDS),
            ...Object.values(MOCK_ROLE_IDS),
            ...Object.values(MOCK_DEVICE_IDS),
        ]);

        const collisions = IDENTIFIERS.filter(
            ([, id]) => foundation.has(id) && !DELIBERATE_REUSE.includes(id),
        ).map(([label, id]) => `${label} → ${id}`);

        expect(collisions).toEqual([]);
    });

    it('reuses exactly the Verdant Kitchen organisation and its Al Quoz branch', () => {
        const kitchen = PROTOTYPE_KITCHENS.find(
            (candidate) => candidate.slug === 'verdant-kitchen',
        );
        expect(kitchen?.id).toBe(MOCK_ORGANISATION_IDS.verdantKitchen);

        const alQuoz = kitchen?.branches.find((branch) => branch.name === 'Al Quoz');
        expect(alQuoz?.id).toBe(MOCK_BRANCH_IDS.alQuoz);

        const reused = IDENTIFIERS.filter(([, id]) => DELIBERATE_REUSE.includes(id));
        expect(reused).toHaveLength(2);
    });

    it('keeps everything else on the prototype prefix', () => {
        const strays = IDENTIFIERS.filter(
            ([, id]) => !id.startsWith(PROTOTYPE_ID_PREFIX) && !DELIBERATE_REUSE.includes(id),
        ).map(([label, id]) => `${label} → ${id}`);
        expect(strays).toEqual([]);
    });
});
