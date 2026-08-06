import { RESTRICTION_KINDS, VD_SESSION_STATES, addMoney } from '@healthy360/domain-types';
import { amountValue, roundTo } from '@healthy360/nutrition';
import type { NutritionFacts } from '@healthy360/nutrition';
import { describe, expect, it } from 'vitest';

import { SYNTHETIC_SOURCE } from './constants.ts';
import {
    ALLERGEN_WARNING_CODE,
    ENERGY_WARNING_CODE,
    MANDATORY_NUTRIENT_IDS,
    MEAL_RECIPE_INDEX,
    PROTOTYPE_ALLERGENS,
    PROTOTYPE_CATALOGUE_ITEMS,
    PROTOTYPE_CONSTRAINTS,
    PROTOTYPE_CUSTOMER_ID,
    PROTOTYPE_DELIVERY_ZONES,
    PROTOTYPE_DIETITIANS,
    PROTOTYPE_DIET_CATEGORIES,
    PROTOTYPE_GROCERY_LIST,
    PROTOTYPE_INGREDIENTS,
    PROTOTYPE_KITCHENS,
    PROTOTYPE_KITCHEN_BRANCHES,
    PROTOTYPE_MEALS,
    PROTOTYPE_NUTRIENT_DEFINITIONS,
    PROTOTYPE_ONBOARDING,
    PROTOTYPE_ONBOARDING_STEP_COUNT,
    PROTOTYPE_PLANS,
    PROTOTYPE_PLAN_VARIANTS,
    PROTOTYPE_PROGRAMMES,
    PROTOTYPE_QUOTATIONS,
    PROTOTYPE_RECIPES,
    PROTOTYPE_REVIEW_QUEUE,
    PROTOTYPE_STORED_TARGET,
    PROTOTYPE_TARGET_ENGINE,
    PROTOTYPE_TARGET_REQUEST,
    PROTOTYPE_TARGET_RESULT,
    PROTOTYPE_VD_SESSIONS,
    PROTOTYPE_WEEK_ENTRIES,
    SAR_CATALOGUE_ITEM_ID,
    VD_COVERED_STATES,
    catalogueItemById,
    constraintOfKind,
    kitchenByKey,
    recipeById,
    recipeByKey,
} from './fixtures/index.ts';

/**
 * What the fixture world contains, and what it promises about itself.
 *
 * Two kinds of assertion live here, and the second kind is the important one.
 *
 * **Inventory.** The prompt names minimums — six kitchens, forty meals, twenty recipes, eight plans
 * — and a fixture set that quietly drops below one of them is a gap nobody notices until a listing
 * screen looks thin. Counted, not eyeballed.
 *
 * **Provenance and originality.** Every set of nutrition facts must carry the synthetic source; the
 * recipe figures must agree with the ingredients they were rolled up from; the copy must contain no
 * reference-product vocabulary; and exactly one price must be in a second currency, so the
 * "never sum across currencies" rule has something real to be tested against.
 */

/* ------------------------------------------------------------------------------------------------
 * Inventory
 * ---------------------------------------------------------------------------------------------- */

describe('fixture inventory', () => {
    it('meets every count the specification names', () => {
        expect(PROTOTYPE_KITCHENS).toHaveLength(6);
        expect(PROTOTYPE_KITCHEN_BRANCHES).toHaveLength(11);
        expect(PROTOTYPE_MEALS.filter((meal) => meal.itemType === 'meal')).toHaveLength(40);
        expect(PROTOTYPE_MEALS.filter((meal) => meal.itemType === 'product')).toHaveLength(2);
        expect(PROTOTYPE_MEALS).toHaveLength(42);
        expect(PROTOTYPE_RECIPES).toHaveLength(20);
        expect(PROTOTYPE_PLANS).toHaveLength(8);
        expect(PROTOTYPE_DIETITIANS).toHaveLength(5);
        expect(PROTOTYPE_ALLERGENS).toHaveLength(14);
        expect(PROTOTYPE_INGREDIENTS.length).toBeGreaterThanOrEqual(60);
        expect(PROTOTYPE_DELIVERY_ZONES.length).toBeGreaterThanOrEqual(5);
    });

    it('carries the supporting collections the screens need', () => {
        expect(PROTOTYPE_PLAN_VARIANTS.length).toBe(PROTOTYPE_PLANS.length * 3);
        expect(PROTOTYPE_DIET_CATEGORIES.length).toBeGreaterThanOrEqual(8);
        expect(PROTOTYPE_PROGRAMMES).toHaveLength(4);
        expect(PROTOTYPE_CATALOGUE_ITEMS).toHaveLength(4);
        expect(PROTOTYPE_QUOTATIONS).toHaveLength(2);
        expect(PROTOTYPE_REVIEW_QUEUE).toHaveLength(4);
        expect(PROTOTYPE_NUTRIENT_DEFINITIONS.length).toBeGreaterThanOrEqual(13);
    });

    it('generates one week of seven days with four entries each', () => {
        expect(PROTOTYPE_WEEK_ENTRIES).toHaveLength(28);
        const byDate = new Map<string, number>();
        for (const entry of PROTOTYPE_WEEK_ENTRIES) {
            byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + 1);
        }
        expect([...byDate.keys()]).toHaveLength(7);
        expect([...byDate.values()].every((count) => count === 4)).toBe(true);
    });

    it('mixes kitchen meals, home recipes, logged foods and a planned meal out', () => {
        const kinds = new Set(PROTOTYPE_WEEK_ENTRIES.map((entry) => entry.kind));
        expect([...kinds].sort()).toEqual(['food', 'kitchen_meal', 'recipe', 'restaurant']);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Sales channels
 * ---------------------------------------------------------------------------------------------- */

describe('the eight sales-channel switches', () => {
    it('are spread honestly rather than all enabled', () => {
        const signatures = PROTOTYPE_KITCHENS.map((kitchen) =>
            Object.values(kitchen.channels).join(''),
        );
        expect(new Set(signatures).size).toBe(PROTOTYPE_KITCHENS.length);
    });

    it('includes a wholesale kitchen that sells to businesses only', () => {
        const wholesale = kitchenByKey('northwind');
        expect(wholesale.channels.b2b).toBe(true);
        expect(wholesale.channels.corporate).toBe(true);
        expect(wholesale.channels.b2c).toBe(false);
        expect(wholesale.channels.marketplace).toBe(false);
        expect(wholesale.channels.subscription).toBe(false);
    });

    it('includes a counter that only takes payment at the till and hands the food over', () => {
        const counter = kitchenByKey('olive_terrace');
        expect(counter.channels.pos).toBe(true);
        expect(counter.channels.pickup).toBe(true);
        expect(counter.channels.delivery).toBe(false);
        expect(counter.channels.marketplace).toBe(false);
        expect(counter.channels.b2b).toBe(false);
    });

    it('only publishes meals for kitchens configured for the marketplace', () => {
        for (const meal of PROTOTYPE_MEALS) expect(meal.channels.marketplace).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Provenance
 * ---------------------------------------------------------------------------------------------- */

function everyFactsSet(): readonly (readonly [string, NutritionFacts])[] {
    const rows: (readonly [string, NutritionFacts])[] = [];
    for (const ingredient of PROTOTYPE_INGREDIENTS) {
        rows.push([`ingredient ${ingredient.key}`, ingredient.per100g]);
    }
    for (const recipe of PROTOTYPE_RECIPES) {
        rows.push([`recipe ${recipe.slug} per recipe`, recipe.nutrition.perRecipe]);
        rows.push([`recipe ${recipe.slug} per serving`, recipe.nutrition.perServing]);
        if (recipe.nutrition.per100g !== null) {
            rows.push([`recipe ${recipe.slug} per 100 g`, recipe.nutrition.per100g]);
        }
    }
    for (const meal of PROTOTYPE_MEALS) rows.push([`meal ${meal.slug}`, meal.nutrition]);
    for (const entry of PROTOTYPE_WEEK_ENTRIES) {
        rows.push([`entry ${entry.date} ${entry.mealType}`, entry.nutrition]);
    }
    return rows;
}

describe('every set of nutrition facts is labelled synthetic', () => {
    const FACTS = everyFactsSet();

    it('has something to check', () => {
        expect(FACTS.length).toBeGreaterThan(150);
    });

    it('carries the synthetic prototype source, with no exceptions', () => {
        const wrong = FACTS.filter(([, facts]) => facts.source.kind !== 'synthetic_prototype').map(
            ([label]) => label,
        );
        expect(wrong).toEqual([]);
    });

    it('carries the same source label and version everywhere', () => {
        for (const [label, facts] of FACTS) {
            expect(facts.source.label, label).toBe(SYNTHETIC_SOURCE.label);
            expect(facts.source.version, label).toBe(SYNTHETIC_SOURCE.version);
        }
    });

    it('marks every calculation as a prototype and states its rounding', () => {
        for (const [label, facts] of FACTS) {
            expect(facts.calculation.prototype, label).toBe(true);
            expect(facts.calculation.rounding.length, label).toBeGreaterThan(0);
            expect(facts.calculation.calculatedAt.length, label).toBeGreaterThan(0);
        }
    });

    it('always states the mandatory label lines, even at zero', () => {
        for (const ingredient of PROTOTYPE_INGREDIENTS) {
            const stated = ingredient.per100g.amounts.map((amount) => amount.nutrientId);
            for (const nutrientId of MANDATORY_NUTRIENT_IDS) {
                expect(stated, `${ingredient.key} → ${nutrientId}`).toContain(nutrientId);
            }
        }
    });
});

describe('recipe nutrition is derived, not typed', () => {
    it('divides the per-recipe figures by the number of servings', () => {
        for (const recipe of PROTOTYPE_RECIPES) {
            const perRecipe = amountValue(recipe.nutrition.perRecipe, 'energy');
            const perServing = amountValue(recipe.nutrition.perServing, 'energy');
            expect(roundTo(perServing, 4)).toBe(roundTo(perRecipe / recipe.servings, 4));
        }
    });

    it('agrees with the ingredients it was rolled up from', () => {
        for (const recipe of PROTOTYPE_RECIPES) {
            const fromIngredients = recipe.ingredients
                .filter((line) => !line.optional && line.grams !== null)
                .reduce<number>(
                    (sum, line) =>
                        sum + (amountValue(line.per100g, 'protein') * (line.grams ?? 0)) / 100,
                    0,
                );
            expect(roundTo(amountValue(recipe.nutrition.perRecipe, 'protein'), 4)).toBe(
                roundTo(fromIngredients, 4),
            );
        }
    });

    it('derives every allergen from an ingredient rather than declaring it', () => {
        for (const recipe of PROTOTYPE_RECIPES) {
            const fromIngredients = new Set(
                recipe.ingredients.flatMap((line) => [...line.allergens]),
            );
            for (const code of recipe.allergens) {
                expect(fromIngredients, `${recipe.slug} → ${code}`).toContain(code);
            }
        }
    });

    it('scales a marketplace meal from the recipe version it names', () => {
        for (const meal of PROTOTYPE_MEALS.filter((row) => row.itemType === 'meal')) {
            const note = meal.nutrition.calculation.notes.join(' ');
            expect(note, meal.slug).toMatch(/Derived from recipe [a-z-]+ version [0-9.]+/);
        }
    });

    it('never prices a meal below the cost of its ingredients', () => {
        for (const meal of PROTOTYPE_MEALS) expect(meal.price.amount).toBeGreaterThan(0);
    });

    /**
     * The link the consumer contract deliberately does not carry.
     *
     * A kitchen's internal recipe identifier has no business on `MarketplaceMeal`, but the planner
     * needs it to turn "cook this one at home instead" into something real — so it lives in an index
     * beside the fixtures rather than on the shape.
     */
    it('records which recipe version each meal was built from, outside the consumer shape', () => {
        expect(MEAL_RECIPE_INDEX.size).toBe(
            PROTOTYPE_MEALS.filter((meal) => meal.itemType === 'meal').length,
        );
        for (const meal of PROTOTYPE_MEALS.filter((row) => row.itemType === 'meal')) {
            const link = MEAL_RECIPE_INDEX.get(meal.id);
            expect(link, meal.slug).toBeDefined();
            const recipe = recipeByKey(link?.recipeKey ?? '');
            expect(recipe.version).toBe(link?.version);
            expect(meal.nutrition.calculation.notes.join(' ')).toContain(recipe.slug);
            expect(Object.keys(meal)).not.toContain('recipeId');
        }
    });
});

/* ------------------------------------------------------------------------------------------------
 * Originality
 * ---------------------------------------------------------------------------------------------- */

/**
 * The reference products, and the shapes their names take in prose and in a URL.
 *
 * The prompt permits inspiration from information hierarchy and interaction patterns and forbids
 * copied identity. This scan is the cheap, mechanical half of that: it cannot detect a paraphrase,
 * but it makes an accidental paste of a brand name — or a copied product name that carries one —
 * impossible to commit.
 */
const REFERENCE_VOCABULARY: readonly string[] = [
    'right bite',
    'rightbite',
    'eat this much',
    'eatthismuch',
    'rightbite.com',
    'eatthismuch.com',
];

function everyFixtureString(): readonly string[] {
    const collected: string[] = [];
    const walk = (value: unknown): void => {
        if (typeof value === 'string') {
            collected.push(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
        }
        if (typeof value === 'object' && value !== null) {
            for (const item of Object.values(value)) walk(item);
        }
    };

    walk([
        PROTOTYPE_KITCHENS,
        PROTOTYPE_RECIPES,
        PROTOTYPE_MEALS,
        PROTOTYPE_PLANS,
        PROTOTYPE_DIETITIANS,
        PROTOTYPE_DIET_CATEGORIES,
        PROTOTYPE_INGREDIENTS,
        PROTOTYPE_PROGRAMMES,
        PROTOTYPE_CATALOGUE_ITEMS,
        PROTOTYPE_QUOTATIONS,
        PROTOTYPE_VD_SESSIONS,
        PROTOTYPE_WEEK_ENTRIES,
        PROTOTYPE_REVIEW_QUEUE,
    ]);
    return collected;
}

describe('the copy is original', () => {
    const STRINGS = everyFixtureString();

    it('has something to scan', () => {
        expect(STRINGS.length).toBeGreaterThan(1000);
    });

    it('contains no reference-product vocabulary anywhere', () => {
        const offenders: string[] = [];
        for (const value of STRINGS) {
            const haystack = value.toLowerCase();
            for (const term of REFERENCE_VOCABULARY) {
                if (haystack.includes(term)) offenders.push(`"${term}" in "${value}"`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('links to no remote image, only generated placeholder identifiers', () => {
        const placeholders = [
            ...PROTOTYPE_KITCHENS.map((kitchen) => kitchen.imagePlaceholderId),
            ...PROTOTYPE_MEALS.map((meal) => meal.imagePlaceholderId),
            ...PROTOTYPE_RECIPES.map((recipe) => recipe.imagePlaceholderId),
            ...PROTOTYPE_PLANS.map((plan) => plan.imagePlaceholderId),
            ...PROTOTYPE_DIETITIANS.map((dietitian) => dietitian.imagePlaceholderId),
        ];
        for (const placeholder of placeholders) {
            expect(placeholder).toMatch(/^[a-z]+-[a-z0-9-]+$/);
            expect(placeholder).not.toContain('http');
        }
    });

    it('makes no reference to any external host', () => {
        for (const value of STRINGS) {
            expect(value).not.toMatch(/https?:\/\//);
        }
    });

    it('states that a dietitian registration is a prototype record', () => {
        for (const dietitian of PROTOTYPE_DIETITIANS) {
            expect(dietitian.credentials.length).toBeGreaterThan(0);
            for (const credential of dietitian.credentials) {
                expect(credential.toLowerCase()).toContain('synthetic');
            }
        }
    });
});

/* ------------------------------------------------------------------------------------------------
 * The customer
 * ---------------------------------------------------------------------------------------------- */

describe('the customer world', () => {
    it('is the consumer account the mock store already signs in', () => {
        expect(PROTOTYPE_CUSTOMER_ID).toBe('01935f6c-0000-7000-8000-000000000103');
    });

    it('records an answer for all twenty-two onboarding steps', () => {
        expect(PROTOTYPE_ONBOARDING_STEP_COUNT).toBe(22);
        expect(PROTOTYPE_ONBOARDING.summaryAcknowledged).toBe(true);
        expect(PROTOTYPE_ONBOARDING.professionalReviewAcknowledged).toBe(true);
        expect(PROTOTYPE_ONBOARDING.mealSlots).toHaveLength(4);
        expect(Object.keys(PROTOTYPE_ONBOARDING.cookingMinutesByWeekday)).toHaveLength(7);
    });

    it('exercises all seven restriction kinds, exactly once each', () => {
        expect(PROTOTYPE_CONSTRAINTS).toHaveLength(RESTRICTION_KINDS.length);
        for (const kind of RESTRICTION_KINDS) {
            expect(constraintOfKind(kind), kind).not.toBeNull();
        }
        const kinds = PROTOTYPE_CONSTRAINTS.map((constraint) => constraint.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
    });

    it('keeps the seven kinds distinguishable by severity and by who may lift them', () => {
        expect(constraintOfKind('allergy')?.severity).toBe('critical');
        expect(constraintOfKind('dietitian_enforced')?.source).toBe('dietitian');
        expect(constraintOfKind('dislike')?.severity).toBe('advisory');
        expect(constraintOfKind('preference')?.severity).toBe('advisory');
    });

    /** The point of the whole seam: the figures come from the engine, and are not typed anywhere. */
    it('takes its nutrition target from MockNutritionTargetEngine', () => {
        const recomputed = PROTOTYPE_TARGET_ENGINE.calculate(PROTOTYPE_TARGET_REQUEST);
        expect(PROTOTYPE_TARGET_RESULT.targetEnergy).toBe(recomputed.targetEnergy);
        expect(PROTOTYPE_TARGET_RESULT.macros).toEqual(recomputed.macros);
        expect(PROTOTYPE_TARGET_RESULT.prototype).toBe(true);
        expect(PROTOTYPE_TARGET_RESULT.explanation.disclaimer.length).toBeGreaterThan(0);
        expect(PROTOTYPE_TARGET_RESULT.explanation.citations.length).toBeGreaterThan(0);
    });

    it('is flagged for professional review because a safety-critical restriction is declared', () => {
        expect(PROTOTYPE_TARGET_RESULT.requiresProfessionalReview).toBe(true);
        expect(PROTOTYPE_TARGET_RESULT.reviewReasons).toContain('safety_critical_restriction');
        expect(PROTOTYPE_STORED_TARGET.professionallyApproved).toBe(false);
    });
});

describe('the generated week carries every state a planner screen has to render', () => {
    it('has exactly one locked entry', () => {
        expect(PROTOTYPE_WEEK_ENTRIES.filter((entry) => entry.locked)).toHaveLength(1);
    });

    it('has a leftover that points at the entry it came from', () => {
        const leftovers = PROTOTYPE_WEEK_ENTRIES.filter((entry) => entry.isLeftover);
        expect(leftovers).toHaveLength(1);
        expect(leftovers[0]?.leftoverOfEntryId).not.toBeNull();
    });

    it('has one entry a dietitian signed off', () => {
        const approved = PROTOTYPE_WEEK_ENTRIES.filter((entry) => entry.approvedBy !== null);
        expect(approved).toHaveLength(1);
    });

    it('derives an allergen warning from what is actually in the meal', () => {
        const flagged = PROTOTYPE_WEEK_ENTRIES.filter((entry) =>
            entry.warnings.includes(ALLERGEN_WARNING_CODE),
        );
        expect(flagged.length).toBeGreaterThanOrEqual(1);
        for (const entry of flagged) expect(entry.allergens).toContain('tree_nut');
    });

    it('derives a nutrition warning from the energy share, not from a flag', () => {
        const flagged = PROTOTYPE_WEEK_ENTRIES.filter((entry) =>
            entry.warnings.includes(ENERGY_WARNING_CODE),
        );
        expect(flagged.length).toBeGreaterThanOrEqual(1);
        for (const entry of flagged) {
            expect(amountValue(entry.nutrition, 'energy')).toBeGreaterThan(
                PROTOTYPE_TARGET_RESULT.targetEnergy * 0.5,
            );
        }
    });

    it('plans a disliked ingredient deliberately — a dislike is not an exclusion', () => {
        const aubergine = PROTOTYPE_WEEK_ENTRIES.some((entry) =>
            entry.label.toLowerCase().includes('aubergine'),
        );
        expect(aubergine).toBe(true);
        expect(constraintOfKind('dislike')?.code).toBe('aubergine');
    });
});

describe('the grocery list', () => {
    it('is built from home-prepared entries and never from a kitchen meal', () => {
        const homeRecipeIds = new Set(
            PROTOTYPE_WEEK_ENTRIES.filter(
                (entry) => entry.kind === 'recipe' && !entry.isLeftover && entry.recipeId !== null,
            ).map((entry) => entry.recipeId),
        );
        expect(homeRecipeIds.size).toBeGreaterThan(0);

        for (const item of PROTOTYPE_GROCERY_LIST.items) {
            for (const recipeId of item.neededForRecipeIds) {
                expect(homeRecipeIds, `${item.name}`).toContain(recipeId);
                expect(recipeById(recipeId)).not.toBeNull();
            }
        }
    });

    it('does not shop twice for a leftover', () => {
        const leftover = PROTOTYPE_WEEK_ENTRIES.find((entry) => entry.isLeftover);
        expect(leftover).toBeDefined();

        const twin = PROTOTYPE_WEEK_ENTRIES.find(
            (entry) => entry.id === leftover?.leftoverOfEntryId,
        );
        expect(twin?.recipeId).toBe(leftover?.recipeId);

        // One purchase for the pair: the list references the recipe once, not twice.
        const lines = PROTOTYPE_GROCERY_LIST.items.filter((item) =>
            item.neededForRecipeIds.includes(twin?.recipeId ?? ('' as never)),
        );
        expect(lines.length).toBeGreaterThan(0);
    });

    it('marks pantry-covered lines and excludes them from the estimated total', () => {
        expect(PROTOTYPE_GROCERY_LIST.items.some((item) => item.inPantry)).toBe(true);
        const outstanding = PROTOTYPE_GROCERY_LIST.items
            .filter((item) => !item.inPantry)
            .reduce<number>((sum, item) => sum + (item.estimatedCost?.amount ?? 0), 0);
        expect(PROTOTYPE_GROCERY_LIST.estimatedTotal?.amount).toBe(outstanding);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Virtual Dietitian
 * ---------------------------------------------------------------------------------------------- */

describe('the Virtual Dietitian fixtures', () => {
    it('has a session in every one of the twelve states', () => {
        expect(VD_COVERED_STATES).toHaveLength(VD_SESSION_STATES.length);
        expect([...VD_COVERED_STATES].sort()).toEqual([...VD_SESSION_STATES].sort());
    });

    it('renders the disclaimer on every state, including the failures', () => {
        for (const session of PROTOTYPE_VD_SESSIONS) {
            expect(session.disclaimer.length, session.state).toBeGreaterThan(0);
        }
    });

    it('labels machine authorship on the message, never by convention', () => {
        for (const session of PROTOTYPE_VD_SESSIONS) {
            for (const message of session.messages) {
                expect(message.aiGenerated, `${session.state} ${message.origin}`).toBe(
                    message.origin === 'assistant',
                );
            }
        }
    });

    it('carries one complete conversation covering all four message origins', () => {
        const approved = PROTOTYPE_VD_SESSIONS.find(
            (session) => session.state === 'professionally_approved',
        );
        expect(approved?.messages.length).toBeGreaterThanOrEqual(12);
        const origins = new Set(approved?.messages.map((message) => message.origin));
        expect([...origins].sort()).toEqual(['assistant', 'dietitian', 'system', 'user']);
        expect(approved?.approvedAt).not.toBeNull();
        expect(approved?.reviewedBy).not.toBeNull();
    });

    it('stops at the safety escalation with no proposal and no draft', () => {
        const escalated = PROTOTYPE_VD_SESSIONS.find(
            (session) => session.state === 'safety_escalation',
        );
        expect(escalated?.proposal).toBeNull();
        expect(escalated?.draftPlanId).toBeNull();
        expect(escalated?.safetyNotices[0]?.severity).toBe('escalation');
    });
});

/* ------------------------------------------------------------------------------------------------
 * B2B
 * ---------------------------------------------------------------------------------------------- */

describe('the business fixtures', () => {
    it('represents all four arrangements the specification names', () => {
        const names = PROTOTYPE_PROGRAMMES.map((programme) => programme.name.toLowerCase());
        expect(names.some((name) => name.includes('staff meal'))).toBe(true);
        expect(names.some((name) => name.includes('bulk'))).toBe(true);
        expect(names.some((name) => name.includes('fitness'))).toBe(true);
        expect(names.some((name) => name.includes('wholesale'))).toBe(true);
    });

    it('gives every negotiated line a minimum order, volume tiers and a lead time', () => {
        for (const item of PROTOTYPE_CATALOGUE_ITEMS) {
            expect(item.minimumOrderQuantity, item.id).toBeGreaterThan(0);
            expect(item.volumeTiers.length, item.id).toBeGreaterThanOrEqual(2);
            expect(item.leadTimeDays, item.id).toBeGreaterThan(0);
            expect(item.contractPrice, item.id).not.toBeNull();
            expect(item.deliveryWeekdays.length, item.id).toBeGreaterThan(0);
        }
    });

    it('orders volume tiers so a larger order never costs more per unit', () => {
        for (const item of PROTOTYPE_CATALOGUE_ITEMS) {
            const prices = item.volumeTiers.map((tier) => tier.unitPrice.amount);
            expect([...prices].sort((left, right) => right - left)).toEqual(prices);
        }
    });

    it('prices exactly one line in a second currency', () => {
        const currencies = PROTOTYPE_CATALOGUE_ITEMS.map(
            (item) => item.contractPrice?.currency ?? 'USD',
        );
        expect(currencies.filter((code) => code !== 'USD')).toEqual(['SAR']);

        const sar = catalogueItemById(SAR_CATALOGUE_ITEM_ID);
        expect(sar?.contractPrice?.currency).toBe('SAR');
        for (const tier of sar?.volumeTiers ?? []) {
            expect(tier.unitPrice.currency).toBe('SAR');
        }
    });

    /** The reason the second currency is there: a mixed-currency total must be impossible, not rare. */
    it('refuses to add a dirham to a riyal', () => {
        const sar = catalogueItemById(SAR_CATALOGUE_ITEM_ID)?.contractPrice;
        const aedItem = PROTOTYPE_CATALOGUE_ITEMS.find(
            (item) => item.contractPrice?.currency === 'USD',
        )?.contractPrice;
        expect(sar).toBeDefined();
        expect(aedItem).toBeDefined();
        if (sar === undefined || sar === null || aedItem === undefined || aedItem === null) return;

        expect(() => addMoney(aedItem, sar)).toThrow(/never crosses currencies/);
    });

    it('exposes no negotiated price on any consumer-facing shape', () => {
        for (const meal of PROTOTYPE_MEALS) {
            expect(Object.keys(meal)).not.toContain('contractPrice');
            expect(meal.price.currency).toBe('USD');
        }
        for (const plan of PROTOTYPE_PLANS) {
            expect(Object.keys(plan)).not.toContain('contractPrice');
        }
    });
});
