import { expect, test } from '@playwright/test';

import {
    APP_URL,
    CEDAR_DIETITIAN,
    probeStack,
    selectCedarContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(async ({ context }) => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 90 s default is a budget for one. `test.slow()`
    // triples it for the journeys that really do pay that cost, rather than raising the ceiling
    // for every test that reads a single endpoint.
    test.slow();
    skipUnlessStackIsUp(stack);
    // The pre-hydration script in +html.tsx reads this cookie before any styles apply,
    // so the document is RTL from the first paint - no LTR flash.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: APP_URL }]);
});

test.describe('authentication and context journey (ar, RTL)', () => {
    test('renders right-to-left with Arabic copy from first load', async ({ page }) => {
        await page.goto('/sign-in');
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(page.getByTestId('sign-in-title')).toContainText(ARABIC_SCRIPT);
    });

    test('completes the full journey in Arabic', async ({ page }) => {
        await signIn(page, CEDAR_DIETITIAN);
        await selectCedarContext(page);

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('workspace-selector-title')).toContainText(ARABIC_SCRIPT);
        // Organisation names are tenant data in Latin script; the badge itself must still render
        // inside the right-to-left layout.
        await expect(page.getByTestId('workspace-organisation')).toContainText('Cedar Clinic');
    });

    test('ships logical CSS properties, not physical direction rules', async ({ page }) => {
        await page.goto('/sign-in');
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();

        const cssHref = await page.evaluate(() => {
            const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
            return link?.href ?? null;
        });
        expect(cssHref).not.toBeNull();

        const css = await (await page.request.get(cssHref as string)).text();
        // Direction-sensitive layout compiles to CSS logical properties (inset/border-inline,
        // text-align start/end). Symmetric paddings (px-*) legitimately stay physical.
        expect(css).toMatch(/(margin|padding|inset|border)-inline-(start|end)|text-align:start/);
    });
});
