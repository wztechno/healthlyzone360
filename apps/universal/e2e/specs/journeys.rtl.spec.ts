import { expect, test } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in +html.tsx reads this cookie before any styles apply,
    // so the document is RTL from the first paint - no LTR flash.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
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
        await signIn(page);
        await selectCedarHamraContext(page);

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('workspace-selector-title')).toContainText(ARABIC_SCRIPT);
        // Fixture names are Latin-script; the badge itself must still render inside RTL layout.
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
