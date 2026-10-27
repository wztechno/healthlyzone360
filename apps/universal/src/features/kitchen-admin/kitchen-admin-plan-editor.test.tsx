import { throwFailure, validationFailure } from '@healthy360/api-client/contracts';
import type { AdminEntityMeta, PlanAdmin, PlanMenu } from '@healthy360/api-client/contracts';
import { KitchenId, SubscriptionPlanId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { PlanEditScreen } from './screens/plan-edit-screen.tsx';

/*
 * The plan editor's way through, for a reader who is led rather than left to explore: Save the plan
 * is in the header on every step and there is no Previous / Next bar, a refused save opens the step
 * that holds the problem and says it under the field, the step's tab counts it, the page's issue
 * tray lists it with a Fix that opens its step from any other, a refusal that belongs to no field is
 * a card in that tray, and Cancel steps back like the browser does.
 *
 * The suite renders at 1280px, past `lg`, where the tray is docked beside the page and open.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        canGoBack: jest.fn(() => true),
        dismissTo: jest.fn(),
        setParams: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        __esModule: true,
        useRouter: () => router,
        usePathname: () => '/kitchen/plans',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __router: router,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __router: router } = require('expo-router') as {
    __router: {
        push: jest.Mock;
        replace: jest.Mock;
        back: jest.Mock;
        canGoBack: jest.Mock;
        dismissTo: jest.Mock;
    };
};

beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
    router.back.mockClear();
    router.dismissTo.mockClear();
    router.canGoBack.mockReset();
    router.canGoBack.mockReturnValue(true);
});

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

async function press(testID: string) {
    await untilVisible(testID);
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

async function type(testID: string, value: string) {
    await untilVisible(testID);
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(testID), value);
    });
}

type PlanStep = 'plan' | 'variants' | 'matrix' | 'durations' | 'menu';

/** A step tab's red count. Hidden from assistive technology: the tab's own name says it. */
function stepPill(step: PlanStep) {
    return screen.queryByTestId(`kitchen-plan-editor-screen-steps-${step}-issues`, {
        includeHiddenElements: true,
    });
}

/* ── the world ────────────────────────────────────────────────────────────────────────────────── */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');
const PLAN_ID = SubscriptionPlanId.unsafe('01935f6d-0000-7000-8000-00000000a009');

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

const PLAN: PlanAdmin = {
    id: PLAN_ID,
    meta: meta(),
    name: { en: 'Autumn reset', ar: 'إعادة ضبط الخريف' },
    summary: { en: '', ar: '' },
    description: { en: '', ar: '' },
    kitchenId: KITCHEN_ID,
    categorySlugs: [],
    dietClassifications: [],
    variants: [],
    durations: [],
    combinations: [],
    changeCutOffHours: 24,
    deliveryWeekdays: [1, 2, 3, 4, 5],
};

const MENU: PlanMenu = {
    planId: PLAN_ID,
    meta: PLAN.meta,
    cycleDays: null,
    anchorDate: null,
    entries: [],
};

/** What a new plan's editor reads before it can render. */
function newPlanReads() {
    return {
        listPlans: async () => page([]),
        listPriceLists: async () => page([]),
        listMeals: async () => page([]),
    };
}

function savedPlanReads() {
    return {
        ...newPlanReads(),
        getPlan: async () => PLAN,
        getPlanMenu: async () => MENU,
    };
}

/** Fills the one configuration and the one duration a new plan opens with, so neither stops it. */
async function fillStarterRows() {
    await press('kitchen-plan-editor-screen-steps-variants');
    const configuration = 'kitchen-plan-variants-row-variant-starter';
    for (const [field, value] of [
        ['name', 'Standard 1500'],
        ['meals', '3'],
        ['snacks', '1'],
        ['energy-min', '1400'],
        ['energy-max', '1600'],
    ] as const) {
        await type(`${configuration}-${field}-input`, value);
    }
    await press('kitchen-plan-editor-screen-steps-durations');
    await type('kitchen-plan-duration-rows-row-duration-starter-days-input', '20');
}

/* ── the tests ────────────────────────────────────────────────────────────────────────────────── */

describe('the plan editor leads the reader', () => {
    it('draws no step bar, and offers Save the plan on the first step of a new plan', async () => {
        await renderStubScreen(<PlanEditScreen plan="new" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: newPlanReads() },
        });
        await untilVisible('kitchen-plan-details');

        expect(screen.getByTestId('kitchen-plan-editor-screen-save')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-plan-steps-nav')).toBeNull();
        expect(screen.queryByTestId('kitchen-plan-steps-nav-next')).toBeNull();
        // No banner of issues over the steps: the steps' own counts and the tray tell problems,
        // and a form nobody has typed in yet has none — its blanks wait for Save.
        expect(screen.queryByTestId('kitchen-plan-issues')).toBeNull();
        expect(screen.getByTestId('kitchen-plan-tray-clear')).toBeTruthy();
    });

    it('opens the first step that stops a new plan, and names the blank under its field', async () => {
        const { repositories } = await renderStubScreen(<PlanEditScreen plan="new" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: newPlanReads() },
        });
        await fillStarterRows();
        // Pressed from the last step, with the plan's own name still blank on the first.
        await press('kitchen-plan-editor-screen-steps-menu');
        await press('kitchen-plan-editor-screen-save');

        await untilVisible('kitchen-plan-name-en-error');
        expect(screen.getByTestId('kitchen-plan-details')).toBeTruthy();
        expect(stepPill('plan')).toHaveTextContent('1');
        expect(repositories.kitchenAdmin.createPlan).not.toHaveBeenCalled();

        // The tray names it too, and its Fix opens the plan step from wherever the reader is.
        expect(screen.getByTestId('kitchen-plan-issues-errors-name')).toBeTruthy();
        await press('kitchen-plan-editor-screen-steps-durations');
        expect(screen.queryByTestId('kitchen-plan-details')).toBeNull();
        await press('kitchen-plan-issues-errors-name-fix');
        await untilVisible('kitchen-plan-details');

        // Typed, the card clears itself.
        await type('kitchen-plan-name-en-input', 'Autumn reset');
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-plan-issues-errors-name')).toBeNull();
        });
    });

    it('opens the plan step when the server refuses a field there, and says so under it', async () => {
        await renderStubScreen(<PlanEditScreen plan="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...newPlanReads(),
                    createPlan: () =>
                        throwFailure(
                            validationFailure({ name_ar: ['That Arabic name is already used.'] }),
                        ),
                },
            },
        });
        await type('kitchen-plan-name-en-input', 'Autumn reset');
        await type('kitchen-plan-name-ar-input', 'إعادة ضبط الخريف');
        await fillStarterRows();
        await press('kitchen-plan-editor-screen-steps-menu');
        await press('kitchen-plan-editor-screen-save');

        await untilVisible('kitchen-plan-name-ar-error');
        expect(screen.getByTestId('kitchen-plan-name-ar-error')).toHaveTextContent(
            'That Arabic name is already used.',
        );
        expect(screen.getByTestId('kitchen-plan-details')).toBeTruthy();
        expect(stepPill('plan')).toHaveTextContent('1');
        // Placed on its field: the tray names the field, and has no words of its own to add.
        expect(screen.getByTestId('kitchen-plan-issues-errors-server-name_ar')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-plan-save-error')).toBeNull();
    });

    it('says a refusal that belongs to no field as a card in the tray', async () => {
        await renderStubScreen(<PlanEditScreen plan={String(PLAN_ID)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...savedPlanReads(),
                    updatePlan: () =>
                        throwFailure(validationFailure({ kitchen: ['The kitchen is closed.'] })),
                },
            },
        });
        await type('kitchen-plan-cut-off-input', '48');
        await press('kitchen-plan-editor-screen-steps-durations');
        await press('kitchen-plan-editor-screen-save');

        await untilVisible('kitchen-plan-save-error');
        expect(screen.getByTestId('kitchen-plan-save-error')).toHaveTextContent(
            /The kitchen is closed\./,
        );
        expect(screen.getByTestId('kitchen-plan-details')).toBeTruthy();
    });

    it('opens the plan step and marks the cut-off when the server refuses it', async () => {
        await renderStubScreen(<PlanEditScreen plan={String(PLAN_ID)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...savedPlanReads(),
                    updatePlan: () =>
                        throwFailure(
                            validationFailure({ change_cutoff_hours: ['Too late to change.'] }),
                        ),
                },
            },
        });
        await type('kitchen-plan-cut-off-input', '48');
        await press('kitchen-plan-editor-screen-steps-menu');
        await press('kitchen-plan-editor-screen-save');

        await untilVisible('kitchen-plan-cut-off-error');
        expect(screen.getByTestId('kitchen-plan-cut-off-error')).toHaveTextContent(
            'Too late to change.',
        );
        expect(stepPill('plan')).toHaveTextContent('1');
    });

    it('goes back a step on Cancel instead of opening a fresh list', async () => {
        await renderStubScreen(<PlanEditScreen plan={String(PLAN_ID)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: savedPlanReads() },
        });
        await press('kitchen-plan-editor-screen-back');

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.push).not.toHaveBeenCalled();
    });

    it('opens the list from a broken link when there is nothing to go back to', async () => {
        router.canGoBack.mockReturnValue(false);
        await renderStubScreen(<PlanEditScreen plan="not-a-uuid" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: newPlanReads() },
        });
        await press('kitchen-plan-not-found-back');

        expect(router.back).not.toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith('/kitchen/plans');
    });
});
