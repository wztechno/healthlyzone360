import type {
    ClosureBlocker,
    ClosureBlockerCode,
    ClosurePreconditions,
    ClosureTicket,
    OtpChallenge,
} from '@healthy360/api-client/contracts';
import {
    ApiError,
    CLOSURE_BLOCKER_CODES,
    otpInvalidFailure,
} from '@healthy360/api-client/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';

import { queryKeys } from '../../data/query-keys.ts';
import { withReturnTo } from '../../navigation/return-to.ts';
import { clearAllSessionDrafts } from '../../navigation/session-draft.ts';
import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { testMeResponse } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { AccountClosedScreen } from './screens/account-closed-screen.tsx';
import { ClosureWizardScreen } from './screens/closure-wizard-screen.tsx';
import type { ClosureStep } from './screens/closure-wizard-screen.tsx';

/**
 * J2 — the closure wizard, against the stub harness.
 *
 * This suite used to call `AccountMockStore` directly and assert the *fixture world's* derivation
 * of the blocker registry: cancel a subscription, re-read the preconditions, watch a `blocking`
 * check become an `advisory`. None of that was ever client behaviour — it was a second
 * implementation of the backend's registry, and it went with the mock world.
 *
 * What survives, and is what the client is actually answerable for: the wizard **renders all four
 * statuses without collapsing them**, it draws the checks in the order the server sent them, it
 * takes `canClose` as the verdict rather than recomputing it, the marketing scope short-circuits
 * without consulting a blocker or asking for a code, and the step-up challenge is read off the
 * ticket rather than fetched separately. Every one of those is asserted here against preconditions
 * this file authors, so a case that says "one thing is in the way" is reading a blocker written
 * eight lines above it.
 *
 * The `not_applicable` case is the one worth keeping honest: the assertion is that the neutral badge
 * is accompanied by the server's reason sentence, and that a `clear` check carries none. That is the
 * screen-side version of "a tick here would be a lie that becomes an expensive one the day PAY1
 * ships".
 */

/**
 * Navigation is real in this suite.
 *
 * The wizard moves between steps by pushing a route, so a test that mocked `push` into a black hole
 * could never assert what the *next* step says — and "the marketing opt-out completes and lands on a
 * screen that does not claim the account is closed" is exactly the claim worth making. So the shared
 * router mock *follows* every call (`follow: true`), and the wrapper below reads the step and the
 * `?scope=` back out of the mock's location, the way the route file reads them.
 *
 * ## Every step change remounts the wizard
 *
 * The wrapper keys the screen on the pathname. That is what the real `<Slot/>` does — each step is a
 * new route entry, so the screen underneath is a new instance — and it is the behaviour that used to
 * lose the reason between step one and step two. A suite whose wrapper kept one instance alive could
 * never see that bug, and did not.
 */
jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/customer/account/close/reason',
        follow: true,
    }),
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

function RoutedWizard() {
    const pathname = usePathname();
    const { scope } = useLocalSearchParams<{ scope?: string }>();
    const step = /^\/customer\/account\/close\/([^/]+)$/.exec(pathname)?.[1];
    return <ClosureWizardScreen key={pathname} step={step} scope={scope} />;
}

/**
 * The wizard opened on `start`, as a link to the step would open it. The location is set before
 * the element is rendered, so the first frame is already on `start`.
 */
function wizard(start: ClosureStep, params: Readonly<Record<string, string>> = {}) {
    routerMock.__set({ pathname: `/customer/account/close/${start}`, params });
    return <RoutedWizard />;
}

beforeEach(() => {
    routerMock.__reset();
    // The answers outlive the screen on purpose; they must not outlive the case.
    clearAllSessionDrafts();
});

/* ══ authored entities ═════════════════════════════════════════════════════════════════════════ */

function blocker(
    code: ClosureBlockerCode,
    overrides: Partial<ClosureBlocker> = {},
): ClosureBlocker {
    return { code, status: 'clear', count: 0, reason: null, resolveHref: null, ...overrides };
}

/** The seven checks, all clear — the base a case edits the one or two it is about. */
function allClear(): readonly ClosureBlocker[] {
    return CLOSURE_BLOCKER_CODES.map((code) => blocker(code));
}

function preconditions(overrides: Partial<ClosurePreconditions> = {}): ClosurePreconditions {
    return { canClose: true, blockers: allClear(), retainedRecordCodes: [], ...overrides };
}

function closureChallenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
    return {
        id: 'closure-challenge-1',
        purpose: 'closure_step_up',
        channel: 'email',
        maskedDestination: 't***@example.test',
        codeLength: 6,
        // Real time: the panel closes entry once the expiry has run out.
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendCooldownSeconds: 0,
        attemptsRemaining: 3,
        resendsRemaining: 2,
        availableChannels: ['email'],
        simulatedChannels: [],
        ...overrides,
    };
}

function ticket(overrides: Partial<ClosureTicket> = {}): ClosureTicket {
    return {
        id: 'closure-ticket-1',
        scope: 'full',
        status: 'requested',
        reasonCode: 'moving_away',
        blockers: [],
        blocked: false,
        verificationRequired: true,
        challenge: null,
        scheduledFor: null,
        completedAt: null,
        ...overrides,
    };
}

const TEST_CODE = '424242';

/**
 * Every rendered blocker card, in render order.
 *
 * The trailing `$` over a hyphen-free character class is what excludes the `-status`, `-reason` and
 * `-resolve` children — and the class has to admit digits, because `pending_b2b_signatures` is one
 * of the seven codes.
 */
function drawnBlockers(): readonly string[] {
    return screen
        .getAllByTestId(/^closure-blocker-[a-z0-9_]+$/)
        .map((node) => String(node.props.testID).replace('closure-blocker-', ''));
}

/**
 * Step one and two, as a person walks them: a reason is required before anything may be written.
 *
 * It waits for the checks to have *arrived* rather than for the step to have changed. The start
 * button is disabled until `canClose` says otherwise, and `canClose` defaults to false while the
 * query is in flight — so pressing on the first frame of step three is a press on a disabled
 * control, which fires nothing and fails a hundred milliseconds later somewhere else.
 */
async function walkToChecks(reason = 'privacy_concerns'): Promise<void> {
    await fireEvent.press(await screen.findByTestId('closure-reason-select-trigger'));
    await fireEvent.press(await screen.findByTestId(`closure-reason-select-option-${reason}`));
    await fireEvent.press(screen.getByTestId('closure-reason-next'));

    await fireEvent.press(await screen.findByTestId('closure-scope-full'));
    await fireEvent.press(screen.getByTestId('closure-scope-next'));
    await screen.findByTestId('closure-checks');
    await waitFor(() => {
        expect(drawnBlockers().length).toBeGreaterThan(0);
    });
}

/* ══ the checks step ═══════════════════════════════════════════════════════════════════════════ */

describe('the checks step keeps the four statuses apart', () => {
    it('draws a live subscription as blocking and refuses to start the closure', async () => {
        await renderStubScreen(wizard('checks'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () =>
                        preconditions({
                            canClose: false,
                            blockers: allClear().map((entry) =>
                                entry.code === 'active_subscriptions'
                                    ? blocker('active_subscriptions', {
                                          status: 'blocking',
                                          count: 1,
                                          reason: 'subscriptions_live',
                                          resolveHref: '/customer/account?section=subscriptions',
                                      })
                                    : entry,
                            ),
                        }),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        expect(
            await screen.findByTestId('closure-blocker-active_subscriptions-status'),
        ).toHaveTextContent(/In the way/);
        // The server's own reason string, translated with its count — one subscription, authored
        // above, and the sentence the screen prints says one.
        expect(screen.getByTestId('closure-blocker-active_subscriptions-reason')).toHaveTextContent(
            /1 subscription is still running/,
        );
        expect(screen.getByTestId('closure-blocked')).toHaveTextContent(/1 thing is in the way/);

        // `canClose` is the verdict, and the wizard takes it rather than recomputing one.
        expect(screen.getByTestId('closure-checks-next').props.accessibilityState.disabled).toBe(
            true,
        );

        // A blocker with somewhere to go offers the route the *client* owns — as a detour, with
        // the way back to these checks.
        await fireEvent.press(screen.getByTestId('closure-blocker-active_subscriptions-resolve'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            withReturnTo(
                '/customer/account?section=subscriptions',
                '/customer/account/close/checks',
            ),
        );
    });

    it('says a check did not run rather than printing a tick beside it', async () => {
        await renderStubScreen(wizard('checks'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () =>
                        preconditions({
                            blockers: [
                                blocker('open_orders'),
                                blocker('wallet_balance', {
                                    status: 'not_applicable',
                                    reason: 'no_wallet_module',
                                }),
                                blocker('payment_methods', {
                                    status: 'not_applicable',
                                    reason: 'no_payment_module',
                                }),
                            ],
                        }),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        expect(
            await screen.findByTestId('closure-blocker-wallet_balance-status'),
        ).toHaveTextContent(/Not checked/);
        expect(screen.getByTestId('closure-blocker-payment_methods-status')).toHaveTextContent(
            /Not checked/,
        );

        // The reason is what stops a neutral badge reading as a pass, so it is rendered — and a
        // check that genuinely ran and found nothing carries none.
        expect(screen.getByTestId('closure-blocker-wallet_balance-reason')).toHaveTextContent(
            /There is no wallet/,
        );
        expect(screen.getByTestId('closure-blocker-payment_methods-reason')).toHaveTextContent(
            /no saved payment methods/,
        );
        expect(screen.getByTestId('closure-blocker-open_orders-status')).toHaveTextContent(/Clear/);
        expect(screen.queryByTestId('closure-blocker-open_orders-reason')).toBeNull();
    });

    it('draws every check the server sent, in the order it sent them', async () => {
        // Deliberately not the registry's order: the wizard must not re-sort, group by status or
        // hide a check it has no opinion about.
        const sent: readonly ClosureBlockerCode[] = [
            'unsettled_credit_memos',
            'open_orders',
            'payment_methods',
            'active_subscriptions',
            'wallet_balance',
            'organisation_memberships',
            'pending_b2b_signatures',
        ];

        await renderStubScreen(wizard('checks'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () =>
                        preconditions({ blockers: sent.map((code) => blocker(code)) }),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        // The list container is mounted before the answer arrives, so waiting on it would read an
        // empty board.
        await waitFor(() => {
            expect(drawnBlockers()).toHaveLength(sent.length);
        });

        expect(drawnBlockers()).toEqual(sent);
        // And all seven checks are drawn — none is dropped for having nothing to say.
        expect([...drawnBlockers()].sort()).toEqual([...CLOSURE_BLOCKER_CODES].sort());
    });

    it('turns an unsettled credit memo into an advisory that never blocks', async () => {
        // Walked from the start: starting a closure needs the reason the first step records.
        await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () =>
                        preconditions({
                            canClose: true,
                            blockers: allClear().map((entry) =>
                                entry.code === 'unsettled_credit_memos'
                                    ? blocker('unsettled_credit_memos', {
                                          status: 'advisory',
                                          count: 1,
                                          reason: 'credit_memos_unsettled',
                                      })
                                    : entry,
                            ),
                        }),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        await walkToChecks();
        expect(
            await screen.findByTestId('closure-blocker-unsettled_credit_memos-status'),
        ).toHaveTextContent(/Worth knowing/);
        expect(
            screen.getByTestId('closure-blocker-unsettled_credit_memos-reason'),
        ).toHaveTextContent(/1 credit is recorded and not yet settled/);

        // Advisory never stops a closure — that is the entire distinction from `blocking` — so
        // there is no blocked callout, only an acknowledgement the screen itself owns.
        expect(screen.queryByTestId('closure-blocked')).toBeNull();
        expect(screen.getByTestId('closure-checks-next').props.accessibilityState.disabled).toBe(
            true,
        );

        await fireEvent.press(screen.getByTestId('closure-acknowledge-control'));
        await waitFor(() => {
            expect(
                screen.getByTestId('closure-checks-next').props.accessibilityState.disabled,
            ).toBe(false);
        });
    });

    it('names what survives the purge', async () => {
        await renderStubScreen(wizard('checks'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () =>
                        preconditions({
                            retainedRecordCodes: [
                                'orders_anonymised',
                                'contact_suppression',
                                'closure_tombstone',
                            ],
                        }),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        expect(await screen.findByTestId('closure-retained')).toBeTruthy();
        // Each code is stated in words, on the way in — not as a code, and not in a policy.
        expect(screen.getByTestId('closure-retained-orders_anonymised')).toHaveTextContent(
            /accounting/,
        );
        expect(screen.getByTestId('closure-retained-contact_suppression')).toHaveTextContent(
            /never contact me again/,
        );
        expect(screen.getByTestId('closure-retained-closure_tombstone')).toBeTruthy();
    });
});

/* ══ the marketing short-circuit ═══════════════════════════════════════════════════════════════ */

describe('the marketing short-circuit', () => {
    it('completes in one write, asks for no code, and is not stopped by a blocking check', async () => {
        const { repositories } = await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    // Deliberately the *blocked* world: a marketing opt-out must not be stopped by
                    // a live subscription, because nothing is being destroyed.
                    getClosurePreconditions: async () =>
                        preconditions({
                            canClose: false,
                            blockers: [
                                blocker('active_subscriptions', {
                                    status: 'blocking',
                                    count: 1,
                                    reason: 'subscriptions_live',
                                    resolveHref: '/customer/account?section=subscriptions',
                                }),
                            ],
                        }),
                    getLiveClosureRequest: async () => null,
                    requestClosure: async (request) =>
                        ticket({
                            scope: request.scope,
                            reasonCode: request.reasonCode,
                            status: 'completed',
                            verificationRequired: false,
                            challenge: null,
                            completedAt: '2026-08-11T09:00:00.000Z',
                        }),
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('closure-reason-select-trigger'));
        await fireEvent.press(
            await screen.findByTestId('closure-reason-select-option-no_longer_needed'),
        );
        await fireEvent.press(screen.getByTestId('closure-reason-next'));

        // `marketing_opt_out` is the default scope, and it is offered first on purpose.
        await fireEvent.press(await screen.findByTestId('closure-scope-next'));

        expect(await screen.findByTestId('closure-done')).toBeTruthy();
        expect(repositories.account.requestClosure).toHaveBeenCalledWith({
            reasonCode: 'no_longer_needed',
            scope: 'marketing_opt_out',
        });
        expect(repositories.account.requestClosure).toHaveBeenCalledTimes(1);
        // No step-up: nothing was destroyed, so there was nothing to prove.
        expect(repositories.account.verifyClosure).not.toHaveBeenCalled();

        // The finished scope is in the URL — the write that produced it belonged to the step before
        // — and the done step replaces it, so Back never offers to send it again.
        expect(routerMock.__replace).toHaveBeenCalledWith(
            '/customer/account/close/done?scope=marketing_opt_out',
        );

        // Finishing an opt-out goes back to the switches it came from, not to the home.
        await fireEvent.press(screen.getByTestId('closure-done-home'));
        expect(routerMock.__replace).toHaveBeenLastCalledWith(
            '/customer/account?section=notifications',
        );
    });

    it('keeps the reason across the step change, which remounts the screen', async () => {
        const { repositories } = await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                    requestClosure: async (request) =>
                        ticket({
                            scope: request.scope,
                            reasonCode: request.reasonCode,
                            status: 'completed',
                            verificationRequired: false,
                            completedAt: '2026-08-11T09:00:00.000Z',
                        }),
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('closure-reason-select-trigger'));
        await fireEvent.press(
            await screen.findByTestId('closure-reason-select-option-moving_away'),
        );
        await fireEvent.press(screen.getByTestId('closure-reason-next'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/close/scope');
        await screen.findByTestId('closure-scope');

        // The push already gave the scope step a new screen. Leave and come back to it as well — a
        // detour, or a refresh — so nothing of the first screen can be what remembers.
        await act(() => {
            routerMock.__set({ pathname: '/customer/account', params: {} });
        });
        await act(() => {
            routerMock.__set({ pathname: '/customer/account/close/scope' });
        });

        await fireEvent.press(await screen.findByTestId('closure-scope-next'));
        expect(await screen.findByTestId('closure-done')).toBeTruthy();
        expect(repositories.account.requestClosure).toHaveBeenCalledWith({
            reasonCode: 'moving_away',
            scope: 'marketing_opt_out',
        });
    });

    it('renders the done step from its URL alone', async () => {
        await renderStubScreen(wizard('done', { scope: 'marketing_opt_out' }), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        expect(await screen.findByTestId('closure-done-callout')).toHaveTextContent(
            /Marketing stopped/,
        );
    });

    it('starts over rather than claim an outcome when the done step names none', async () => {
        await renderStubScreen(wizard('done'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        expect(await screen.findByTestId('closure-reason')).toBeTruthy();
        expect(screen.queryByTestId('closure-done')).toBeNull();
    });
});

describe('the way out', () => {
    it('offers Keep my account on every step, which forgets the answers and goes back', async () => {
        await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('closure-reason-select-trigger'));
        await fireEvent.press(await screen.findByTestId('closure-reason-select-option-other'));
        await fireEvent.press(screen.getByTestId('closure-reason-next'));

        // Scope has both: the step before, and the way out.
        expect(await screen.findByTestId('closure-scope-back')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('closure-scope-keep'));
        expect(routerMock.__router.dismissTo).toHaveBeenCalledWith(
            '/customer/account?section=notifications',
        );

        // The reason went with it: opened again, the wizard starts blank.
        await act(() => {
            routerMock.__set({ pathname: '/customer/account/close/reason' });
        });
        expect(
            (await screen.findByTestId('closure-reason-next')).props.accessibilityState.disabled,
        ).toBe(true);
    });

    it('withdraws a request still in flight when the person keeps their account', async () => {
        const live = ticket({ challenge: closureChallenge() });
        const { repositories } = await renderStubScreen(wizard('verify'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => live,
                    cancelClosure: async ({ ticketId }) =>
                        ticket({ id: ticketId, status: 'cancelled' }),
                },
            },
        });

        await screen.findByTestId('closure-otp');
        await fireEvent.press(screen.getByTestId('closure-verify-keep'));

        await waitFor(() => {
            expect(routerMock.__router.dismissTo).toHaveBeenCalledWith(
                '/customer/account?section=notifications',
            );
        });
        expect(repositories.account.cancelClosure).toHaveBeenCalledWith({ ticketId: live.id });
    });

    it('steps back by replacing when the previous step is not underneath', async () => {
        await renderStubScreen(wizard('checks'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        // Opened directly — nothing to pop to.
        await fireEvent.press(await screen.findByTestId('closure-checks-back'));
        expect(routerMock.__replace).toHaveBeenCalledWith('/customer/account/close/scope');
        expect(routerMock.__router.back).not.toHaveBeenCalled();
    });
});

describe('the marketing short-circuit, in words', () => {
    it('says the account is untouched rather than closed, and carries the note that was typed', async () => {
        const { repositories } = await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                    requestClosure: async (request) =>
                        ticket({
                            scope: request.scope,
                            reasonCode: request.reasonCode,
                            status: 'completed',
                            verificationRequired: false,
                            completedAt: '2026-08-11T09:00:00.000Z',
                        }),
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('closure-reason-select-trigger'));
        await fireEvent.press(await screen.findByTestId('closure-reason-select-option-other'));
        // Only `other` invites free text — the backend's own rule, mirrored.
        await fireEvent.changeText(
            await screen.findByTestId('closure-reason-note'),
            'Trying something else.',
        );
        await fireEvent.press(screen.getByTestId('closure-reason-next'));
        await fireEvent.press(await screen.findByTestId('closure-scope-next'));

        expect(await screen.findByTestId('closure-done-callout')).toHaveTextContent(
            /Marketing stopped/,
        );
        expect(screen.getByTestId('closure-done-callout')).toHaveTextContent(
            /account and everything in it is untouched/,
        );
        // An opt-out signs nobody out, so the note that says so must not appear.
        expect(screen.queryByTestId('closure-signed-out')).toBeNull();

        expect(repositories.account.requestClosure).toHaveBeenCalledWith({
            reasonCode: 'other',
            scope: 'marketing_opt_out',
            reasonNote: 'Trying something else.',
        });
    });
});

/* ══ a full closure ════════════════════════════════════════════════════════════════════════════ */

describe('a full closure', () => {
    it('comes back to the checks with a fresh verdict when the server refuses to start', async () => {
        // The race the registry exists to catch: nothing was in the way when the checks were drawn,
        // and something is by the time the request lands.
        let world = preconditions();

        const { repositories } = await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => world,
                    getLiveClosureRequest: async () => null,
                    requestClosure: async () => {
                        world = preconditions({
                            canClose: false,
                            blockers: allClear().map((entry) =>
                                entry.code === 'open_orders'
                                    ? blocker('open_orders', {
                                          status: 'blocking',
                                          count: 2,
                                          reason: 'orders_in_flight',
                                          resolveHref: '/customer/account?section=orders',
                                      })
                                    : entry,
                            ),
                        });
                        return ticket({
                            blocked: true,
                            verificationRequired: false,
                            challenge: null,
                            blockers: world.blockers,
                        });
                    },
                },
            },
        });

        await walkToChecks();
        await fireEvent.press(screen.getByTestId('closure-checks-next'));

        // A refusal to start is the answer, not an error — so no error callout, and no code.
        expect(await screen.findByTestId('closure-blocked')).toHaveTextContent(
            /1 thing is in the way/,
        );
        expect(screen.queryByTestId('closure-verify')).toBeNull();
        expect(screen.queryByTestId('closure-error')).toBeNull();
        expect(repositories.account.verifyClosure).not.toHaveBeenCalled();

        // And the wizard is showing the *re-read* verdict, not the one it walked in with: one
        // check in the way, over the two undelivered orders it counted.
        expect(screen.getByTestId('closure-blocker-open_orders-status')).toHaveTextContent(
            /In the way/,
        );
        expect(screen.getByTestId('closure-blocker-open_orders-reason')).toHaveTextContent(
            /2 orders have not been delivered yet/,
        );
        await waitFor(() => {
            expect(
                screen.getByTestId('closure-checks-next').props.accessibilityState.disabled,
            ).toBe(true);
        });
    });

    it('draws the step-up challenge that arrived with the ticket, fetching none of its own', async () => {
        const challenge = closureChallenge();
        // The request the server holds once one is made — what the verify step, a new screen
        // after the push, reads back.
        let inFlight: ClosureTicket | null = null;

        const { repositories } = await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => inFlight,
                    requestClosure: async (request) => {
                        inFlight = ticket({
                            reasonCode: request.reasonCode,
                            scope: request.scope,
                            verificationRequired: true,
                            challenge,
                        });
                        return inFlight;
                    },
                },
                // `verification` is left entirely unstubbed on purpose: any attempt to issue or
                // re-read a challenge would reject with StubNotConfiguredError and fail this test.
            },
        });

        await walkToChecks('moving_away');
        await fireEvent.press(screen.getByTestId('closure-checks-next'));

        expect(await screen.findByTestId('closure-otp')).toBeTruthy();
        expect(screen.getByTestId('closure-otp-destination')).toHaveTextContent(
            /t\*\*\*@example\.test/,
        );
        expect(screen.queryByTestId('closure-no-challenge')).toBeNull();
        expect(repositories.account.requestClosure).toHaveBeenCalledWith({
            reasonCode: 'moving_away',
            scope: 'full',
        });
    });

    it('says so rather than drawing a dead panel when the verify step has no challenge', async () => {
        await renderStubScreen(wizard('verify'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                },
            },
        });

        expect(await screen.findByTestId('closure-no-challenge')).toHaveTextContent(
            /No code has been sent yet/,
        );
        expect(screen.queryByTestId('closure-otp')).toBeNull();
        // The point of no return is stated whether or not there is a code to enter.
        expect(screen.getByTestId('closure-irreversible')).toHaveTextContent(/point of no return/);
    });

    it('closes the account against the ticket the code belongs to, and leaves for the public page first', async () => {
        const live = ticket({ challenge: closureChallenge() });

        const { repositories, queryClient } = await renderStubScreen(wizard('verify'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    // The documented resume path: a reload lands back on the step it left, with the
                    // challenge intact rather than reissued.
                    getLiveClosureRequest: async () => live,
                    verifyClosure: async ({ ticketId }) =>
                        ticket({
                            id: ticketId,
                            status: 'completed',
                            verificationRequired: false,
                            challenge: null,
                            completedAt: '2026-08-11T09:05:00.000Z',
                        }),
                },
            },
        });

        await fireEvent.changeText(await screen.findByTestId('closure-otp-code-input'), TEST_CODE);
        const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
        await fireEvent.press(screen.getByTestId('closure-otp-submit'));

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith('/account-closed');
        });
        // Request-bound: the code proves this person asked for *this* closure.
        expect(repositories.account.verifyClosure).toHaveBeenCalledWith({
            ticketId: live.id,
            code: TEST_CODE,
        });

        // The session query hears about it only once the wizard has left the customer area — told
        // first, the gate would have answered the done step with the sign-in page.
        const meCalls = invalidate.mock.calls
            .map((call, index) => ({ call, order: invalidate.mock.invocationCallOrder[index]! }))
            .filter(
                ({ call }) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(queryKeys.me()),
            );
        expect(meCalls).toHaveLength(1);
        expect(meCalls[0]!.order).toBeGreaterThan(
            routerMock.__replace.mock.invocationCallOrder[0]!,
        );
    });

    it('says the account is closed and the session is gone, on a page that needs neither', async () => {
        await renderStubScreen(<AccountClosedScreen />);

        expect(await screen.findByTestId('account-closed-title')).toHaveTextContent(
            /Your account is closed/,
        );
        // Closing and signing out are one event, and the page says the second half out loud.
        expect(screen.getByTestId('account-closed-signed-out')).toHaveTextContent(/signed out/);
        await fireEvent.press(screen.getByTestId('account-closed-home'));
        expect(routerMock.__replace).toHaveBeenCalledWith('/discover');
    });

    it('refuses a wrong code without closing anything', async () => {
        const live = ticket({ challenge: closureChallenge() });

        await renderStubScreen(wizard('verify'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => live,
                    // Two attempts left *after* this rejection — the server's number, not a local
                    // decrement.
                    verifyClosure: async () => {
                        throw new ApiError(otpInvalidFailure(2));
                    },
                },
            },
        });

        await fireEvent.changeText(await screen.findByTestId('closure-otp-code-input'), '000000');
        await fireEvent.press(screen.getByTestId('closure-otp-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('closure-otp-alert')).toHaveTextContent(/not right/i);
        });
        // Still on the verify step, and the panel reports the server's remaining attempts.
        expect(screen.getByTestId('closure-verify')).toBeTruthy();
        expect(screen.queryByTestId('closure-done')).toBeNull();
        expect(screen.getByTestId('closure-otp-status')).toHaveTextContent(/2 attempts left/);
    });

    it('reports a second request refused while one is already in flight', async () => {
        await renderStubScreen(wizard('reason'), {
            session: testMeResponse(),
            repositories: {
                account: {
                    getClosurePreconditions: async () => preconditions(),
                    getLiveClosureRequest: async () => null,
                    requestClosure: async () => {
                        throw new ApiError({
                            code: 'closure.refused',
                            reason: 'closure_already_in_flight',
                            message: 'A closure request is already in flight.',
                            correlationId: null,
                            retryable: false,
                        });
                    },
                },
            },
        });

        await walkToChecks('duplicate_account');
        await fireEvent.press(screen.getByTestId('closure-checks-next'));

        // A refusal of the *request* is an error, unlike a `blocked` acknowledgement — and the
        // server's own sentence is what the wizard shows.
        expect(await screen.findByTestId('closure-error')).toHaveTextContent(/That did not work/);
        expect(screen.getByTestId('closure-error')).toHaveTextContent(/already in flight/);
        expect(screen.queryByTestId('closure-verify')).toBeNull();
    });
});
