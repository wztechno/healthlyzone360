import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../../contracts/failure.ts';
import { MealPlanId, MealId, VdSessionId } from '@healthy360/domain-types';
import { PROTOTYPE_TODAY, PROTOTYPE_WEEK_START, addDays } from './constants.ts';
import {
    PROTOTYPE_PLAN_IDS,
    PROTOTYPE_TARGET_REQUEST,
    dietitianByKey,
    mealByKey,
    planByKey,
    programmeByKey,
    recipeByKey,
    reviewQueueItemAt,
    vdSessionForState,
    weekEntryAt,
} from './fixtures/index.ts';
import { PROTOTYPE_ADDRESS, PrototypeStore } from './store.ts';

/**
 * The store, exercised directly.
 *
 * `repository-contract.ts` covers everything a screen can reach through a repository. What is left
 * — and what is here — is the behaviour a screen depends on but does not call directly: what
 * generation does to a lock, what an unknown identifier rejects with, and the guards that keep a
 * prototype from teaching the wrong thing about the product.
 */

const store = () => new PrototypeStore({ scenario: 'consumer-prototype' });
const emptyStore = () => new PrototypeStore({ scenario: 'consumer-onboarding' });

describe('seeding', () => {
    it('gives the prototype scenario a complete world', () => {
        const world = store();
        expect(world.onboardingComplete).toBe(true);
        expect(world.currentTargets()).not.toBeNull();
        expect(world.getWeek(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START).days).toHaveLength(7);
        expect(world.subscriptions()).toHaveLength(1);
        expect(world.reviewQueue().length).toBeGreaterThan(0);
        expect(world.vdSessions().length).toBeGreaterThanOrEqual(12);
        expect(world.quotations()).toHaveLength(2);
    });

    it('gives the onboarding scenario an empty one', () => {
        const world = emptyStore();
        expect(world.onboardingComplete).toBe(false);
        expect(world.currentTargets()).toBeNull();
        expect(world.subscriptions()).toEqual([]);
        expect(world.reviewQueue()).toEqual([]);
        expect(world.vdSessions()).toEqual([]);
        expect(world.getDay(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START).entries).toEqual([]);
    });

    it('renders an empty day without inventing a total', () => {
        const day = emptyStore().getDay(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START);
        expect(day.summary.meals).toEqual([]);
        expect(day.summary.estimatedCost).toBeNull();
        expect(day.summary.target).toBeNull();
    });
});

describe('generation', () => {
    it('keeps a lock when the same week is regenerated', () => {
        const world = store();
        const locked = weekEntryAt(0);
        world.lockEntry(PROTOTYPE_PLAN_IDS.week, locked.id);

        const week = world.generate({ weekStart: PROTOTYPE_WEEK_START });
        const survivor = week.days
            .flatMap((day) => day.entries)
            .find((entry) => entry.id === locked.id);
        expect(survivor?.locked).toBe(true);
    });

    it('does not carry an entry across into a different week', () => {
        const world = store();
        world.lockEntry(PROTOTYPE_PLAN_IDS.week, weekEntryAt(0).id);

        const nextWeek = addDays(PROTOTYPE_WEEK_START, 7);
        const week = world.generate({ weekStart: nextWeek });
        const entries = week.days.flatMap((day) => day.entries);

        expect(entries.length).toBe(28);
        expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
        for (const entry of entries) expect(entry.date >= nextWeek).toBe(true);
    });

    it('summarises the week from the entries, so the totals cannot drift', () => {
        const world = store();
        const week = world.getWeek(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START);

        const fromDays = week.days.reduce<number>(
            (sum, day) =>
                sum +
                (day.summary.planned.amounts.find((amount) => amount.nutrientId === 'energy')
                    ?.value ?? 0),
            0,
        );
        const weekly =
            week.summary.planned.amounts.find((amount) => amount.nutrientId === 'energy')?.value ??
            0;
        expect(Math.round(weekly)).toBe(Math.round(fromDays));
    });
});

describe('templates and duplication', () => {
    it('saves a template that keeps the entries and takes a name', () => {
        const world = store();
        const summary = world.saveAsTemplate(PROTOTYPE_PLAN_IDS.week, { name: 'Standard week' });
        expect(summary.state).toBe('template');
        expect(summary.name).toBe('Standard week');
        expect(world.getWeek(summary.planId, summary.weekStart).days).toHaveLength(7);
    });

    it('duplicates a plan into another week, shifting every date', () => {
        const world = store();
        const target = addDays(PROTOTYPE_WEEK_START, 14);
        const copy = world.duplicate(PROTOTYPE_PLAN_IDS.week, {
            weekStart: target,
            includeNotes: true,
        });

        expect(copy.weekStart).toBe(target);
        expect(copy.state).toBe('draft');
        const entries = copy.days.flatMap((day) => day.entries);
        expect(entries.length).toBe(28);
        for (const entry of entries) expect(entry.date >= target).toBe(true);
    });
});

describe('nutrition targets', () => {
    it('refuses to store a target the person has not acknowledged the disclaimer for', () => {
        const world = store();
        const failure = (() => {
            try {
                world.updateTargets({
                    source: PROTOTYPE_TARGET_REQUEST,
                    acknowledgedDisclaimer: false,
                });
                return null;
            } catch (error: unknown) {
                return asApiFailure(error);
            }
        })();
        expect(failure?.code).toBe('validation.failed');
    });

    it('accepts a hand-adjusted energy figure while keeping the calculated explanation', () => {
        const world = store();
        const stored = world.updateTargets({
            source: PROTOTYPE_TARGET_REQUEST,
            targetEnergy: 1750,
            acknowledgedDisclaimer: true,
        });
        expect(stored.result.targetEnergy).toBe(1750);
        expect(stored.result.explanation.steps.length).toBeGreaterThan(0);
        expect(stored.result.prototype).toBe(true);
    });

    it('moves the planner bands when a professional overrides the target', () => {
        const world = store();
        const before = world.getWeek(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START);
        const beforeEnergy = before.targets.find((target) => target.nutrientId === 'energy')?.value;

        world.setOverride(
            {
                clientId: before.userId,
                targetId: world.currentTargets()?.id ?? ('' as never),
                reason: 'Raised for training load.',
                targetEnergy: 2300,
            },
            dietitianByKey('karim_nassar').id,
        );

        const after = world.getWeek(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START);
        expect(after.targets.find((target) => target.nutrientId === 'energy')?.value).toBe(2300);
        expect(beforeEnergy).not.toBe(2300);
    });

    it('puts a requested review in the professional queue', () => {
        const world = store();
        const target = world.currentTargets();
        expect(target).not.toBeNull();
        if (target === null) return;

        const review = world.requestNutritionReview({
            targetId: target.id,
            urgency: 'urgent',
            note: 'Could you check the sodium ceiling?',
        });
        expect(review.state).toBe('requested');

        // The seeded queue already holds a routine item for this target; the request adds its own.
        const queued = world
            .reviewQueue()
            .filter((item) => item.targetId === target.id && item.priority === 'urgent');
        expect(queued).toHaveLength(1);
        expect(queued[0]?.state).toBe('awaiting_review');
    });
});

describe('the cart', () => {
    it('merges a repeated line rather than duplicating it', () => {
        const world = store();
        const cart = world.cart();
        const mealId = mealByKey('verdant_morning_oats').id;

        world.addCartItem(cart.id, mealId, 1);
        const twice = world.addCartItem(cart.id, mealId, 2);

        expect(twice.items).toHaveLength(1);
        expect(twice.items[0]?.quantity).toBe(3);
        expect(twice.itemCount).toBe(3);
    });

    it('refuses a quantity that is not a whole number above zero', () => {
        const world = store();
        const cart = world.cart();
        const failure = (() => {
            try {
                world.addCartItem(cart.id, mealByKey('verdant_morning_oats').id, 0);
                return null;
            } catch (error: unknown) {
                return asApiFailure(error);
            }
        })();
        expect(failure?.code).toBe('validation.failed');
    });

    it('warns when a line carries a declared allergen', () => {
        const world = store();
        const cart = world.cart();
        // The oats carry almonds, and tree nuts are a declared allergy.
        world.addCartItem(cart.id, mealByKey('verdant_morning_oats').id, 1);
        const preview = world.previewCheckout({ cartId: cart.id });
        expect(preview.warnings).toContain('planner.allergen_conflict');
    });

    it('drops the delivery fee above the free-delivery threshold', () => {
        const world = store();
        const cart = world.cart();
        world.addCartItem(cart.id, mealByKey('riverstone_lamb_recovery_plate').id, 12);
        const preview = world.previewCheckout({ cartId: cart.id });
        expect(preview.deliveryFee).toBeNull();
        expect(preview.total.amount).toBe(preview.subtotal.amount);
    });
});

describe('subscriptions', () => {
    it('creates one from a preview and refuses without an acknowledgement', () => {
        const world = store();
        const plan = planByKey('balanced_week');
        const variant = plan.variants[0];
        expect(variant).toBeDefined();
        if (variant === undefined) return;

        const configuration = {
            planId: plan.id,
            variantId: variant.id,
            duration: '2w' as const,
            startDate: PROTOTYPE_WEEK_START,
            deliveryWeekdays: [1, 3],
            slotCode: 'morning',
            address: PROTOTYPE_ADDRESS,
            dietClassifications: [],
            excludeAllergens: [],
            selectedMealIds: [],
        };

        const refused = (() => {
            try {
                world.createSubscription({ configuration, acknowledgedTerms: false });
                return null;
            } catch (error: unknown) {
                return asApiFailure(error);
            }
        })();
        expect(refused?.code).toBe('validation.failed');

        const created = world.createSubscription({ configuration, acknowledgedTerms: true });
        expect(created.state).toBe('active');
        expect(created.nextDeliveryDate).toBe(PROTOTYPE_WEEK_START);
        expect(world.subscriptions()).toHaveLength(2);
    });

    it('changes an address without disturbing the rest of the configuration', () => {
        const world = store();
        const existing = world.subscriptions()[0];
        expect(existing).toBeDefined();
        if (existing === undefined) return;

        const moved = world.changeAddress(existing.id, {
            address: { ...PROTOTYPE_ADDRESS, label: 'Office', area: 'Deira' },
        });
        expect(moved.configuration.address.area).toBe('Deira');
        expect(moved.configuration.slotCode).toBe(existing.configuration.slotCode);
        expect(moved.weeklyPrice).toEqual(existing.weeklyPrice);
    });

    it('skips a future day without entering the skipped-today state', () => {
        const world = store();
        const existing = world.subscriptions()[0];
        if (existing === undefined) return;

        const skipped = world.skipDay(existing.id, { date: addDays(PROTOTYPE_TODAY, 7) });
        expect(skipped.state).toBe('active');
        expect(skipped.skippedDates).toHaveLength(1);
    });
});

describe('the professional side', () => {
    it('records a dietitian note against the plan and shows it to the customer read-only', () => {
        const world = store();
        const note = world.setDietitianNote(
            { planId: PROTOTYPE_PLAN_IDS.week, note: 'Add a second protein source at lunch.' },
            dietitianByKey('layla_haddad').id,
        );
        expect(note.note).toContain('protein source');
        expect(world.getNotes(PROTOTYPE_PLAN_IDS.week).dietitianNote).toBe(note.note);
    });

    it('approves a Virtual Dietitian review and moves the session with it', () => {
        const world = store();
        const session = vdSessionForState('review_requested');
        const item = world.reviewQueue().find((candidate) => candidate.sessionId === session.id);
        expect(item).toBeDefined();
        if (item === undefined) return;

        world.approveReview(item.id, { signature: 'L. Haddad' });
        expect(world.vdSession(session.id).state).toBe('professionally_approved');
    });

    it('assembles a review detail with the plan week and the reading-order context', () => {
        const world = store();
        const detail = world.review(reviewQueueItemAt(1).id);
        expect(detail.planWeek?.days).toHaveLength(7);
        expect(detail.clientNote).not.toBeNull();
        expect(detail.context.length).toBeGreaterThan(2);
    });
});

describe('unknown identifiers', () => {
    const missing = <T>(call: () => T) => {
        try {
            call();
            return null;
        } catch (error: unknown) {
            return asApiFailure(error);
        }
    };

    it('reject with a message naming what was missing', () => {
        const world = store();
        const unknownPlan = MealPlanId.unsafe('01935f6d-0000-7000-8000-00000000e0ff');

        expect(missing(() => world.getWeek(unknownPlan, PROTOTYPE_WEEK_START))?.code).toBe(
            'server',
        );
        expect(missing(() => world.getWeek(unknownPlan, PROTOTYPE_WEEK_START))?.message).toContain(
            'No meal plan',
        );

        expect(
            missing(() =>
                world.addCartItem(
                    world.cart().id,
                    MealId.unsafe('01935f6d-0000-7000-8000-00000000c0ff'),
                    1,
                ),
            )?.message,
        ).toContain('No marketplace meal');

        expect(
            missing(() =>
                world.vdSession(VdSessionId.unsafe('01935f6d-0000-7000-8000-0000000091ff')),
            )?.message,
        ).toContain('No Virtual Dietitian session');
    });

    it('treats an invisible corporate programme as a context problem, not a server error', () => {
        const world = store();
        const failure = missing(() =>
            world.programme(
                programmeByKey('corporate_employee_package').id.replace(/..$/, 'ff') as never,
            ),
        );
        expect(failure?.code).toBe('context.organisation_required');
    });
});

describe('replacement modes', () => {
    it('replaces every future occurrence of a recurring meal', () => {
        const world = store();
        const wednesday = weekEntryAt(8);
        const recipe = recipeByKey('garden_omelette_spinach');

        // Wednesday and Thursday breakfast are the same dish in the fixture week.
        expect(wednesday.label).toBe(recipe.name);

        const replaced = world.replaceEntry(PROTOTYPE_PLAN_IDS.week, wednesday.id, {
            mode: 'recurring',
            kind: 'recipe',
            recipeId: recipeByKey('spiced_lentil_pumpkin_stew').id,
        });

        expect(replaced.length).toBeGreaterThan(1);
        for (const entry of replaced) expect(entry.label).toBe('Spiced lentil and pumpkin stew');
    });

    it('never lets a confirmed warning suppress an allergen conflict', () => {
        const world = store();
        const monday = weekEntryAt(0);
        const replaced = world.replaceEntry(PROTOTYPE_PLAN_IDS.week, monday.id, {
            mode: 'once',
            kind: 'recipe',
            recipeId: recipeByKey('morning_oats_dates_almonds').id,
            confirmedWarnings: ['planner.allergen_conflict', 'planner.energy_out_of_range'],
        });
        expect(replaced[0]?.warnings).toContain('planner.allergen_conflict');
    });
});
