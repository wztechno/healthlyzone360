import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import type { MealPlanWeek, ReviewQueueItem } from '@healthy360/api-client/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import {
    PRIORITY_TONE,
    QUEUE_STATE_TONE,
    declaredConstraints,
    enforcedConstraints,
    isOpenReview,
    reasonKey,
    warningKey,
} from './format.ts';
import { ClientPlanScreen } from './screens/client-plan-screen.tsx';
import { ReviewDetailScreen } from './screens/review-detail-screen.tsx';
import { ReviewQueueScreen } from './screens/review-queue-screen.tsx';

/**
 * The dietitian's surfaces, against the real mock repositories.
 *
 * Three things this file exists to prove:
 *
 * 1. **The medical disclaimer reaches every screen that shows client health data.** It is asserted
 *    on all three rather than left to reviewer memory (plan §5).
 * 2. **A professional decision genuinely changes the world.** Approving marks the client's stored
 *    target as professionally approved; requesting changes moves the queue item; an override re-runs
 *    the engine with the professional's figures attached. None of them is a prototype notice,
 *    because the store honours all of them.
 * 3. **`dietitian_enforced` restrictions are kept apart from what the client declared.** That
 *    distinction is the entire reason the review screen exists, and merging the two lists would hide
 *    it behind a tidy layout.
 */

const DIETITIAN = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const FIXTURE_WEEK = '2026-07-27';

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/dietitian',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

async function renderProfessional(node: ReactNode): Promise<Harness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'multi-org-dietitian',
        latencyMs: 5,
        tokenStore,
    });
    await repositories.auth.login({ email: DIETITIAN, password: 'password' });

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories };
}

/** Fixture facts, read from a throwaway bundle rather than scraped from a tree under test. */
const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

let queue: readonly ReviewQueueItem[];
let targetReview: ReviewQueueItem;
let planReview: ReviewQueueItem;
let week: MealPlanWeek;

beforeAll(async () => {
    const page = await scratch.professional.listReviewQueue();
    queue = page.items;

    const target = queue.find((item) => item.subject === 'nutrition_target');
    const plan = queue.find((item) => item.subject === 'meal_plan' && item.planId !== null);
    if (target === undefined || plan === undefined) {
        throw new Error('The prototype world seeds no target or plan review.');
    }
    targetReview = target;
    planReview = plan;

    if (plan.planId === null) throw new Error('The plan review carries no plan.');
    week = await scratch.professional.getClientPlan(plan.clientId, plan.planId, FIXTURE_WEEK);
});

/* ══ pure: queue presentation ══════════════════════════════════════════════════════════════════ */

describe('queue presentation', () => {
    it('treats only the undecided states as open', () => {
        expect(isOpenReview('awaiting_review')).toBe(true);
        expect(isOpenReview('in_review')).toBe(true);
        // The professional has acted; the ball is with the client.
        expect(isOpenReview('changes_requested')).toBe(false);
        expect(isOpenReview('approved')).toBe(false);
        expect(isOpenReview('declined')).toBe(false);
    });

    it('escalates the priority tone rather than reusing one colour', () => {
        expect(PRIORITY_TONE.routine).toBe('neutral');
        expect(PRIORITY_TONE.soon).toBe('warning');
        expect(PRIORITY_TONE.urgent).toBe('danger');
        expect(QUEUE_STATE_TONE.approved).toBe('success');
    });

    it('namespaces every code it renders, so a raw code never reaches a screen by accident', () => {
        expect(reasonKey('energy_floor_applied')).toBe('professional:reasons.energy_floor_applied');
        // The `planner.` prefix is a namespace on the wire, not part of the code's meaning.
        expect(warningKey('planner.allergen_conflict')).toBe(
            'professional:warnings.allergen_conflict',
        );
        expect(warningKey('allergen_conflict')).toBe('professional:warnings.allergen_conflict');
    });

    it('separates what a dietitian enforced from what the client declared', () => {
        const constraints = [
            {
                kind: 'dietitian_enforced' as const,
                code: 'added_sugar',
                label: 'Added sugar',
                severity: 'strict' as const,
                source: 'dietitian' as const,
                note: null,
            },
            {
                kind: 'allergy' as const,
                code: 'tree_nuts',
                label: 'Tree nuts',
                severity: 'critical' as const,
                source: 'user' as const,
                note: null,
            },
        ];

        expect(enforcedConstraints(constraints).map((one) => one.code)).toEqual(['added_sugar']);
        expect(declaredConstraints(constraints).map((one) => one.code)).toEqual(['tree_nuts']);
        expect(enforcedConstraints(undefined)).toEqual([]);
    });
});

/* ══ the review queue ══════════════════════════════════════════════════════════════════════════ */

describe('review queue', () => {
    it('lists every waiting item with its priority, subject and reasons', async () => {
        await renderProfessional(<ReviewQueueScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('review-queue-list')).toBeTruthy();
        });

        for (const item of queue) {
            expect(screen.getByTestId(`review-row-${item.id}-client`)).toBeTruthy();
            expect(screen.getByTestId(`review-row-${item.id}-priority`)).toBeTruthy();
            expect(screen.getByTestId(`review-row-${item.id}-subject`)).toBeTruthy();
            expect(screen.getByTestId(`review-row-${item.id}-reasons`)).toBeTruthy();
        }
    });

    it('carries the medical disclaimer, because it names a person beside a triage priority', async () => {
        await renderProfessional(<ReviewQueueScreen />);
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('narrows to one subject and back out again', async () => {
        await renderProfessional(<ReviewQueueScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('review-queue-list')).toBeTruthy();
        });
        const before = screen.queryAllByTestId(/^review-row-.+-client$/).length;
        expect(before).toBeGreaterThan(1);

        fireEvent.press(screen.getByTestId('review-queue-subject-nutrition_target'));
        await waitFor(() => {
            expect(screen.queryAllByTestId(/^review-row-.+-client$/).length).toBeLessThan(before);
        });

        fireEvent.press(screen.getByTestId('review-queue-subject-nutrition_target'));
        await waitFor(() => {
            expect(screen.queryAllByTestId(/^review-row-.+-client$/)).toHaveLength(before);
        });
    });

    it('offers an empty state with a way out when a filter matches nothing', async () => {
        await renderProfessional(<ReviewQueueScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('review-queue-list')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('review-queue-state-decided'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('review-queue-subject-virtual_dietitian'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('review-queue-empty')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('review-queue-clear'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('review-queue-list')).toBeTruthy();
        });
    });
});

/* ══ the review detail ═════════════════════════════════════════════════════════════════════════ */

describe('review detail', () => {
    it('shows the target, its macros and the prototype provenance of both', async () => {
        await renderProfessional(<ReviewDetailScreen reviewId={targetReview.id} />);

        await waitFor(() => {
            expect(screen.getByTestId('review-detail-target')).toBeTruthy();
        });
        expect(screen.getByTestId('review-detail-maintenance')).toBeTruthy();
        expect(screen.getByTestId('review-detail-target-energy')).toBeTruthy();
        expect(screen.getByTestId('review-detail-macros')).toBeTruthy();
        expect(screen.getByTestId('review-detail-method')).toBeTruthy();
        expect(screen.getByTestId('review-detail-prototype-engine')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('shows the reasons and the reading-order context a professional needs first', async () => {
        await renderProfessional(<ReviewDetailScreen reviewId={targetReview.id} />);

        await waitFor(() => {
            expect(screen.getByTestId('review-detail-context')).toBeTruthy();
        });
        expect(screen.getByTestId('review-detail-context-1')).toBeTruthy();
        expect(screen.getByTestId('review-detail-client-note')).toBeTruthy();
        for (const reason of targetReview.reasons) {
            expect(screen.getByTestId(`review-detail-reason-${reason}`)).toBeTruthy();
        }
    });

    it('keeps the dietitian-enforced restrictions in their own block', async () => {
        await renderProfessional(<ReviewDetailScreen reviewId={targetReview.id} />);

        await waitFor(() => {
            expect(screen.getByTestId('review-detail-enforced')).toBeTruthy();
        });
        expect(screen.getByTestId('review-detail-declared')).toBeTruthy();
        // The fixture client carries a practice-set added-sugar limit.
        expect(screen.queryAllByTestId(/^review-detail-enforced-.+$/).length).toBeGreaterThan(0);
    });

    it('will not approve without a signature, then really approves', async () => {
        const { repositories } = await renderProfessional(
            <ReviewDetailScreen reviewId={targetReview.id} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('review-approve')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('review-approve'));

        await waitFor(() => {
            expect(screen.getByTestId('review-approve-confirm')).toBeTruthy();
        });
        expect(
            screen.getByTestId('review-approve-confirm').props.accessibilityState?.disabled,
        ).toBe(true);

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('review-approve-signature-input'),
                'Layla Haddad, RD',
            );
        });

        fireEvent.press(screen.getByTestId('review-approve-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('review-announcer').props.children).toBeTruthy();
        });
        await waitFor(() => {
            expect(repositories.prototypeStore.review(targetReview.id).item.state).toBe('approved');
        });
        // Approving a target review marks the client's stored target as professionally approved.
        expect(repositories.prototypeStore.currentTargets()?.professionallyApproved).toBe(true);
    });

    it('really requests changes, with a note and a priority', async () => {
        const { repositories } = await renderProfessional(
            <ReviewDetailScreen reviewId={planReview.id} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('review-request-changes')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('review-request-changes'));

        await waitFor(() => {
            expect(screen.getByTestId('review-changes-note-input')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('review-changes-note-input'),
                'Please swap Friday dinner for something lower in sodium.',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('review-changes-priority-urgent'));
        });
        fireEvent.press(screen.getByTestId('review-changes-confirm'));

        await waitFor(() => {
            expect(repositories.prototypeStore.review(planReview.id).item.state).toBe(
                'changes_requested',
            );
        });
        expect(repositories.prototypeStore.review(planReview.id).item.priority).toBe('urgent');
    });

    it('really records a professional override, with its reason', async () => {
        const { repositories } = await renderProfessional(
            <ReviewDetailScreen reviewId={targetReview.id} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('review-set-override')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('review-set-override'));

        await waitFor(() => {
            expect(screen.getByTestId('review-override-reason-input')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('review-override-reason-input'),
                'Training load is higher than the questionnaire assumed.',
            );
        });
        fireEvent.press(screen.getByTestId('review-override-confirm'));

        await waitFor(() => {
            expect(repositories.prototypeStore.currentTargets()?.result.override).not.toBeNull();
        });
        expect(repositories.prototypeStore.currentTargets()?.result.override?.reason).toContain(
            'Training load',
        );
    });

    it('summarises the week under review and offers the full plan', async () => {
        await renderProfessional(<ReviewDetailScreen reviewId={planReview.id} />);

        await waitFor(() => {
            expect(screen.getByTestId('review-detail-plan')).toBeTruthy();
        });
        expect(screen.getByTestId('review-detail-plan-week')).toBeTruthy();
        expect(screen.getByTestId('review-detail-plan-entries')).toBeTruthy();

        fireEvent.press(screen.getByTestId('review-detail-open-plan'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            expect.stringContaining('/dietitian/clients/'),
        );
    });

    it('answers an unknown review with an error state rather than a blank screen', async () => {
        await renderProfessional(<ReviewDetailScreen reviewId="review-does-not-exist" />);
        await waitFor(() => {
            expect(screen.getByTestId('review-detail-error')).toBeTruthy();
        });
    });
});

/* ══ the client plan ═══════════════════════════════════════════════════════════════════════════ */

describe('client plan', () => {
    it('renders the week the professional was handed, day by day', async () => {
        if (planReview.planId === null) throw new Error('The plan review carries no plan.');

        await renderProfessional(
            <ClientPlanScreen
                clientId={String(planReview.clientId)}
                planId={String(planReview.planId)}
                weekStart={FIXTURE_WEEK}
            />,
        );

        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('client-plan-days')).toBeTruthy();
        });
        expect(screen.getByTestId(`client-plan-day-${FIXTURE_WEEK}`)).toBeTruthy();
        expect(screen.getByTestId('client-plan-average-energy')).toBeTruthy();
        expect(screen.getByTestId('client-plan-planned-note')).toBeTruthy();
    });

    it('flags an entry that carries an allergen or a planner warning', async () => {
        if (planReview.planId === null) throw new Error('The plan review carries no plan.');

        await renderProfessional(
            <ClientPlanScreen
                clientId={String(planReview.clientId)}
                planId={String(planReview.planId)}
                weekStart={FIXTURE_WEEK}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('client-plan-days')).toBeTruthy();
        });

        const flagged = week.days
            .flatMap((day) => day.entries)
            .find((entry) => entry.warnings.length > 0);
        expect(flagged).toBeDefined();
        if (flagged === undefined) return;
        expect(screen.getByTestId(`client-plan-entry-${String(flagged.id)}-warnings`)).toBeTruthy();
    });

    it('really saves a note onto the plan', async () => {
        if (planReview.planId === null) throw new Error('The plan review carries no plan.');

        const { repositories } = await renderProfessional(
            <ClientPlanScreen
                clientId={String(planReview.clientId)}
                planId={String(planReview.planId)}
                weekStart={FIXTURE_WEEK}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('client-plan-note-input-input')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('client-plan-note-input-input'),
                'Keep the sodium ceiling in view on kitchen-meal days.',
            );
        });
        fireEvent.press(screen.getByTestId('client-plan-note-save'));

        await waitFor(() => {
            expect(
                repositories.prototypeStore.getNotes(planReview.planId!).dietitianNote,
            ).toContain('sodium ceiling');
        });
    });

    it('answers a malformed address with a not-found rather than a failed request', async () => {
        await renderProfessional(
            <ClientPlanScreen clientId="not-a-client" planId="not-a-plan" weekStart="last week" />,
        );
        expect(screen.getByTestId('client-plan-not-found')).toBeTruthy();
    });
});
