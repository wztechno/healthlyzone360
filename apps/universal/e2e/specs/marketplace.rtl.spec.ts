import { expect, test } from '@playwright/test';

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in +html.tsx reads this cookie before any styles apply, so the
    // document is RTL from the first paint — no left-to-right flash on the marketplace either.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

test.describe('public marketplace (ar, RTL)', () => {
    test('the landing page renders right-to-left in Arabic from first load', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('landing-screen')).toBeVisible();

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('landing-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('marketplace-sign-in')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('footer-legal')).toContainText(ARABIC_SCRIPT);
        // The brand mark is a Latin word by design and must stay one inside an RTL document.
        await expect(page.getByTestId('brand-mark')).toContainText('Healthy360');
    });

    test('the kitchen directory and its filters are translated', async ({ page }) => {
        await page.goto('/kitchens');
        await expect(page.getByTestId('kitchens-screen')).toBeVisible();

        await expect(page.getByTestId('kitchens-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchens-filter-group-cuisine')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchens-grid')).toBeVisible();
        // Kitchen names are fixture data in Latin script; the card still has to lay out in RTL.
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toContainText(
            'Verdant Kitchen',
        );
    });

    test('the navigation drawer opens from the leading edge on a narrow viewport', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/kitchens');
        await expect(page.getByTestId('kitchens-screen')).toBeVisible();

        // Below `md` the marketplace navigation collapses into a drawer rather than wrapping.
        await page.getByTestId('marketplace-shell-menu').click();
        const drawer = page.getByTestId('marketplace-shell-drawer');
        await expect(drawer).toBeVisible();

        const geometry = await drawer.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: window.innerWidth };
        });

        // In Arabic the leading edge is the right-hand one, so the panel hugs the right.
        expect(geometry.right).toBeGreaterThan(geometry.width - 2);
        expect(geometry.left).toBeGreaterThan(0);
    });
});
