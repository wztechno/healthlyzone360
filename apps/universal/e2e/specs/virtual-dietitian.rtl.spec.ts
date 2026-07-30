import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The Virtual Dietitian in Arabic.
 *
 * The interesting assertion here is not that the strings are translated — it is that the chat lays
 * out correctly without a single mirrored style. Bubbles are aligned with `self-start` / `self-end`,
 * which resolve against the writing direction, so the geometry check below is a check that the
 * logical-utility policy actually holds at run time rather than only in the source.
 */

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in +html.tsx reads this cookie before any styles apply, so the
    // document is right-to-left from the first paint.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

test.describe('virtual dietitian (ar, RTL)', () => {
    test('the entry screen renders right-to-left in Arabic', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/virtual-dietitian');

        await expect(page.getByTestId('virtual-dietitian-screen')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('vd-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('vd-what-it-is-not')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('vd-ai-notice')).toContainText(ARABIC_SCRIPT);
    });

    test('a session is translated and its chat bubbles mirror without a physical style', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/virtual-dietitian');
        await expect(page.getByTestId('vd-sessions-list')).toBeVisible();

        // The approved session carries the full conversation: system, assistant, user and dietitian.
        await page.getByTestId('vd-session-professionally_approved').click();
        await expect(page.getByTestId('vd-session-screen')).toBeVisible();
        await expect(page.getByTestId('vd-state-professionally-approved')).toBeVisible();

        await expect(page.getByTestId('vd-state-badge')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('vd-state-announcer')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('medical-disclaimer').first()).toContainText(ARABIC_SCRIPT);

        const bubbles = page.locator('[data-testid^="vd-messages-"]');
        const userBubble = bubbles
            .filter({ has: page.locator('[data-testid$="-origin-human"]') })
            .first();
        const assistantBubble = bubbles
            .filter({ has: page.locator('[data-testid$="-origin-ai"]') })
            .first();

        await expect(userBubble).toBeVisible();
        await expect(assistantBubble).toBeVisible();

        const userBox = await userBubble.boundingBox();
        const assistantBox = await assistantBubble.boundingBox();
        expect(userBox).not.toBeNull();
        expect(assistantBox).not.toBeNull();

        // In Arabic the trailing edge is the left-hand one, so the person's own turns hug the left
        // and the assistant's hug the right. In English this comparison is the other way round.
        expect(userBox!.x).toBeLessThan(assistantBox!.x);
    });

    test('the stop state is fully translated in Arabic', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/virtual-dietitian');
        await expect(page.getByTestId('vd-sessions-list')).toBeVisible();

        await page.getByTestId('vd-session-safety_escalation').click();
        await expect(page.getByTestId('vd-state-safety-escalation')).toBeVisible();

        await expect(page.getByTestId('vd-safety-contact')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('vd-safety-contact-placeholder')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('vd-composer-closed')).toContainText(ARABIC_SCRIPT);
    });
});
