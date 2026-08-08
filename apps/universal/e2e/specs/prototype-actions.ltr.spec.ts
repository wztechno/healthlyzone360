import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * Every control that admits it cannot do the thing yet.
 *
 * The prompt forbids dead buttons. The application's answer is `usePrototypeAction()` — see
 * `src/prototype/prototype-action.ts` — which shows an information toast reading "Not built yet —
 * nothing was changed" and, in a development build, the proposed endpoint. Controls built with
 * `PrototypeButton` carry the fixed test id `prototype-action` so that one sweep can press all of
 * them; controls that are not button-shaped do not, and are named individually below.
 *
 * This is that sweep, and it checks the two halves of the promise:
 *
 * 1. the notice appears and says nothing was changed;
 * 2. **nothing was changed** — the route is the same and the screen behind the toast is byte-for-byte
 *    the text it was before the press. A control that navigates, or that quietly mutates the store
 *    while apologising for not being able to, is worse than a dead one.
 *
 * ## The pinned list
 *
 * Enumerated from the source tree (`rg 'PrototypeButton|usePrototypeAction' apps/universal/src`) and
 * written down here rather than discovered at runtime, because a crawl that finds no controls passes
 * just as happily as one that finds them all. The surfaces, and where their controls come from:
 *
 * | surface                              | source                                                  | shared id | named |
 * | ------------------------------------ | ------------------------------------------------------- | --------- | ----- |
 * | `/customer` consumer home            | `features/marketplace/screens/consumer-home-screen`      | 2 (+1)    | —     |
 * | `/dietitians/{dietitian}`            | `features/marketplace/screens/dietitian-profile-screen`  | 1         | —     |
 * | `/customer/grocery/{week}`           | `features/planner/screens/grocery-list-screen`           | 1         | —     |
 * | `/customer/planner/week/{week}` menu | `features/planner/screens/planner-week-screen`           | 0         | 2     |
 * | Virtual Dietitian, draft generated   | `features/virtual-dietitian/state-panels`                | 1         | —     |
 *
 * Five controls always carry `prototype-action`, and a sixth — the consumer home's "open the
 * planner" — only while the today card has entries to plan against (`conditionalControls`). Two
 * more, the planner week's share and export, are `ActionSheet` rows and carry their own ids. Seven
 * or eight in total depending on that one state, and every one of them is pressed below.
 *
 * Both shells (`shell/consumer-shell.tsx`, `shell/marketplace-shell.tsx`) also call
 * `usePrototypeAction()`, for navigation destinations whose `status` is `planned`. Every descriptor
 * in `navigation/consumer-items.ts` is `available` today, so those paths contribute nothing — which
 * {@link test} "no navigation destination is a prototype control any more" asserts, so that a
 * regression that re-marks a built destination as planned is caught rather than silently reducing
 * the count below.
 *
 * The counts are exact on purpose. Adding a prototype control without a line in this table is a
 * failure, which is the only reliable way to keep an inventory honest.
 */

/** Monday of the fixture planner week. Pinned in `mock/prototype/constants.ts`. */
const FIXTURE_WEEK = '2026-07-27';

/** Present in all three phrasings of the notice: the standard one and the two overrides. */
const NOTHING_CHANGED = /othing was changed/;

interface PrototypeSurface {
    readonly key: string;
    /** Whether the surface sits behind the customer gate. */
    readonly session: boolean;
    readonly open: (page: Page) => Promise<void>;
    /** Opens the menu or panel the controls live in, where they are not on the page itself. */
    readonly reveal?: ((page: Page) => Promise<void>) | undefined;
    /** The test id that proves the press left us where we were. */
    readonly marker: string;
    /**
     * Test ids that only exist once the screen's data has arrived.
     *
     * Needed because the "nothing changed" assertion compares the marker's text before and after
     * the press, and a screen caught mid-skeleton would change on its own while the toast was still
     * being read — reporting a mutation that never happened. Waiting for the settled markers first
     * makes the comparison a claim about the *press* rather than about the loading state.
     */
    readonly settled: readonly string[];
    /** How many `prototype-action` controls this surface always offers. */
    readonly controls: number;
    /**
     * Controls that exist only in one of a screen's states, with the marker that state renders.
     *
     * Kept out of {@link controls} rather than folded into it, because a count that quietly covers
     * two different screens is not an inventory. Each entry names the test id that proves the state
     * is on screen, so the expected total is still derived from a written-down rule.
     */
    readonly conditionalControls?:
        | readonly { readonly whenVisible: string; readonly controls: number }[]
        | undefined;
    /**
     * Controls that call `usePrototypeAction()` **without** carrying the shared test id, named one
     * by one.
     *
     * `PROTOTYPE_ACTION_TEST_ID` is applied by the `PrototypeButton` component, so it reaches every
     * control shaped like a button — and none shaped like anything else. The planner week's share
     * and export are rows in an `ActionSheet`, which carries the caller's own test id, so a sweep
     * that looked only for `prototype-action` would walk straight past two genuine prototype
     * controls and report a clean bill of health. They are listed here instead. (The gap in the
     * component's own promise is a finding, not something this file papers over.)
     */
    readonly namedControls?: readonly string[] | undefined;
}

const SURFACES: readonly PrototypeSurface[] = [
    {
        key: 'consumer home',
        session: true,
        open: async (page) => {
            await page.goto('/customer');
        },
        marker: 'consumer-home-screen',
        settled: ['nutrition-snapshot-content', 'subscription-card-content'],
        // Why this target, and manage the subscription. Two more are conditional: "start
        // onboarding" renders only for a person with no nutrition target, and the default mock
        // world has one; "open the planner" lives inside the today card, which shows its designed
        // empty state whenever the wall clock has left the pinned fixture week — the same
        // either-answer-is-correct state `marketplace.ltr.spec.ts` already allows for.
        controls: 2,
        conditionalControls: [{ whenVisible: 'today-card-content', controls: 1 }],
    },
    {
        key: 'dietitian profile',
        session: false,
        open: async (page) => {
            await page.goto('/dietitians');
            await expect(page.getByTestId('dietitians-grid')).toBeVisible();
            await page.locator('[data-testid^="dietitian-card-"]').first().click();
        },
        marker: 'dietitian-profile-screen',
        settled: ['dietitian-synthetic-note'],
        controls: 1,
    },
    {
        key: 'grocery list',
        session: true,
        open: async (page) => {
            await page.goto(`/customer/grocery/${FIXTURE_WEEK}`);
        },
        marker: 'grocery-screen',
        settled: ['grocery-total-value', 'grocery-pantry'],
        controls: 1,
    },
    {
        key: 'planner week actions',
        session: true,
        open: async (page) => {
            await page.goto(`/customer/planner/week/${FIXTURE_WEEK}`);
            await expect(page.getByTestId('planner-week-screen')).toBeVisible();
        },
        reveal: async (page) => {
            await page.getByTestId('planner-week-menu').click();
            await expect(page.getByTestId('planner-week-actions')).toBeVisible();
        },
        marker: 'planner-week-screen',
        settled: ['planner-week-summary', 'planner-week-grid'],
        // Share and export are `ActionSheet` rows, so they carry their own test ids rather than
        // the shared one. Both are genuinely absent capabilities rather than unbuilt screens.
        controls: 0,
        namedControls: ['planner-week-action-share', 'planner-week-action-export'],
    },
    {
        key: 'virtual dietitian draft',
        session: true,
        open: async (page) => {
            await page.goto('/customer/virtual-dietitian');
            await expect(page.getByTestId('virtual-dietitian-screen')).toBeVisible();
            await page.getByTestId('vd-session-draft_generated').click();
            await expect(page.getByTestId('vd-draft-summary')).toBeVisible();
        },
        marker: 'vd-draft-summary',
        settled: ['vd-draft-summary'],
        controls: 1,
    },
];

/** Dismisses the toast so the next press is measuring its own notice, not the previous one. */
async function dismissNotice(page: Page) {
    const dismiss = page.getByTestId('prototype-notice-dismiss');
    if ((await dismiss.count()) > 0) await dismiss.first().click();
    await expect(page.getByTestId('prototype-notice')).toHaveCount(0);
}

test.describe('prototype controls answer honestly and change nothing', () => {
    for (const surface of SURFACES) {
        test(surface.key, async ({ page }) => {
            if (surface.session) {
                await signIn(page);
                await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
            }

            await surface.open(page);
            await expect(page.getByTestId(surface.marker)).toBeVisible();
            for (const testId of surface.settled) {
                await expect(page.getByTestId(testId)).toBeVisible();
            }

            let expected = surface.controls;
            for (const conditional of surface.conditionalControls ?? []) {
                if (await page.getByTestId(conditional.whenVisible).isVisible()) {
                    expected += conditional.controls;
                }
            }

            const shared = page.getByTestId('prototype-action');
            await expect(
                shared,
                `${surface.key}: expected ${String(expected)} shared-id prototype controls.`,
            ).toHaveCount(expected);

            /** Each press, described by how the control is found. */
            const presses: readonly (() => Promise<void>)[] = [
                ...Array.from({ length: expected }, (_unused, index) => async () => {
                    await shared.nth(index).click();
                }),
                ...(surface.namedControls ?? []).map((testId) => async () => {
                    await page.getByTestId(testId).click();
                }),
            ];

            expect(presses.length, `${surface.key}: nothing to press.`).toBeGreaterThan(0);

            for (const [index, press] of presses.entries()) {
                // A menu closes when a control inside it is pressed, so it is reopened per press
                // rather than once per surface.
                if (surface.reveal !== undefined) await surface.reveal(page);

                const urlBefore = page.url();
                const textBefore = await page.getByTestId(surface.marker).innerText();

                await press();

                const notice = page.getByTestId('prototype-notice');
                await expect(notice).toBeVisible();
                await expect(notice).toContainText(NOTHING_CHANGED);

                // Nothing moved: same route, same screen, same words on it.
                expect(page.url(), `${surface.key}: control ${String(index)} navigated.`).toBe(
                    urlBefore,
                );
                await expect(page.getByTestId(surface.marker)).toBeVisible();
                expect(
                    await page.getByTestId(surface.marker).innerText(),
                    `${surface.key}: control ${String(index)} changed the screen.`,
                ).toBe(textBefore);

                await dismissNotice(page);
            }
        });
    }

    test('no navigation destination is a prototype control any more', async ({ page }) => {
        // Both shells answer a `planned` destination with the same notice. Every destination is
        // built, so pressing one has to navigate — and the marketplace and consumer tables are
        // checked separately because they are two tables.
        await page.goto('/');
        await expect(page.getByTestId('landing-screen')).toBeVisible();
        await page.getByTestId('marketplace-nav-plans').click();
        await expect(page.getByTestId('plans-screen')).toBeVisible();
        await expect(page.getByTestId('prototype-notice')).toHaveCount(0);

        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();

        await page.getByTestId('consumer-nav-nutrition').click();
        await expect(page.getByTestId('nutrition-target-screen')).toBeVisible();
        await expect(page.getByTestId('prototype-notice')).toHaveCount(0);
    });
});
