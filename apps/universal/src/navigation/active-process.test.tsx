import { renderHook } from '@testing-library/react-native';

import {
    endProcess,
    isOutsideProcess,
    readActiveProcess,
    startProcess,
    useProcessStep,
} from './active-process.ts';
import type { ActiveProcess } from './active-process.ts';
import { clearAllSessionDrafts } from './session-draft.ts';

const STOCK_GAPS = '/kitchen/consumption-exceptions';
const RECIPE = '/kitchen/recipes/recipe-1';
const INGREDIENT = '/kitchen/ingredients/ingredient-9';

function stockGapFix(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
    return {
        kind: 'stockGapFix',
        subject: 'Bbq Sauce Dip',
        resumeHref: `${RECIPE}?fix=no_recipe_version`,
        originPath: STOCK_GAPS,
        stepPaths: [RECIPE],
        ...overrides,
    };
}

afterEach(() => {
    endProcess();
});

describe('the active process', () => {
    it('is remembered until it ends, and forgotten on sign-out with every other draft', async () => {
        expect(readActiveProcess()).toBeNull();
        startProcess(stockGapFix());
        expect(readActiveProcess()).toEqual(stockGapFix());

        endProcess();
        expect(readActiveProcess()).toBeNull();

        startProcess(stockGapFix());
        clearAllSessionDrafts();
        expect(readActiveProcess()).toBeNull();
    });

    it('takes a page as a step only when it was opened from the process', async () => {
        startProcess(stockGapFix());
        const ingredientHref = `${INGREDIENT}?needs=allergens`;

        // Opened from the recipe, a step of it: the ingredient joins it and is where Continue goes.
        await renderHook(() => {
            useProcessStep(ingredientHref, `${RECIPE}?fix=no_recipe_version`);
        });
        expect(readActiveProcess()).toEqual(
            stockGapFix({ resumeHref: ingredientHref, stepPaths: [RECIPE, INGREDIENT] }),
        );

        // Opened from somewhere else entirely: not part of it, nothing changes.
        await renderHook(() => {
            useProcessStep('/kitchen/recipes/recipe-7', '/kitchen/review');
        });
        expect(readActiveProcess()?.resumeHref).toBe(ingredientHref);

        // Opened on its own: never a step.
        await renderHook(() => {
            useProcessStep('/kitchen/recipes/recipe-8', null);
        });
        expect(readActiveProcess()?.resumeHref).toBe(ingredientHref);
    });

    it('starts nothing from a step when no process is running', async () => {
        await renderHook(() => {
            useProcessStep(`${RECIPE}?tab=costing`, STOCK_GAPS);
        });
        expect(readActiveProcess()).toBeNull();
    });

    it('offers Continue only outside the process — its origin counts as outside', async () => {
        const process = stockGapFix();
        expect(isOutsideProcess(process, '/kitchen/ingredients')).toBe(true);
        expect(isOutsideProcess(process, STOCK_GAPS)).toBe(true);
        expect(isOutsideProcess(process, RECIPE)).toBe(false);
        expect(isOutsideProcess(null, '/kitchen/ingredients')).toBe(false);
    });
});
