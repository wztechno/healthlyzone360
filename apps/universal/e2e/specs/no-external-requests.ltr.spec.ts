import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The prototype reaches nothing but itself.
 *
 * Four separate promises in the prompt collapse into one testable property: no copied remote assets,
 * no calls to unauthorised reference endpoints, no telemetry, no exposed secrets in a query string.
 * All four are violated the same way — a request leaves the exported build for a host that is not
 * the static server — so all four are checked the same way, by intercepting **every** request the
 * page makes and refusing to let an off-origin one through.
 *
 * ## Why interception rather than observation
 *
 * `page.on('request')` would report the leak after it happened. `page.route('**\/*')` can *stop* it:
 * anything not addressed to the static server is aborted and recorded. That matters for two reasons.
 * A Google Fonts stylesheet that is quietly fetched during a normal run would still be fetched
 * during this test, which is the exact behaviour under test. And aborting proves the second half of
 * the claim — that the build does not merely avoid *depending* on an external host, it renders
 * completely without one.
 *
 * ## What counts as external
 *
 * Anything whose origin is not the static server. `data:` and `blob:` are not network requests and
 * are allowed; `about:blank` is the browser, not the application.
 *
 * The two reference products are named explicitly rather than left to the general rule. They are the
 * hosts the research phase studied, and a fixture or a placeholder image accidentally carrying one
 * of their URLs is the specific accident this project is most exposed to — so it gets its own
 * assertion with its own failure message rather than appearing as one line in a list of origins.
 */

/** The static server the export is served from. */
const ORIGIN = 'http://localhost:4173';

/**
 * Hosts that must never be contacted, named for the record.
 *
 * The reference products, the font and analytics CDNs a React or Expo template most often smuggles
 * in, and the map/telemetry endpoints that arrive with a dependency rather than with a decision.
 */
const FORBIDDEN_HOSTS = [
    'rightbite.com',
    'eatthismuch.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'google-analytics.com',
    'googletagmanager.com',
    'sentry.io',
    'expo.dev',
    'unpkg.com',
    'cdn.jsdelivr.net',
];

/** Schemes that never leave the browser. */
const LOCAL_SCHEMES = ['data:', 'blob:', 'about:', 'javascript:'];

function isExternal(url: string): boolean {
    if (LOCAL_SCHEMES.some((scheme) => url.startsWith(scheme))) return false;
    return !url.startsWith(ORIGIN);
}

/**
 * Installs the collector. Returns the list it fills, which is read after the walk rather than
 * during it — a request can be issued long after the navigation that caused it settled.
 */
async function collectRequests(page: Page): Promise<string[]> {
    const external: string[] = [];

    await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (isExternal(url)) {
            external.push(`${route.request().resourceType()} ${url}`);
            // Refused rather than allowed through: the walk that follows therefore also proves the
            // application renders with no external host reachable at all.
            await route.abort('blockedbyclient');
            return;
        }
        await route.continue();
    });

    return external;
}

function assertNoExternal(external: readonly string[], where: string) {
    for (const host of FORBIDDEN_HOSTS) {
        const hits = external.filter((entry) => entry.includes(host));
        expect(hits, `${where}: contacted ${host} — ${hits.join(', ')}`).toEqual([]);
    }

    expect(external, `${where}: ${String(external.length)} off-origin request(s).`).toEqual([]);
}

/**
 * Every `src`/`href` in the document points at this origin or at nothing at all.
 *
 * The collector cannot see a URL that was never fetched — an `<img>` below the fold, a stylesheet
 * `url()` behind a media query, an anchor to a reference product in body copy. Reading the markup
 * catches the reference before the browser gets round to it.
 */
async function assertNoExternalReferences(page: Page, where: string) {
    const references = await page.evaluate((localSchemes) => {
        const found: string[] = [];
        for (const element of document.querySelectorAll('[src], [href], [srcset]')) {
            for (const attribute of ['src', 'href', 'srcset']) {
                const value = element.getAttribute(attribute);
                if (value === null || value === '') continue;
                if (value.startsWith('#') || value.startsWith('/') || value.startsWith('.')) {
                    continue;
                }
                if (localSchemes.some((scheme) => value.startsWith(scheme))) continue;
                if (value.startsWith(window.location.origin)) continue;
                // A bare relative path — `assets/foo.png`, `discover` — has no scheme and no host.
                if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
                found.push(`${element.tagName.toLowerCase()}[${attribute}]=${value}`);
            }
        }
        return found;
    }, LOCAL_SCHEMES);

    expect(references, `${where}: off-origin reference in the markup.`).toEqual([]);
}

async function walk(page: Page, paths: readonly (readonly [string, string])[]) {
    for (const [path, marker] of paths) {
        await page.goto(path);
        await expect(page.getByTestId(marker), `${path} did not render`).toBeVisible();
        await assertNoExternalReferences(page, path);
    }
}

const PUBLIC_WALK: readonly (readonly [string, string])[] = [
    ['/', 'landing-screen'],
    ['/discover', 'discover-screen'],
    ['/kitchens', 'kitchens-grid'],
    ['/meals', 'meals-grid'],
    ['/plans', 'plans-screen'],
    ['/how-it-works', 'how-it-works-screen'],
    ['/for-business', 'for-business-screen'],
];

const CUSTOMER_WALK: readonly (readonly [string, string])[] = [
    ['/customer', 'consumer-home-screen'],
    ['/customer/cart', 'cart-screen'],
    ['/customer/subscriptions', 'subscriptions-screen'],
];

test.describe('the exported build contacts nothing but the static server', () => {
    test('the public marketplace', async ({ page }) => {
        const external = await collectRequests(page);

        await walk(page, PUBLIC_WALK);

        assertNoExternal(external, 'public marketplace walk');
    });

    test('the customer and commerce areas', async ({ page }) => {
        const external = await collectRequests(page);

        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await walk(page, CUSTOMER_WALK);

        assertNoExternal(external, 'customer walk');
    });

    test('the reference products are never contacted, by name', async ({ page }) => {
        const external = await collectRequests(page);

        // The two hosts the research phase studied. Nothing in the product may reach them — not a
        // meal image, not a nutrition source, not a link in body copy — and this is the assertion
        // that says so out loud rather than by implication.
        await walk(page, [
            ['/', 'landing-screen'],
            ['/how-it-works', 'how-it-works-screen'],
            ['/meals', 'meals-grid'],
        ]);

        for (const host of ['rightbite.com', 'eatthismuch.com']) {
            expect(
                external.filter((entry) => entry.includes(host)),
                `a request was made to the reference product ${host}.`,
            ).toEqual([]);
        }

        const inMarkup = await page.evaluate(() => document.documentElement.outerHTML);
        expect(inMarkup).not.toContain('rightbite.com');
        expect(inMarkup).not.toContain('eatthismuch.com');
    });
});
