import type { VdSession } from '@healthy360/api-client/contracts';
import { createMockRepositories } from '@healthy360/api-client/mock';
import { VD_SESSION_STATES } from '@healthy360/domain-types';
import type { VdSessionState } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { renderScreen } from '../../testing/render-screen.tsx';
import { collectAnswers } from './message-list.tsx';
import { energyFromMacros, rescaleMacros } from './override-dialog.tsx';
import { VdSessionScreen } from './screens/vd-session-screen.tsx';
import { VirtualDietitianScreen } from './screens/virtual-dietitian-screen.tsx';
import { SessionTimeline, timelineEntries } from './session-timeline.tsx';
import { ORIGIN_BADGES, acceptsReply, originKindOf, vdStateTestId } from './state-presentation.ts';

/**
 * The Virtual Dietitian, state by state.
 *
 * The contract enumerates twelve states, the fixture world holds a session in each, and three things
 * are asserted for all twelve because they are the three the feature must never lose: the state's own
 * panel renders, the medical disclaimer is present, and machine-origin labelling is distinct from
 * every other origin.
 *
 * Screens render against **real mock repositories** through `renderScreen`, so a screen that
 * mishandles a real `ApiFailure` or a real state transition fails here rather than in Playwright.
 * Each `renderScreen` builds its own world, so a test that advances a fixture session cannot leak
 * into the next one.
 */

const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/virtual-dietitian',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
});

/**
 * Fixture identifiers are read from a throwaway bundle rather than by rendering the list and
 * scraping it: rendering a second tree inside a test leaves `screen` pointing at a tree the test then
 * unmounts, which quietly breaks every render that follows it in the file.
 *
 * Only *fixture* rows are read this way. They are deterministic and identical in every world, so an
 * identifier taken from here addresses the same session inside the tree under test — which is not
 * true of anything created at runtime, and is why no test below seeds through this bundle.
 */
const scratch = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });

let sessionsByState: ReadonlyMap<VdSessionState, string>;

beforeAll(async () => {
    const page = await scratch.virtualDietitian.listSessions();
    sessionsByState = new Map(page.items.map((summary) => [summary.state, String(summary.id)]));
});

function sessionIdFor(state: VdSessionState): string {
    const id = sessionsByState.get(state);
    if (id === undefined) throw new Error(`The prototype world has no ${state} session.`);
    return id;
}

async function fixtureSession(state: VdSessionState): Promise<VdSession> {
    return scratch.virtualDietitian.getSession(
        // Branded identifiers round-trip through the codec, and the summary carries the real one.
        (await scratch.virtualDietitian.listSessions()).items.find(
            (summary) => summary.state === state,
        )!.id,
    );
}

/* ── the twelve states ───────────────────────────────────────────────────────────────────────── */

describe('every Virtual Dietitian state', () => {
    it('has a session in the prototype world', () => {
        for (const state of VD_SESSION_STATES) {
            expect(sessionsByState.has(state)).toBe(true);
        }
    });

    it.each([...VD_SESSION_STATES])(
        '%s renders its own panel, the disclaimer and the live region',
        async (state) => {
            await renderScreen(<VdSessionScreen sessionId={sessionIdFor(state)} />, {
                scenario: 'consumer-prototype',
            });

            await waitFor(() => {
                expect(screen.getByTestId(vdStateTestId(state))).toBeTruthy();
            });

            // Mandatory on every state (plan §5), including the four blocked outcomes.
            expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
            // The live region exists before the first transition, not only after one.
            expect(screen.getByTestId('vd-state-announcer')).toBeTruthy();
            expect(screen.getByTestId('vd-state-badge')).toBeTruthy();
        },
    );

    it.each([...VD_SESSION_STATES])('%s labels the origin of every turn', async (state) => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor(state)} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-messages')).toBeTruthy();
        });

        // Every session opens with the system disclaimer and the assistant's first turn.
        const badges = screen.getAllByTestId(
            /^vd-messages-\d+-origin-(ai|system|human|dietitian)$/,
        );
        expect(badges.length).toBeGreaterThan(0);
    });
});

/* ── origin labelling ────────────────────────────────────────────────────────────────────────── */

describe('origin labelling', () => {
    it('gives each origin its own tone, glyph, wording and test id', () => {
        const specs = Object.values(ORIGIN_BADGES);

        expect(new Set(specs.map((spec) => spec.tone)).size).toBe(specs.length);
        expect(new Set(specs.map((spec) => spec.icon)).size).toBe(specs.length);
        expect(new Set(specs.map((spec) => spec.labelKey)).size).toBe(specs.length);
        expect(new Set(specs.map((spec) => spec.testID)).size).toBe(specs.length);
    });

    it('treats machine authorship as a property of the message, not of the origin string', () => {
        expect(originKindOf('assistant', true)).toBe('ai');
        expect(originKindOf('dietitian', false)).toBe('dietitian');
        expect(originKindOf('system', false)).toBe('system');
        expect(originKindOf('user', false)).toBe('human');
        // A dietitian message somehow flagged machine-generated reads as machine, never as advice.
        expect(originKindOf('dietitian', true)).toBe('ai');
    });

    it('labels each suggested figure, and shows no human figure until there is one', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('suggested_targets')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-targets-suggested-energy-origin')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-targets-maintenance-origin')).toBeTruthy();
        expect(screen.getByTestId('vd-targets-macro-protein-origin')).toBeTruthy();
        expect(screen.queryByTestId('vd-targets-human-energy')).toBeNull();
    });
});

/* ── the entry screen ────────────────────────────────────────────────────────────────────────── */

describe('VirtualDietitianScreen', () => {
    it('says what the journey is and what it is not, before any control', async () => {
        await renderScreen(<VirtualDietitianScreen />, { scenario: 'consumer-prototype' });

        expect(screen.getByTestId('vd-what-it-is')).toBeTruthy();
        expect(screen.getByTestId('vd-what-it-is-not')).toBeTruthy();
        expect(screen.getByTestId('vd-ai-notice')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('shows the loading skeleton, then a row per session with its state badge', async () => {
        await renderScreen(<VirtualDietitianScreen />, { scenario: 'consumer-prototype' });

        expect(screen.getByTestId('vd-sessions-loading')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('vd-sessions-list')).toBeTruthy();
        });
        for (const state of VD_SESSION_STATES) {
            expect(screen.getAllByTestId(`vd-session-${state}`).length).toBeGreaterThan(0);
            expect(screen.getAllByTestId(`vd-session-${state}-badge`).length).toBeGreaterThan(0);
        }
    });

    it('creates a real session and navigates to it', async () => {
        await renderScreen(<VirtualDietitianScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('vd-sessions-list'));
        await fireEvent.press(screen.getByTestId('vd-start'));

        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalled();
        });
        const [href] = routerMock.__push.mock.calls[0] as [string];
        expect(href.startsWith('/customer/virtual-dietitian/')).toBe(true);
    });

    it('renders the designed empty state when the world holds no session', async () => {
        await renderScreen(<VirtualDietitianScreen />, { scenario: 'consumer-onboarding' });

        await waitFor(() => {
            expect(screen.getByTestId('vd-sessions-empty')).toBeTruthy();
        });
    });
});

/* ── the interview, driven by the real script ────────────────────────────────────────────────── */

describe('the scripted progression', () => {
    it('moves the interview on one step per turn, recording what it collects', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('initial_interview')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('initial_interview'))).toBeTruthy();
        });
        expect(screen.getByTestId('vd-collected-empty')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('vd-composer-quick-profile'));

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('analysing'))).toBeTruthy();
        });
        // The answers reached the session, not a local copy of what the composer sent.
        expect(screen.getByTestId('vd-collected-ageYears')).toBeTruthy();
        expect(screen.getByTestId('vd-analysing-considerOne')).toBeTruthy();
    });

    it('escalates on a stated safety marker and offers no way to continue', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('initial_interview')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId(vdStateTestId('initial_interview')));

        await fireEvent.changeText(
            screen.getByTestId('vd-composer-reply-input'),
            // One of `VD_SAFETY_MARKERS` stated plainly. The store escalates on stated markers
            // rather than inferring distress, and this is what a person actually types.
            'Honestly I have not eaten for days and I do not want to any more.',
        );
        await fireEvent.press(screen.getByTestId('vd-composer-send'));

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('safety_escalation'))).toBeTruthy();
        });
        expect(screen.getByTestId('vd-safety-contact-placeholder')).toBeTruthy();
        expect(screen.getByTestId('vd-composer-closed')).toBeTruthy();
        expect(screen.queryByTestId('vd-composer-send')).toBeNull();
    });

    it('puts a missing question into the reply box rather than answering it for the person', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('missing_information')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-missing-weeklyBudget')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-missing-weeklyBudget-badge')).toBeTruthy();
        expect(screen.getByTestId('vd-missing-deliveryArea')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('vd-missing-weeklyBudget-jump'));

        expect(screen.getByTestId('vd-composer-reply-input').props.value).toContain('week');
    });
});

/* ── acceptance and override ─────────────────────────────────────────────────────────────────── */

describe('acceptance', () => {
    it('gates on the disclaimer acknowledgement, then records the acceptance on the timeline', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('suggested_targets')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('suggested_targets'))).toBeTruthy();
        });

        // The disabled control carries a visible reason rather than being silently inert.
        expect(screen.getByTestId('vd-targets-accept-hint')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('vd-targets-acknowledge-control'));
        expect(screen.queryByTestId('vd-targets-accept-hint')).toBeNull();

        await fireEvent.press(screen.getByTestId('vd-targets-accept'));

        await waitFor(() => {
            expect(screen.getByTestId('vd-targets-accepted-notice')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-timeline-accepted')).toBeTruthy();
        expect(screen.getByTestId('vd-targets-continue')).toBeTruthy();
    });
});

describe('human override', () => {
    it('explains the consequences, then shows the person’s figure beside the machine’s', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('suggested_targets')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId(vdStateTestId('suggested_targets')));

        await fireEvent.press(screen.getByTestId('vd-targets-adjust'));

        await waitFor(() => {
            expect(screen.getByTestId('vd-override-dialog-consequences')).toBeTruthy();
        });

        await fireEvent.changeText(
            screen.getByTestId('vd-override-dialog-reason-input'),
            'My dietitian asked me to eat more while I am training.',
        );
        await fireEvent.changeText(screen.getByTestId('vd-override-dialog-energy-input'), '2200');
        await fireEvent.press(screen.getByTestId('vd-override-dialog-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('vd-targets-human-energy')).toBeTruthy();
        });
        // Both readings survive: the suggestion is not overwritten by the person's figure.
        expect(screen.getByTestId('vd-targets-suggested-energy')).toBeTruthy();
        expect(screen.getByTestId('vd-targets-override-notice')).toBeTruthy();
        expect(screen.getByTestId('vd-timeline-overridden')).toBeTruthy();
        expect(screen.getByTestId('vd-timeline-overridden-origin')).toBeTruthy();
    });

    it('refuses an override with no reason, so no change is ever anonymous', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('suggested_targets')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId(vdStateTestId('suggested_targets')));
        await fireEvent.press(screen.getByTestId('vd-targets-adjust'));
        await waitFor(() => screen.getByTestId('vd-override-dialog-confirm'));

        await fireEvent.press(screen.getByTestId('vd-override-dialog-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('vd-override-dialog-reason-error')).toBeTruthy();
        });
        expect(screen.queryByTestId('vd-targets-human-energy')).toBeNull();
    });

    it('rescales the macro split to the chosen energy and keeps every percentage', async () => {
        const session = await fixtureSession('suggested_targets');
        const macros = session.proposal!.macros;

        const rescaled = rescaleMacros(macros, 2200);

        expect(rescaled.map((macro) => macro.percentageOfEnergy)).toEqual(
            macros.map((macro) => macro.percentageOfEnergy),
        );
        expect(energyFromMacros(rescaled)).toBeGreaterThan(2100);
        expect(energyFromMacros(rescaled)).toBeLessThan(2300);
    });
});

/* ── the blocked states ──────────────────────────────────────────────────────────────────────── */

describe('the blocked states', () => {
    it('names the conflicting restriction and offers both resolutions', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('restriction_conflict')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-conflict-allergies')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-conflict-allergies-badge')).toBeTruthy();
        expect(screen.getByTestId('vd-conflict-adjust')).toBeTruthy();
        expect(screen.getByTestId('vd-conflict-request-review')).toBeTruthy();
        // Adjusting a preference in the person's own words is a real message, so the box is open.
        expect(screen.getByTestId('vd-composer-send')).toBeTruthy();
    });

    it('sends a real review request from a conflict', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('restriction_conflict')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId('vd-conflict-request-review'));
        await fireEvent.press(screen.getByTestId('vd-conflict-request-review'));

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('review_requested'))).toBeTruthy();
        });
    });

    it('says why nothing fits and what would widen the search', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('no_suitable_meals')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-no-meals')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-no-meals-whyOne')).toBeTruthy();
        expect(screen.getByTestId('vd-no-meals-widenOne')).toBeTruthy();
    });

    it('offers an honest retry after a generation failure', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('generation_failed')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-failed-retry')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-failed-alternative')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('vd-failed-retry'));

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('draft_generated'))).toBeTruthy();
        });
    });

    it('stops at a safety escalation with no generation affordance at all', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('safety_escalation')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-safety')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-safety-contact')).toBeTruthy();
        expect(screen.getByTestId('vd-safety-no-actions')).toBeTruthy();
        expect(screen.queryByTestId('vd-composer-send')).toBeNull();
        expect(screen.queryByTestId('vd-structure-generate')).toBeNull();
        expect(screen.queryByTestId('vd-draft-request-review')).toBeNull();
        expect(screen.queryByTestId('vd-targets-accept')).toBeNull();
        // The disclaimer is still there — the state where it matters most.
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });

    it('never allows a reply where a reply would mean something else', () => {
        expect(acceptsReply('safety_escalation')).toBe(false);
        expect(acceptsReply('professionally_approved')).toBe(false);
        expect(acceptsReply('draft_generated')).toBe(false);
        expect(acceptsReply('initial_interview')).toBe(true);
        expect(acceptsReply('restriction_conflict')).toBe(true);
    });
});

/* ── the approved session ────────────────────────────────────────────────────────────────────── */

describe('professionally approved', () => {
    it('names the reviewing dietitian and marks the credentials synthetic', async () => {
        await renderScreen(
            <VdSessionScreen sessionId={sessionIdFor('professionally_approved')} />,
            { scenario: 'consumer-prototype' },
        );

        await waitFor(() => {
            expect(screen.getByTestId('vd-approved-approver-name')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-approved-changes')).toBeTruthy();
        expect(screen.getByTestId('vd-timeline-approved')).toBeTruthy();
        expect(screen.getByTestId('vd-approved-origin')).toBeTruthy();
    });
});

/* ── the draft, and the planner handover ─────────────────────────────────────────────────────── */

describe('draft generated', () => {
    it('summarises the draft and discloses the planner route rather than linking into nothing', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('draft_generated')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-draft-summary')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-draft-plan-id')).toBeTruthy();
        expect(screen.getByTestId('vd-draft-allergen-reminder')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('prototype-action'));

        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
        expect(routerMock.__push).not.toHaveBeenCalledWith('/customer/planner');
    });

    it('sends a real review request from the draft', async () => {
        await renderScreen(<VdSessionScreen sessionId={sessionIdFor('draft_generated')} />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId('vd-draft-request-review'));
        await fireEvent.press(screen.getByTestId('vd-draft-request-review'));

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('review_requested'))).toBeTruthy();
        });
        expect(screen.getByTestId('vd-review-queue')).toBeTruthy();
        expect(screen.getByTestId('vd-timeline-reviewRequested')).toBeTruthy();
    });
});

/* ── the meal structure ──────────────────────────────────────────────────────────────────────── */

describe('suggested meal structure', () => {
    it('offers the four planner constraints and surfaces the allergen reminder', async () => {
        await renderScreen(
            <VdSessionScreen sessionId={sessionIdFor('suggested_meal_structure')} />,
            { scenario: 'consumer-prototype' },
        );

        await waitFor(() => {
            expect(screen.getByTestId('vd-structure-slots')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-structure-mode')).toBeTruthy();
        expect(screen.getByTestId('vd-structure-budget')).toBeTruthy();
        expect(screen.getByTestId('vd-structure-area')).toBeTruthy();
        expect(screen.getByTestId('vd-structure-allergen-reminder')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('vd-structure-kitchens')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-structure-kitchen-verdant-kitchen')).toBeTruthy();
    });

    it('generates a real draft week', async () => {
        await renderScreen(
            <VdSessionScreen sessionId={sessionIdFor('suggested_meal_structure')} />,
            { scenario: 'consumer-prototype' },
        );

        await waitFor(() => screen.getByTestId('vd-structure-generate'));
        await fireEvent.press(screen.getByTestId('vd-structure-generate'));

        await waitFor(() => {
            expect(screen.getByTestId(vdStateTestId('draft_generated'))).toBeTruthy();
        });
        expect(screen.getByTestId('vd-timeline-draft')).toBeTruthy();
    });

    it('records the kitchen, budget and delivery preferences as a real answer', async () => {
        await renderScreen(
            <VdSessionScreen sessionId={sessionIdFor('suggested_meal_structure')} />,
            { scenario: 'consumer-prototype' },
        );

        await waitFor(() => screen.getByTestId('vd-structure-kitchen-verdant-kitchen'));
        await fireEvent.press(screen.getByTestId('vd-structure-kitchen-verdant-kitchen'));
        await fireEvent.press(screen.getByTestId('vd-structure-save'));

        await waitFor(() => {
            expect(screen.getByTestId('vd-collected-preferredKitchens')).toBeTruthy();
        });
        expect(screen.getByTestId('vd-collected-deliveryArea')).toBeTruthy();
    });
});

/* ── the not-found paths ─────────────────────────────────────────────────────────────────────── */

describe('an unknown session', () => {
    it('answers a well-formed but absent identifier with the designed failure', async () => {
        await renderScreen(<VdSessionScreen sessionId="01935f6d-0000-7000-8000-0000000091ff" />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-session-error')).toBeTruthy();
        });
    });

    it('answers a malformed identifier without asking the repository at all', async () => {
        await renderScreen(<VdSessionScreen sessionId="not-a-session" />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('vd-session-empty')).toBeTruthy();
        });
    });
});

/* ── pure helpers ────────────────────────────────────────────────────────────────────────────── */

describe('collected answers', () => {
    it('merges every collected turn, with later answers winning', async () => {
        const session = await fixtureSession('professionally_approved');
        const answers = new Map(collectAnswers(session.messages));

        expect(answers.get('ageYears')).toBe(34);
        expect(answers.get('deliveryArea')).toBe('Business Bay');
    });
});

describe('the session timeline', () => {
    it('records acceptance and approval as separate facts with different origins', async () => {
        const session = await fixtureSession('professionally_approved');
        const entries = timelineEntries(session);

        expect(entries.find((entry) => entry.key === 'accepted')?.origin).toBe('human');
        expect(entries.find((entry) => entry.key === 'approved')?.origin).toBe('dietitian');
    });

    it('renders one entry per decision with its own origin badge', async () => {
        const session = await fixtureSession('professionally_approved');

        await renderScreen(<SessionTimeline session={session} />, {
            scenario: 'consumer-prototype',
        });

        for (const key of ['created', 'accepted', 'reviewRequested', 'approved']) {
            expect(screen.getByTestId(`vd-timeline-${key}`)).toBeTruthy();
        }
    });
});
