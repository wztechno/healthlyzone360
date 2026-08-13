import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    API_URL,
    APP_URL,
    CONSUMER_EMAIL,
    probeStack,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The exported build reaches its own two origins and nothing else.
 *
 * Four separate promises in the prompt collapse into one testable property: no copied remote assets,
 * no calls to unauthorised reference endpoints, no telemetry, no exposed secrets in a query string.
 * All four are violated the same way — a request leaves the exported build for a host that is
 * neither the static server nor the Healthy360 API — so all four are checked the same way, by
 * intercepting **every** request the page makes and refusing to let a third-party one through.
 *
 * ## What changed when the mock artefact died, and what did not
 *
 * This sweep used to be able to say "nothing leaves the origin at all", because the mock build
 * genuinely spoke to nobody. The shipped build reads a real API, so that sentence is no longer
 * true and pretending otherwise would mean either deleting the test or weakening it into a
 * tautology. Neither is necessary: the claim was never "no network" but **"no third party"**, and
 * that claim survives verbatim. Two origins are allowed — the static server the export is served
 * from and the API it was built against — and *every other host is still aborted and reported*,
 * including the named reference products, the font and analytics CDNs and the telemetry endpoints.
 *
 * The allow-list is derived from the same environment the artefact was built with rather than
 * written out, so a build pointed at a different API cannot make this test quietly allow a host the
 * application is not actually supposed to reach.
 *
 * ## Why interception rather than observation
 *
 * `page.on('request')` would report the leak after it happened. `page.route('**\/*')` can *stop* it:
 * anything addressed elsewhere is aborted and recorded. That matters for two reasons. A Google Fonts
 * stylesheet quietly fetched during a normal run would still be fetched during this test, which is
 * the exact behaviour under test. And aborting proves the second half of the claim — that the build
 * does not merely avoid *depending* on a third party, it renders completely without one.
 */

/** The two origins this artefact is allowed to speak to. */
const ALLOWED_ORIGINS = [new URL(APP_URL).origin, new URL(API_URL).origin] as const;

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

function isThirdParty(url: string): boolean {
    if (LOCAL_SCHEMES.some((scheme) => url.startsWith(scheme))) return false;
    return !ALLOWED_ORIGINS.some((origin) => url.startsWith(origin));
}

/**
 * Installs the collector. Returns the list it fills, which is read after the walk rather than
 * during it — a request can be issued long after the navigation that caused it settled.
 */
async function collectRequests(page: Page): Promise<string[]> {
    const external: string[] = [];

    await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (isThirdParty(url)) {
            external.push(`${route.request().resourceType()} ${url}`);
            // Refused rather than allowed through: the walk that follows therefore also proves the
            // application renders with no third-party host reachable at all.
            await route.abort('blockedbyclient');
            return;
        }
        await route.continue();
    });

    return external;
}

function assertNoThirdParty(external: readonly string[], where: string) {
    for (const host of FORBIDDEN_HOSTS) {
        const hits = external.filter((entry) => entry.includes(host));
        expect(hits, `${where}: contacted ${host} — ${hits.join(', ')}`).toEqual([]);
    }

    expect(
        external,
        `${where}: ${String(external.length)} request(s) to a host that is neither ` +
            `${ALLOWED_ORIGINS.join(' nor ')}.`,
    ).toEqual([]);
}

/**
 * Every `src`/`href` in the document points at an allowed origin or at nothing at all.
 *
 * The collector cannot see a URL that was never fetched — an `<img>` below the fold, a stylesheet
 * `url()` behind a media query, an anchor to a reference product in body copy. Reading the markup
 * catches the reference before the browser gets round to it.
 */
async function assertNoThirdPartyReferences(page: Page, where: string) {
    const references = await page.evaluate(
        ({ localSchemes, allowed }) => {
            const found: string[] = [];
            for (const element of document.querySelectorAll('[src], [href], [srcset]')) {
                for (const attribute of ['src', 'href', 'srcset']) {
                    const value = element.getAttribute(attribute);
                    if (value === null || value === '') continue;
                    if (value.startsWith('#') || value.startsWith('/') || value.startsWith('.')) {
                        continue;
                    }
                    if (localSchemes.some((scheme) => value.startsWith(scheme))) continue;
                    if (allowed.some((origin) => value.startsWith(origin))) continue;
                    // A bare relative path — `assets/foo.png`, `discover` — has no scheme, no host.
                    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
                    found.push(`${element.tagName.toLowerCase()}[${attribute}]=${value}`);
                }
            }
            return found;
        },
        { localSchemes: LOCAL_SCHEMES, allowed: [...ALLOWED_ORIGINS] },
    );

    expect(references, `${where}: third-party reference in the markup.`).toEqual([]);
}

async function walk(page: Page, paths: readonly (readonly [string, string])[]) {
    for (const [path, marker] of paths) {
        await page.goto(path);
        await expect(page.getByTestId(marker), `${path} did not render`).toBeVisible();
        await assertNoThirdPartyReferences(page, path);
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

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 90 s default is a budget for one. `test.slow()`
    // triples it for the journeys that really do pay that cost, rather than raising the ceiling
    // for every test that reads a single endpoint.
    test.slow();
    skipUnlessStackIsUp(stack);
});

test.describe('the exported build contacts only its own server and its own API', () => {
    test('the public marketplace', async ({ page }) => {
        const external = await collectRequests(page);

        await walk(page, PUBLIC_WALK);

        assertNoThirdParty(external, 'public marketplace walk');
    });

    test('the customer and commerce areas', async ({ page }) => {
        const external = await collectRequests(page);

        await signIn(page, CONSUMER_EMAIL);
        await walk(page, CUSTOMER_WALK);

        assertNoThirdParty(external, 'customer walk');
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

    /**
     * The bundled-images promise, restated now that a second origin is allowed.
     *
     * Every image the product renders is bundled with the export, so it is served by the static
     * server. The API answers with JSON and placeholder identifiers, never with an image URL — so an
     * `<img>` whose source is the API origin is a copied remote asset wearing an allowed origin's
     * clothing, and this is the assertion that catches it.
     */
    test('no image is fetched from the API origin', async ({ page }) => {
        const fromApi: string[] = [];
        page.on('request', (request) => {
            if (
                request.resourceType() === 'image' &&
                request.url().startsWith(new URL(API_URL).origin)
            ) {
                fromApi.push(request.url());
            }
        });

        await walk(page, [
            ['/', 'landing-screen'],
            ['/kitchens', 'kitchens-grid'],
            ['/meals', 'meals-grid'],
        ]);

        expect(fromApi, `images must be bundled, not fetched: ${fromApi.join(', ')}`).toEqual([]);
    });
});
