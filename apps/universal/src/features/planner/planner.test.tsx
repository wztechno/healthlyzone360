import type { MealPlanEntry, MealPlanSummary } from '@healthy360/api-client/contracts';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { renderScreen } from '../../testing/render-screen.tsx';
import { addDays } from './format.ts';
import { GroceryListScreen } from './screens/grocery-list-screen.tsx';
import { PlannerDayScreen } from './screens/planner-day-screen.tsx';
import { PlannerIndexScreen } from './screens/planner-index-screen.tsx';
import { PlannerWeekScreen } from './screens/planner-week-screen.tsx';
import { RecipeDetailScreen } from './screens/recipe-detail-screen.tsx';

/**
 * The planner, screen by screen, against the real mock repositories.
 *
 * Nothing here stubs a hook. `renderScreen` builds a fresh prototype world per test, so a screen
 * that mishandles a real `ApiFailure`, a real cursor page or a real state transition fails here
 * rather than in Playwright — and a test that mutates a plan cannot leak into the next one.
 *
 * ## The two things this file exists to prove
 *
 * 1. **A lock survives regeneration.** It is the single behaviour the whole planner's credibility
 *    rests on, and the one the reference product gets wrong by conflating it with eaten-tracking
 *    (doc 10, PRS-03). So it is asserted end to end: lock a card, regenerate the week, find the card.
 * 2. **Every mutation announces.** The live region is the only signal a screen-reader user gets that
 *    a card three columns away has changed.
 *
 * ## Why the viewport is mocked
 *
 * The weekly planner branches in JavaScript at `lg` — a real seven-column grid above it, an agenda
 * below — because rendering both and hiding one puts an off-screen planner in the accessibility
 * tree. A branch in JavaScript has to be tested at both widths, so the window is mocked rather than
 * left at whatever the preset happens to report.
 */

const CONSUMER = MOCK_SCENARIOS['consumer-prototype'].primaryEmail;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');
const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

function viewport(width: number) {
    mockedDimensions.mockReturnValue({ width, height: 900, scale: 2, fontScale: 1 });
}

const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, back: jest.fn(), setParams: jest.fn() }),
        usePathname: () => '/customer/planner',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

/**
 * Fixture identifiers are read from a throwaway bundle rather than by rendering a tree and scraping
 * it: rendering a second tree inside a test leaves `screen` pointing at one the test then unmounts.
 * Fixture rows are deterministic and identical in every world, so an identifier taken from here
 * addresses the same entry inside the tree under test.
 */
const scratch = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });

let plan: MealPlanSummary;
let entries: readonly MealPlanEntry[];
let lockedEntry: MealPlanEntry;
let unlockedEntry: MealPlanEntry;
/**
 * A marketplace meal that is on the drawer's first page and is *not* the one already planned.
 *
 * Picking "the first candidate" would sometimes pick the meal already in the slot — the search is
 * unfiltered and the planned meal is in it — and replacing a meal with itself proves nothing.
 */
let otherMealId: string;

beforeAll(async () => {
    const current = await scratch.planner.getCurrentPlan();
    if (current === null) throw new Error('The prototype world has no current plan.');
    plan = current;
    const week = await scratch.planner.getWeek(plan.planId, plan.weekStart);
    entries = week.days.flatMap((day) => day.entries);

    const locked = entries.find((entry) => entry.locked);
    const unlocked = entries.find((entry) => !entry.locked && entry.kind === 'kitchen_meal');
    if (locked === undefined || unlocked === undefined) {
        throw new Error('The fixture week is missing a locked or an unlocked kitchen entry.');
    }
    lockedEntry = locked;
    unlockedEntry = unlocked;

    const meals = await scratch.marketplace.listMeals({ limit: 12 });
    const other = meals.items.find((meal) => meal.id !== unlocked.mealId);
    if (other === undefined) throw new Error('The marketplace offers only the planned meal.');
    otherMealId = String(other.id);
});

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
    viewport(1280);
});

/** Flushes the batched cache notifications TanStack delivers a tick after a render settles. */
async function settle() {
    for (let pass = 0; pass < 2; pass += 1) {
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 30);
            });
        });
    }
}

function cardId(entry: MealPlanEntry): string {
    return `planner-entry-${String(entry.id)}`;
}

/**
 * Presses a control once it is enabled.
 *
 * Several planner controls are disabled until the current-plan query settles, because "still
 * resolving" is not the same answer as "you have no plan". A test that pressed immediately would be
 * pressing a disabled control and asserting on the nothing that followed.
 */
async function pressWhenEnabled(testID: string) {
    await waitFor(() => {
        expect(screen.getByTestId(testID).props.accessibilityState?.disabled).not.toBe(true);
    });
    await fireEvent.press(screen.getByTestId(testID));
}

/** The first match for a pattern. Several planner surfaces render many similar controls. */
async function findFirst(pattern: RegExp) {
    const matches = await screen.findAllByTestId(pattern, undefined, { timeout: 3000 });
    const first = matches[0];
    if (first === undefined) throw new Error(`Nothing matched ${String(pattern)}.`);
    return first;
}

/* ── the entry point ─────────────────────────────────────────────────────────────────────────── */

describe('PlannerIndexScreen', () => {
    it('redirects to the week the current plan covers', async () => {
        await renderScreen(<PlannerIndexScreen />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/customer/planner/week/${plan.weekStart}`,
            );
        });
    });

    it('resolves the plan without going anywhere near a Virtual Dietitian session', async () => {
        // The Wave 3C handoff: a fixture session's draftPlanId is only materialised once
        // generateVdDraft has run, so resolving through one would fail on a cold read.
        const { repositories } = await renderScreen(<PlannerIndexScreen />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalled();
        });
        const resolved = await repositories.planner.getCurrentPlan();
        expect(resolved?.planId).toBe(plan.planId);
    });
});

/* ── the weekly planner ──────────────────────────────────────────────────────────────────────── */

describe('PlannerWeekScreen', () => {
    async function renderWeek(week = plan.weekStart, width = 1280) {
        viewport(width);
        const harness = await renderScreen(<PlannerWeekScreen week={week} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => screen.getByTestId('planner-week-screen'));
        return harness;
    }

    it('renders a loading state before the week arrives', async () => {
        viewport(1280);
        await renderScreen(<PlannerWeekScreen week={plan.weekStart} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        expect(screen.getByTestId('planner-week-loading')).toBeTruthy();
        await settle();
    });

    it('renders the calendar grid at desktop width', async () => {
        await renderWeek();
        await waitFor(() => {
            expect(screen.getByTestId('planner-week-grid')).toBeTruthy();
        });
        expect(screen.queryByTestId('planner-week-agenda')).toBeNull();
    });

    it('renders an agenda instead of a grid on a phone', async () => {
        await renderWeek(plan.weekStart, 390);
        await waitFor(() => {
            expect(screen.getByTestId('planner-week-agenda')).toBeTruthy();
        });
        expect(screen.queryByTestId('planner-week-grid')).toBeNull();
    });

    it('mounts the live region before anything has changed', async () => {
        await renderWeek();
        expect(screen.getByTestId('planner-announcer')).toBeTruthy();
    });

    it('shows every entry of the fixture week', async () => {
        await renderWeek();
        await waitFor(() => {
            expect(screen.getByTestId(cardId(lockedEntry))).toBeTruthy();
        });
        expect(screen.getByTestId(cardId(unlockedEntry))).toBeTruthy();
    });

    it('summarises the daily average against the target, with tolerance and a disclaimer', async () => {
        await renderWeek();
        await waitFor(() => {
            expect(screen.getByTestId('planner-week-summary')).toBeTruthy();
        });
        expect(screen.getByTestId('planner-week-summary-meter-energy')).toBeTruthy();
        expect(screen.getByTestId('planner-week-summary-tolerance-energy')).toBeTruthy();
        // The standing id, inside the summary: `medical-disclaimer` is the assertion every wave
        // makes, and a per-screen id would have made this one true while that one failed.
        expect(
            within(screen.getByTestId('planner-week-summary')).getByTestId('medical-disclaimer'),
        ).toBeTruthy();
    });

    it('never presents planned figures as consumed ones', async () => {
        await renderWeek();
        await waitFor(() => screen.getByTestId('planner-week-summary'));
        expect(screen.getByTestId('planner-week-summary-actual')).toBeTruthy();
    });

    it('estimates the cost of the week', async () => {
        await renderWeek();
        await waitFor(() => {
            expect(screen.getByTestId('planner-week-cost-total')).toBeTruthy();
        });
        expect(screen.getByTestId('planner-week-cost-note')).toBeTruthy();
    });

    it('raises the allergen warning the fixture week carries', async () => {
        await renderWeek();
        await waitFor(() => {
            expect(screen.getByTestId('planner-week-warnings')).toBeTruthy();
        });
    });

    it('offers a designed empty state, with a real generate action, for a week with nothing in it', async () => {
        await renderWeek(addDays(plan.weekStart, 70));
        await waitFor(() => {
            expect(screen.getByTestId('planner-week-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('planner-week-generate')).toBeTruthy();
    });

    it('generates a week for real from the empty state', async () => {
        const target = addDays(plan.weekStart, 70);
        const { repositories } = await renderWeek(target);

        await waitFor(() => screen.getByTestId('planner-week-generate'));
        await fireEvent.press(screen.getByTestId('planner-week-generate'));

        await waitFor(async () => {
            const generated = await repositories.planner.getWeek(plan.planId, target);
            expect(generated.days.flatMap((day) => day.entries).length).toBeGreaterThan(0);
        });
    });

    it('answers a malformed week with a not-found rather than a failure', async () => {
        viewport(1280);
        await renderScreen(<PlannerWeekScreen week="not-a-date" />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        expect(screen.getByTestId('planner-week-not-found')).toBeTruthy();
        await settle();
    });

    it('normalises a mid-week deep link to its Monday', async () => {
        await renderWeek(addDays(plan.weekStart, 3));
        await waitFor(() => {
            expect(screen.getByTestId(cardId(lockedEntry))).toBeTruthy();
        });
    });

    it('warns that regeneration keeps what you kept, before it runs', async () => {
        await renderWeek();
        await pressWhenEnabled('planner-week-regenerate');

        await waitFor(() => {
            expect(screen.getByTestId('planner-week-regenerate-locks')).toBeTruthy();
        });
    });

    it('leaves a kept meal in place when the whole week is regenerated', async () => {
        const { repositories } = await renderWeek();
        const before = await repositories.planner.getWeek(plan.planId, plan.weekStart);
        const keptLabel = before.days
            .flatMap((day) => day.entries)
            .find((entry) => entry.locked)?.label;
        expect(keptLabel).toBeDefined();

        await pressWhenEnabled('planner-week-regenerate');
        await waitFor(() => screen.getByTestId('planner-week-regenerate-confirm'));
        await fireEvent.press(screen.getByTestId('planner-week-regenerate-confirm'));

        await waitFor(async () => {
            const after = await repositories.planner.getWeek(plan.planId, plan.weekStart);
            const still = after.days.flatMap((day) => day.entries).find((entry) => entry.locked);
            expect(still?.label).toBe(keptLabel);
        });
    });

    it('announces a week regeneration', async () => {
        await renderWeek();
        await pressWhenEnabled('planner-week-regenerate');
        await waitFor(() => screen.getByTestId('planner-week-regenerate-confirm'));
        await fireEvent.press(screen.getByTestId('planner-week-regenerate-confirm'));

        // A week regeneration re-renders twenty-eight cards behind the announcement, so this one
        // waits longer than the default: the assertion is about the message, not about the speed.
        await waitFor(
            () => {
                expect(screen.getByTestId('planner-announcer').props.children).toContain(
                    'Week regenerated',
                );
            },
            { timeout: 8000 },
        );
    });

    it('opens the plan-actions menu', async () => {
        await renderWeek();
        await pressWhenEnabled('planner-week-menu');

        await waitFor(() => {
            expect(screen.getByTestId('planner-week-action-notes')).toBeTruthy();
        });
        expect(screen.getByTestId('planner-week-action-history')).toBeTruthy();
        expect(screen.getByTestId('planner-week-action-template')).toBeTruthy();
        expect(screen.getByTestId('planner-week-action-duplicate')).toBeTruthy();
        expect(screen.getByTestId('planner-week-action-share')).toBeTruthy();
        expect(screen.getByTestId('planner-week-action-export')).toBeTruthy();
    });

    it('opens the notes drawer, shows the dietitian note read-only and saves the person’s own', async () => {
        const { repositories } = await renderWeek();
        await pressWhenEnabled('planner-week-menu');
        await waitFor(() => screen.getByTestId('planner-week-action-notes'));
        await fireEvent.press(screen.getByTestId('planner-week-action-notes'));

        await waitFor(() => {
            expect(screen.getByTestId('planner-notes-dietitian-note')).toBeTruthy();
        });

        await fireEvent.changeText(
            screen.getByTestId('planner-notes-input-input'),
            'Cook the stew on Sunday.',
        );
        await waitFor(() => {
            expect(
                screen.getByTestId('planner-notes-save').props.accessibilityState?.disabled,
            ).not.toBe(true);
        });
        await fireEvent.press(screen.getByTestId('planner-notes-save'));

        await waitFor(async () => {
            const notes = await repositories.planner.getNotes(plan.planId);
            expect(notes.customerNote).toBe('Cook the stew on Sunday.');
        });
    });

    it('opens the history drawer and lists human-readable events', async () => {
        await renderWeek();
        await pressWhenEnabled('planner-week-menu');
        await waitFor(() => screen.getByTestId('planner-week-action-history'));
        await fireEvent.press(screen.getByTestId('planner-week-action-history'));

        await waitFor(() => {
            expect(screen.getByTestId('planner-history-events')).toBeTruthy();
        });
        expect(screen.getByTestId('planner-history-more')).toBeTruthy();
    });

    it('saves the week as a real template', async () => {
        const { repositories } = await renderWeek();
        await pressWhenEnabled('planner-week-menu');
        await waitFor(() => screen.getByTestId('planner-week-action-template'));
        await fireEvent.press(screen.getByTestId('planner-week-action-template'));

        await waitFor(() => screen.getByTestId('planner-week-template-name'));
        await fireEvent.changeText(
            screen.getByTestId('planner-week-template-name-input'),
            'My usual week',
        );
        await fireEvent.press(screen.getByTestId('planner-week-template-confirm'));

        await waitFor(async () => {
            const plans = await repositories.planner.listPlans();
            expect(plans.items.some((summary) => summary.name === 'My usual week')).toBe(true);
        });
    });

    it('duplicates the week into a later one, for real', async () => {
        const { repositories } = await renderWeek();
        await pressWhenEnabled('planner-week-menu');
        await waitFor(() => screen.getByTestId('planner-week-action-duplicate'));
        await fireEvent.press(screen.getByTestId('planner-week-action-duplicate'));

        const before = (await repositories.planner.listPlans()).items.length;
        await waitFor(() => screen.getByTestId('planner-week-duplicate-confirm'));
        await fireEvent.press(screen.getByTestId('planner-week-duplicate-confirm'));

        await waitFor(async () => {
            expect((await repositories.planner.listPlans()).items.length).toBe(before + 1);
        });
    });

    it('answers share and export with a purposeful prototype notice rather than a dead control', async () => {
        await renderWeek();
        await pressWhenEnabled('planner-week-menu');
        await waitFor(() => screen.getByTestId('planner-week-action-share'));
        await fireEvent.press(screen.getByTestId('planner-week-action-share'));

        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });

    it('links to the grocery list for the week it is showing', async () => {
        await renderWeek();
        await waitFor(() => screen.getByTestId('planner-week-grocery'));
        await fireEvent.press(screen.getByTestId('planner-week-grocery'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/grocery/${plan.weekStart}`);
    });

    it('navigates a week at a time', async () => {
        await renderWeek();
        await waitFor(() => screen.getByTestId('planner-week-next'));
        await fireEvent.press(screen.getByTestId('planner-week-next'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            `/customer/planner/week/${addDays(plan.weekStart, 7)}`,
        );
    });
});

/* ── the meal card ───────────────────────────────────────────────────────────────────────────── */

describe('the planner meal card', () => {
    async function renderDay(date = unlockedEntry.date) {
        viewport(1280);
        const harness = await renderScreen(<PlannerDayScreen date={date} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => screen.getByTestId('planner-day-screen'));
        return harness;
    }

    it('names the meal, its type and its figures', async () => {
        await renderDay();
        await waitFor(() => screen.getByTestId(cardId(unlockedEntry)));
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-meal-type`)).toBeTruthy();
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-nutrition`)).toBeTruthy();
    });

    it('carries a kitchen badge that names the kitchen', async () => {
        await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-badge-kitchen`));
        const badge = screen.getByTestId(`${cardId(unlockedEntry)}-badge-kitchen`);
        expect(badge).toBeTruthy();
    });

    it('shows a preparation-time indicator and a cost', async () => {
        await renderDay();
        await waitFor(() => screen.getByTestId(cardId(unlockedEntry)));
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-cost`)).toBeTruthy();
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-prep-time`)).toBeTruthy();
    });

    it('states what keeping a meal means, and never claims it was eaten', async () => {
        await renderDay(lockedEntry.date);
        await waitFor(() => screen.getByTestId(`${cardId(lockedEntry)}-lock-state`));
        const state = screen.getByTestId(`${cardId(lockedEntry)}-lock-state`);
        expect(String(state.props.children)).toContain('does not record that you ate it');
    });

    it('locks an entry for real and announces it', async () => {
        const { repositories } = await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-lock`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-lock`));

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, unlockedEntry.date);
            expect(day.entries.find((entry) => entry.id === unlockedEntry.id)?.locked).toBe(true);
        });
        await waitFor(() => {
            expect(String(screen.getByTestId('planner-announcer').props.children)).toContain(
                'kept',
            );
        });
    });

    it('adjusts the portion for real, rescaling the figures', async () => {
        const { repositories } = await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-portion-increment`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-portion-increment`));

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, unlockedEntry.date);
            const updated = day.entries.find((entry) => entry.id === unlockedEntry.id);
            expect(updated?.portionFactor).toBeGreaterThan(unlockedEntry.portionFactor);
        });
    });

    it('opens the entry menu and offers every action the contract supports', async () => {
        await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-menu`));

        await waitFor(() => {
            expect(screen.getByTestId(`${cardId(unlockedEntry)}-regenerate`)).toBeTruthy();
        });
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-replace`)).toBeTruthy();
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-repeat`)).toBeTruthy();
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-remove`)).toBeTruthy();
        expect(screen.getByTestId(`${cardId(unlockedEntry)}-open-detail`)).toBeTruthy();
    });

    it('disables regeneration on a kept meal rather than letting it fail', async () => {
        await renderDay(lockedEntry.date);
        await waitFor(() => screen.getByTestId(`${cardId(lockedEntry)}-menu`));
        await fireEvent.press(screen.getByTestId(`${cardId(lockedEntry)}-menu`));

        await waitFor(() => {
            const action = screen.getByTestId(`${cardId(lockedEntry)}-regenerate`);
            expect(action.props.accessibilityState?.disabled).toBe(true);
        });
    });

    it('regenerates one entry for real', async () => {
        const { repositories } = await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-regenerate`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-regenerate`));

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, unlockedEntry.date);
            expect(day.entries.find((entry) => entry.id === unlockedEntry.id)?.label).not.toBe(
                unlockedEntry.label,
            );
        });
    });

    it('removes an entry for real', async () => {
        const { repositories } = await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-remove`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-remove`));

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, unlockedEntry.date);
            expect(day.entries.some((entry) => entry.id === unlockedEntry.id)).toBe(false);
        });
    });

    it('repeats a meal onto another day as a leftover', async () => {
        const { repositories } = await renderDay();
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-repeat`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-repeat`));

        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-repeat-confirm`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-repeat-confirm`));

        await waitFor(async () => {
            const week = await repositories.planner.getWeek(plan.planId, plan.weekStart);
            expect(
                week.days
                    .flatMap((day) => day.entries)
                    .some((entry) => entry.leftoverOfEntryId === unlockedEntry.id),
            ).toBe(true);
        });
    });

    it('explains an allergen warning rather than colouring the card', async () => {
        const flagged = entries.find((entry) =>
            entry.warnings.includes('planner.allergen_conflict'),
        );
        if (flagged === undefined) throw new Error('No allergen-flagged entry.');
        await renderDay(flagged.date);
        await waitFor(() => {
            expect(screen.getByTestId(`${cardId(flagged)}-allergy-warning`)).toBeTruthy();
        });
    });

    it('explains a nutrition warning separately from a safety one', async () => {
        const flagged = entries.find((entry) =>
            entry.warnings.includes('planner.energy_out_of_range'),
        );
        if (flagged === undefined) throw new Error('No nutrition-flagged entry.');
        await renderDay(flagged.date);
        await waitFor(() => {
            expect(screen.getByTestId(`${cardId(flagged)}-nutrition-warning`)).toBeTruthy();
        });
    });
});

/* ── the daily planner ───────────────────────────────────────────────────────────────────────── */

describe('PlannerDayScreen', () => {
    async function renderDay(date = plan.weekStart) {
        viewport(1280);
        const harness = await renderScreen(<PlannerDayScreen date={date} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => screen.getByTestId('planner-day-screen'));
        return harness;
    }

    it('groups the day into its four meal slots', async () => {
        await renderDay();
        await waitFor(() => screen.getByTestId('planner-day-agenda'));
        for (const mealType of ['breakfast', 'lunch', 'snack', 'dinner']) {
            expect(screen.getByTestId(`planner-day-slot-${mealType}`)).toBeTruthy();
        }
    });

    it('summarises the day against the target and carries the disclaimer', async () => {
        await renderDay();
        await waitFor(() => screen.getByTestId('planner-day-summary'));
        expect(screen.getByTestId('planner-day-summary-meter-protein')).toBeTruthy();
        expect(
            within(screen.getByTestId('planner-day-summary')).getByTestId('medical-disclaimer'),
        ).toBeTruthy();
    });

    it('regenerates the day for real, keeping what was kept', async () => {
        const { repositories } = await renderDay(lockedEntry.date);
        await pressWhenEnabled('planner-day-regenerate');
        await waitFor(() => screen.getByTestId('planner-day-regenerate-confirm'));
        await fireEvent.press(screen.getByTestId('planner-day-regenerate-confirm'));

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, lockedEntry.date);
            expect(day.entries.find((entry) => entry.id === lockedEntry.id)?.label).toBe(
                lockedEntry.label,
            );
        });
    });

    it('answers a malformed date with a not-found', async () => {
        viewport(1280);
        await renderScreen(<PlannerDayScreen date="2026-13-45" />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        expect(screen.getByTestId('planner-day-not-found')).toBeTruthy();
        await settle();
    });

    it('offers a designed empty state on a day with nothing in it', async () => {
        await renderDay(addDays(plan.weekStart, 70));
        await waitFor(() => {
            expect(screen.getByTestId('planner-day-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('planner-day-empty-add')).toBeTruthy();
    });
});

/* ── adding an entry ─────────────────────────────────────────────────────────────────────────── */

describe('adding an entry, in all four kinds', () => {
    async function openAdd(date = plan.weekStart) {
        viewport(1280);
        const harness = await renderScreen(<PlannerDayScreen date={date} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => {
            const button = screen.getByTestId('planner-day-add');
            expect(button.props.accessibilityState?.disabled).not.toBe(true);
        });
        await fireEvent.press(screen.getByTestId('planner-day-add'));
        await waitFor(() => screen.getByTestId('planner-add-body'));
        return harness;
    }

    async function countEntries(
        repositories: Awaited<ReturnType<typeof renderScreen>>['repositories'],
    ) {
        return (await repositories.planner.getDay(plan.planId, plan.weekStart)).entries.length;
    }

    it('offers all four kinds the contract models', async () => {
        await openAdd();
        expect(screen.getByTestId('planner-add-kind-food')).toBeTruthy();
        expect(screen.getByTestId('planner-add-kind-recipe')).toBeTruthy();
        expect(screen.getByTestId('planner-add-kind-kitchen-meal')).toBeTruthy();
        expect(screen.getByTestId('planner-add-kind-restaurant')).toBeTruthy();
        await settle();
    });

    it('asks for a search before listing foods, rather than dumping the ingredient table', async () => {
        await openAdd();
        expect(screen.getByTestId('planner-add-food-prompt')).toBeTruthy();
        await settle();
    });

    it('adds a food with a quantity in grams', async () => {
        const { repositories } = await openAdd();
        const before = await countEntries(repositories);

        await fireEvent.changeText(screen.getByTestId('planner-add-search-input'), 'orange');

        const card = await findFirst(/^planner-add-food-.*-add$/);
        await fireEvent.press(card);

        await waitFor(async () => {
            expect(await countEntries(repositories)).toBe(before + 1);
        });
    });

    it('adds a home-prepared recipe', async () => {
        const { repositories } = await openAdd();
        const before = await countEntries(repositories);

        await fireEvent.press(screen.getByTestId('planner-add-kind-recipe'));
        const add = await findFirst(/^planner-add-recipe-.*-add$/);
        await fireEvent.press(add);

        await waitFor(async () => {
            expect(await countEntries(repositories)).toBe(before + 1);
        });
    });

    it('adds a kitchen meal from the marketplace', async () => {
        const { repositories } = await openAdd();
        const before = await countEntries(repositories);

        await fireEvent.press(screen.getByTestId('planner-add-kind-kitchen-meal'));
        const add = await findFirst(/^planner-add-meal-.*-add$/);
        await fireEvent.press(add);

        await waitFor(async () => {
            expect(await countEntries(repositories)).toBe(before + 1);
        });
    });

    it('adds a planned restaurant meal from a free-entry form', async () => {
        const { repositories } = await openAdd();
        const before = await countEntries(repositories);

        await fireEvent.press(screen.getByTestId('planner-add-kind-restaurant'));
        await waitFor(() => screen.getByTestId('planner-add-restaurant-venue'));
        await fireEvent.changeText(
            screen.getByTestId('planner-add-restaurant-venue-input'),
            'The corner place',
        );
        await waitFor(() => {
            expect(
                screen.getByTestId('planner-add-restaurant-submit').props.accessibilityState
                    ?.disabled,
            ).not.toBe(true);
        });
        await fireEvent.press(screen.getByTestId('planner-add-restaurant-submit'));

        await waitFor(async () => {
            expect(await countEntries(repositories)).toBe(before + 1);
        });
    });

    it('is honest that a restaurant figure is an estimate rather than a measurement', async () => {
        await openAdd();
        await fireEvent.press(screen.getByTestId('planner-add-kind-restaurant'));
        await waitFor(() => screen.getByTestId('planner-add-restaurant-form'));
        await settle();
    });
});

/* ── the replacement drawer ──────────────────────────────────────────────────────────────────── */

describe('the replacement drawer', () => {
    async function openReplace() {
        viewport(1280);
        const harness = await renderScreen(<PlannerDayScreen date={unlockedEntry.date} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-menu`));
        await waitFor(() => screen.getByTestId(`${cardId(unlockedEntry)}-replace`));
        await fireEvent.press(screen.getByTestId(`${cardId(unlockedEntry)}-replace`));
        await waitFor(() => screen.getByTestId('planner-replace-body'));
        return harness;
    }

    it('names what is currently planned, so every figure has something to compare against', async () => {
        await openReplace();
        expect(screen.getByTestId('planner-replace-current')).toBeTruthy();
        await settle();
    });

    it('offers both sources and every filter the specification lists', async () => {
        await openReplace();
        expect(screen.getByTestId('planner-replace-source-meals')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-source-recipes')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-filter-kitchen')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-filter-meal-type')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-filter-diet')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-filter-allergens')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-range-energy')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-range-protein')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-range-carbohydrate')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-range-fat')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-range-price')).toBeTruthy();
        expect(screen.getByTestId('planner-replace-range-preparation')).toBeTruthy();
        await settle();
    });

    it('previews the nutrition, cost and allergen difference on every candidate', async () => {
        await openReplace();
        const row = await findFirst(/^planner-replace-candidate-.*-name$/);
        expect(row).toBeTruthy();
        expect(screen.getAllByTestId(/-difference-energy$/).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId(/-cost-difference$/).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId(/-allergen-difference$/).length).toBeGreaterThan(0);
    });

    it('marks each candidate’s compatibility with the slot', async () => {
        await openReplace();
        await findFirst(/^planner-replace-candidate-.*-compatibility$/);
        expect(screen.getAllByTestId(/-compatibility$/).length).toBeGreaterThan(0);
    });

    it('explains the scope of a recurring replacement before it is chosen', async () => {
        await openReplace();
        expect(screen.getByTestId('planner-replace-mode-explanation')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('planner-replace-mode-recurring'));
        await waitFor(() => {
            expect(
                String(screen.getByTestId('planner-replace-mode-explanation').props.children),
            ).toContain('later');
        });
    });

    it('replaces once, for real, and announces the slot that changed', async () => {
        const { repositories } = await openReplace();
        await waitFor(
            () => screen.getByTestId(`planner-replace-candidate-${otherMealId}-replace-once`),
            { timeout: 3000 },
        );
        await fireEvent.press(
            screen.getByTestId(`planner-replace-candidate-${otherMealId}-replace-once`),
        );

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, unlockedEntry.date);
            expect(day.entries.find((entry) => entry.id === unlockedEntry.id)?.label).not.toBe(
                unlockedEntry.label,
            );
        });
        await waitFor(() => {
            expect(String(screen.getByTestId('planner-announcer').props.children)).toContain(
                'replaced',
            );
        });
    });

    it('replaces every later occurrence when asked to', async () => {
        const { repositories } = await openReplace();
        await waitFor(
            () => screen.getByTestId(`planner-replace-candidate-${otherMealId}-replace-recurring`),
            { timeout: 3000 },
        );
        await fireEvent.press(
            screen.getByTestId(`planner-replace-candidate-${otherMealId}-replace-recurring`),
        );

        await waitFor(async () => {
            const day = await repositories.planner.getDay(plan.planId, unlockedEntry.date);
            expect(day.entries.find((entry) => entry.id === unlockedEntry.id)?.label).not.toBe(
                unlockedEntry.label,
            );
        });
    });

    it('switches to home-prepared recipes and keeps the difference preview', async () => {
        await openReplace();
        await fireEvent.press(screen.getByTestId('planner-replace-source-recipes'));
        await findFirst(/^planner-replace-candidate-.*-name$/);
        expect(screen.getAllByTestId(/-difference-protein$/).length).toBeGreaterThan(0);
    });

    it('offers a way back when a filter matches nothing', async () => {
        await openReplace();
        await fireEvent.changeText(screen.getByTestId('planner-replace-search-input'), 'zzzzzzz');
        await waitFor(
            () => {
                expect(screen.getByTestId('planner-replace-results-empty')).toBeTruthy();
            },
            { timeout: 3000 },
        );
        expect(screen.getByTestId('planner-replace-empty-clear')).toBeTruthy();
    });
});

/* ── the recipe record ───────────────────────────────────────────────────────────────────────── */

describe('RecipeDetailScreen', () => {
    let recipeId: string;

    beforeAll(async () => {
        const page = await scratch.foods.listRecipes({ limit: 1 });
        const first = page.items[0];
        if (first === undefined) throw new Error('The prototype world has no recipes.');
        recipeId = String(first.id);
    });

    async function renderRecipe(id = recipeId) {
        viewport(1280);
        const harness = await renderScreen(<RecipeDetailScreen recipeId={id} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => screen.getByTestId('recipe-detail-screen'));
        return harness;
    }

    it('shows the recipe, its image placeholder and its serving', async () => {
        await renderRecipe();
        await waitFor(() => screen.getByTestId('recipe-detail-name'));
        expect(screen.getByTestId('recipe-detail-image')).toBeTruthy();
        expect(screen.getByTestId('recipe-detail-serving-label')).toBeTruthy();
    });

    it('carries the full nutrition-facts panel with its provenance', async () => {
        await renderRecipe();
        await waitFor(() => screen.getByTestId('recipe-detail-facts'));
        expect(screen.getByTestId('recipe-detail-facts-version')).toBeTruthy();
        expect(screen.getByTestId('recipe-detail-facts-calculated-at')).toBeTruthy();
    });

    it('names the recipe version and the version its figures were computed from', async () => {
        await renderRecipe();
        await waitFor(() => screen.getByTestId('recipe-detail-version'));
        expect(screen.getByTestId('recipe-detail-nutrition-version')).toBeTruthy();
        expect(screen.getByTestId('recipe-detail-attribution')).toBeTruthy();
    });

    it('lists the ingredients with quantities, and the method as an ordered list', async () => {
        await renderRecipe();
        await waitFor(() => screen.getByTestId('recipe-detail-ingredients-table'));
        expect(screen.getByTestId('recipe-detail-step-1')).toBeTruthy();
    });

    it('rescales the ingredient quantities when the servings change', async () => {
        await renderRecipe();
        await waitFor(() => screen.getByTestId('recipe-detail-portion-increment'));
        const before = screen.getByTestId('recipe-detail-portion-energy').props.children;
        await fireEvent.press(screen.getByTestId('recipe-detail-portion-increment'));
        await waitFor(() => {
            expect(screen.getByTestId('recipe-detail-portion-energy').props.children).not.toBe(
                before,
            );
        });
    });

    it('adds the recipe to the plan for real', async () => {
        const { repositories } = await renderRecipe();
        await waitFor(() => {
            const button = screen.getByTestId('recipe-detail-add-to-plan');
            expect(button.props.accessibilityState?.disabled).not.toBe(true);
        });
        const before = (await repositories.planner.getDay(plan.planId, plan.weekStart)).entries
            .length;
        await fireEvent.press(screen.getByTestId('recipe-detail-add-to-plan'));

        await waitFor(async () => {
            const after = (await repositories.planner.getDay(plan.planId, plan.weekStart)).entries
                .length;
            expect(after).toBe(before + 1);
        });
    });

    it('answers an unknown recipe with a not-found rather than a failure', async () => {
        viewport(1280);
        await renderScreen(<RecipeDetailScreen recipeId="not-a-recipe" />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        expect(screen.getByTestId('recipe-detail-not-found')).toBeTruthy();
        await settle();
    });

    it('carries the standing medical disclaimer', async () => {
        await renderRecipe();
        await waitFor(() => screen.getByTestId('recipe-detail-name'));
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });
});

/* ── the grocery list ────────────────────────────────────────────────────────────────────────── */

describe('GroceryListScreen', () => {
    async function renderGrocery(week = plan.weekStart) {
        viewport(1280);
        const harness = await renderScreen(<GroceryListScreen week={week} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        await waitFor(() => screen.getByTestId('grocery-screen'));
        return harness;
    }

    it('groups the list by aisle and totals what is left to buy', async () => {
        await renderGrocery();
        await waitFor(() => screen.getByTestId('grocery-total-value'));
        expect(screen.getByTestId('grocery-outstanding')).toBeTruthy();
    });

    it('explains that kitchen meals and leftovers are never shopped for', async () => {
        await renderGrocery();
        await waitFor(() => screen.getByTestId('grocery-derivation'));
        await settle();
    });

    it('says that keeping a meal never removes anything from the list', async () => {
        await renderGrocery();
        await waitFor(() => screen.getByTestId('grocery-derivation'));
        expect(screen.getByText(/keeping a meal in your plan never removes/i)).toBeTruthy();
    });

    it('ticks an item off locally, and says the ticks are local', async () => {
        await renderGrocery();
        const tick = await findFirst(/^grocery-item-.*-tick$/);
        await fireEvent.press(tick);
        expect(screen.getByTestId('grocery-local-note')).toBeTruthy();
    });

    it('shows the pantry, so what is already at home can be marked', async () => {
        await renderGrocery();
        await waitFor(() => screen.getByTestId('grocery-pantry'));
        await findFirst(/^grocery-pantry-.*$/);
    });

    it('offers print and export as a purposeful prototype action', async () => {
        await renderGrocery();
        await waitFor(() => screen.getByTestId('prototype-action'));
        await fireEvent.press(screen.getByTestId('prototype-action'));
        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });

    it('answers a malformed week with a not-found', async () => {
        viewport(1280);
        await renderScreen(<GroceryListScreen week="last-week" />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });
        expect(screen.getByTestId('grocery-not-found')).toBeTruthy();
        await settle();
    });

    it('reports an empty list for a week with nothing cooked at home', async () => {
        await renderGrocery(addDays(plan.weekStart, 70));
        await waitFor(() => {
            expect(screen.getByTestId('grocery-empty')).toBeTruthy();
        });
    });
});
