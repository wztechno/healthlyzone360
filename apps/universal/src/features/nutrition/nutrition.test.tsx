import { MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import type { UserId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { queryKeys } from '../../data/query-keys.ts';
import { renderScreen } from '../../testing/render-screen.tsx';
import { NutritionTargetScreen } from './nutrition-target-screen.tsx';

const CONSUMER = MOCK_SCENARIOS['consumer-prototype'].primaryEmail;

const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, back: jest.fn(), setParams: jest.fn() }),
        usePathname: () => '/customer/nutrition',
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
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
});

/**
 * Flushes one macrotask inside `act`.
 *
 * TanStack delivers cache notifications through a batched timeout, so the stored-target query
 * updates a tick after `render` resolves. A test that asserts synchronously and ends would receive
 * that update outside any `act` boundary — a genuine cross-test leak rather than cosmetic noise.
 */
async function settleQueries() {
    // Twice: the session query is enabled by a token-store notification, so its result lands one
    // batch after the queries that fire directly on mount.
    for (let pass = 0; pass < 2; pass += 1) {
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });
    }
}

interface RenderTargetsOptions {
    readonly scenario?: 'consumer-prototype' | 'consumer-onboarding' | undefined;
    /** Leave the on-mount query in flight, for the test that asserts the loading state. */
    readonly settle?: boolean | undefined;
}

async function renderTargets(options: RenderTargetsOptions = {}) {
    const harness = await renderScreen(<NutritionTargetScreen />, {
        scenario: options.scenario ?? 'consumer-prototype',
        signInAs: CONSUMER,
    });
    if (options.settle !== false) await settleQueries();
    return harness;
}

/* ------------------------------------------------------------------------------------------------
 * The four states
 * ---------------------------------------------------------------------------------------------- */

describe('NutritionTargetScreen — states', () => {
    it('shows a skeleton before anything has arrived', async () => {
        await renderTargets({ settle: false });
        expect(screen.getByTestId('nutrition-target-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));
    });

    it('treats "no target yet" as a designed state with a way out of it', async () => {
        await renderTargets({ scenario: 'consumer-onboarding' });

        await waitFor(() => {
            expect(screen.getByTestId('nutrition-target-empty')).toBeTruthy();
        });

        await fireEvent.press(screen.getByTestId('nutrition-empty-start-onboarding'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding');
    });

    it('renders the stored target when there is one', async () => {
        await renderTargets();

        await waitFor(() => {
            expect(screen.getByTestId('nutrition-target-content')).toBeTruthy();
        });
        expect(screen.getByTestId('nutrition-title')).toBeTruthy();
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Transparency
 * ---------------------------------------------------------------------------------------------- */

describe('NutritionTargetScreen — transparency', () => {
    it('separates estimated maintenance from the selected target', async () => {
        const { repositories } = await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        const stored = await repositories.nutrition.getCurrentTargets();
        expect(stored).not.toBeNull();

        // Two different figures, each with its own label and its own explanation.
        expect(screen.getByTestId('nutrition-maintenance')).toBeTruthy();
        expect(screen.getByTestId('nutrition-target-energy')).toBeTruthy();
        expect(screen.getByTestId('nutrition-energy-tolerance')).toBeTruthy();
        expect(screen.getByTestId('nutrition-bmr')).toBeTruthy();
        expect(stored!.result.maintenanceEnergy).not.toBe(stored!.result.targetEnergy);
    });

    it('names the calculation source as a prototype rather than implying a clinical one', async () => {
        await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        expect(screen.getByTestId('nutrition-provenance')).toBeTruthy();
        expect(screen.getByTestId('nutrition-source-badge')).toBeTruthy();
        expect(screen.getByTestId('nutrition-method-badge')).toBeTruthy();
        expect(screen.getByTestId('nutrition-calculated-at')).toBeTruthy();
        expect(screen.getByTestId('nutrition-source-note')).toBeTruthy();
    });

    it('shows grams, percentages, energy and tolerance for every macro, plus fibre', async () => {
        await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        expect(screen.getByTestId('nutrition-macro-table')).toBeTruthy();
        for (const nutrient of ['protein', 'carbohydrate', 'fat']) {
            expect(screen.getByTestId(`nutrition-macro-meter-${nutrient}`)).toBeTruthy();
            expect(screen.getByTestId(`nutrition-grams-${nutrient}`)).toBeTruthy();
        }
        // Fibre is a first-class row even though it is not a macro.
        expect(screen.getByTestId('nutrition-grams-fibre')).toBeTruthy();
    });

    it('walks the engine explanation, with formulae and citations', async () => {
        await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        expect(screen.getByTestId('nutrition-explanation')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-why')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-assumptions')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-citations')).toBeTruthy();

        // Opening it reveals the engine's own steps rather than hand-written copy.
        await fireEvent.press(screen.getByTestId('nutrition-explanation-why'));

        await waitFor(() => {
            expect(screen.getByTestId('nutrition-explanation-step-bmr')).toBeTruthy();
        });
        expect(screen.getByTestId('nutrition-explanation-formula-bmr')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-citation-bmr')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-step-maintenance')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-step-protein')).toBeTruthy();
        expect(screen.getByTestId('nutrition-explanation-step-fibre')).toBeTruthy();
    });

    it('says plainly when nobody has overridden anything', async () => {
        await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        expect(screen.getByTestId('nutrition-override-absent')).toBeTruthy();
        expect(screen.queryByTestId('nutrition-override')).toBeNull();
        expect(screen.getByTestId('nutrition-unapproved-badge')).toBeTruthy();
    });

    it('marks a professional override, names when, and keeps the original working visible', async () => {
        const { repositories, queryClient } = await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        const stored = await repositories.nutrition.getCurrentTargets();

        // A dietitian acts elsewhere; the screen refetches and must show it.
        await repositories.professional.setOverride({
            clientId: 'prototype-client' as unknown as UserId,
            targetId: stored!.id,
            reason: 'Raised while training volume is high.',
            targetEnergy: 2100,
        });

        await act(async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.all() });
        });

        await waitFor(() => {
            expect(screen.getByTestId('nutrition-override')).toBeTruthy();
        });
        expect(screen.getByTestId('nutrition-override-who')).toBeTruthy();
        expect(screen.getByTestId('nutrition-override-reason')).toBeTruthy();
        expect(screen.getByTestId('nutrition-override-original')).toBeTruthy();
        expect(screen.getByTestId('nutrition-approved-badge')).toBeTruthy();
        // The steps that produced the replaced figure are still there to be read.
        expect(screen.getByTestId('nutrition-explanation')).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------------------------------- */

describe('NutritionTargetScreen — actions', () => {
    it('requests a real dietitian review and shows the pending state', async () => {
        const { repositories } = await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        await fireEvent.press(screen.getByTestId('nutrition-request-review'));

        await waitFor(() => {
            expect(screen.getByTestId('nutrition-review-pending')).toBeTruthy();
        });

        // The request reached the professional queue, not only the screen.
        const queue = await repositories.professional.listReviewQueue({
            subjects: ['nutrition_target'],
        });
        expect(queue.items.length).toBeGreaterThan(0);
    });

    it('recalculates through the repository and keeps the figures derived', async () => {
        const { repositories } = await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        const before = await repositories.nutrition.getCurrentTargets();
        await fireEvent.press(screen.getByTestId('nutrition-recalculate'));

        await waitFor(() => {
            expect(screen.getByTestId('nutrition-target-content')).toBeTruthy();
        });

        const after = await repositories.nutrition.getCurrentTargets();
        // Same inputs, same arithmetic — the point of a deterministic engine.
        expect(after?.result.targetEnergy).toBe(before?.result.targetEnergy);
        expect(after?.result.macros).toEqual(before?.result.macros);
    });

    it('offers a route back to the answers behind the figures', async () => {
        await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        await fireEvent.press(screen.getByTestId('nutrition-edit-answers'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding');
    });

    it('surfaces the engine review flag rather than hiding it behind the number', async () => {
        const { repositories } = await renderTargets();
        await waitFor(() => screen.getByTestId('nutrition-target-content'));

        const stored = await repositories.nutrition.getCurrentTargets();
        // The prototype person carries an allergy and a self-declared medical note, so the
        // engine asks for a review. If that ever stops being true the fixture changed, and this
        // screen's most important state would silently stop being exercised.
        expect(stored?.result.requiresProfessionalReview).toBe(true);
        expect(screen.getByTestId('nutrition-review-required')).toBeTruthy();
    });
});
