import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { ACCEPTANCE_API_URL, ACCEPTANCE_MAILPIT_URL } from '../../playwright.acceptance.config.ts';

/** Seeded demo accounts (`DatabaseSeeder`). One password for all of them, locally. */
export const DEMO_PASSWORD = 'password';
export const CEDAR_DIETITIAN = 'dietitian@cedar.test';

/** Where the web build keeps the bearer token (`src/session/storage.ts`). */
const SESSION_TOKEN_KEY = 'h360.session-token';

export interface StackStatus {
    readonly api: boolean;
    readonly mailpit: boolean;
    readonly reason: string;
}

async function reachable(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Probes the stack once per file.
 *
 * A missing stack is not a failing test — it is a missing prerequisite — so the specs skip with an
 * instruction instead of timing out five times over.
 */
export async function probeStack(): Promise<StackStatus> {
    const [api, mailpit] = await Promise.all([
        reachable(`${ACCEPTANCE_API_URL}/up`),
        reachable(`${ACCEPTANCE_MAILPIT_URL}/api/v1/messages?limit=1`),
    ]);

    const missing = [
        api ? null : `the API at ${ACCEPTANCE_API_URL}`,
        mailpit ? null : `Mailpit at ${ACCEPTANCE_MAILPIT_URL}`,
    ].filter((entry): entry is string => entry !== null);

    return {
        api,
        mailpit,
        reason:
            missing.length === 0
                ? ''
                : `Acceptance needs ${missing.join(' and ')}. Start it with \`docker compose up -d --wait\`.`,
    };
}

export function skipUnlessStackIsUp(status: StackStatus, mailpitRequired = false): void {
    test.skip(!status.api || (mailpitRequired && !status.mailpit), status.reason);
}

/** The bearer token the running application is holding, read from its own storage. */
export async function readSessionToken(page: Page): Promise<string> {
    const token = await page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        SESSION_TOKEN_KEY,
    );
    expect(token, 'the application should have stored a bearer token').not.toBeNull();
    return token as string;
}

/** Signs in through the real screen and waits for the post-login redirect to settle. */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    await page.getByTestId('sign-in-email').locator('input').first().fill(email);
    await page.getByTestId('sign-in-password').locator('input').first().fill(password);
    await page.getByTestId('sign-in-submit').click();

    // Where the person lands depends on the workspace the *server* remembers for them, so this
    // waits for "somewhere authenticated" rather than for one specific screen.
    await expect(page.getByTestId('sign-in-screen')).toBeHidden();
}

export interface ApiCallOptions {
    readonly token?: string | undefined;
    readonly headers?: Record<string, string> | undefined;
    readonly data?: unknown;
}

/**
 * A direct call to the API from the browser context, bypassing the UI.
 *
 * Used only for the things a UI cannot express: following a signed verification link, probing a
 * context the application would never claim, and confirming that a revoked token is really dead.
 */
export async function apiRequest(
    request: APIRequestContext,
    method: 'get' | 'post' | 'delete',
    path: string,
    options: ApiCallOptions = {},
) {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Client-Request-Id': `acceptance-${Date.now()}`,
        ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
        ...options.headers,
    };

    const url = path.startsWith('http') ? path : `${ACCEPTANCE_API_URL}${path}`;
    return request[method](url, {
        headers,
        ...(options.data === undefined ? {} : { data: options.data }),
    });
}

/** Exchanges credentials for a second, independent bearer token bound to its own device. */
export async function issueToken(
    request: APIRequestContext,
    email: string,
    deviceName: string,
    platform: 'web' | 'ios' | 'android' = 'android',
): Promise<{ token: string; deviceId: string }> {
    const response = await apiRequest(request, 'post', '/api/v1/auth/token', {
        data: { email, password: DEMO_PASSWORD, device_name: deviceName, platform },
    });
    expect(response.status(), await response.text()).toBe(201);

    const body = (await response.json()) as {
        data: { token: string; device: { id: string } };
    };
    return { token: body.data.token, deviceId: body.data.device.id };
}

/**
 * The newest verification link Mailpit holds for an address.
 *
 * Mailpit is polled rather than awaited on a hook: the mail is queued, and the queue worker is a
 * separate container.
 */
export async function fetchVerificationLink(
    request: APIRequestContext,
    email: string,
    attempts = 20,
): Promise<string> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const search = await request.get(
            `${ACCEPTANCE_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=5`,
        );

        if (search.ok()) {
            const results = (await search.json()) as {
                messages?: { ID: string; Created: string }[];
            };
            const newest = [...(results.messages ?? [])].sort((a, b) =>
                b.Created.localeCompare(a.Created),
            )[0];

            if (newest !== undefined) {
                const message = await request.get(
                    `${ACCEPTANCE_MAILPIT_URL}/api/v1/message/${newest.ID}`,
                );
                const body = (await message.json()) as { Text?: string; HTML?: string };
                const link = extractVerificationLink(`${body.Text ?? ''}\n${body.HTML ?? ''}`);
                if (link !== null) return link;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`No verification mail arrived for ${email} within ${attempts * 500}ms.`);
}

/**
 * The signed link out of the mail body.
 *
 * The HTML part contains the same URL with `&amp;` entities and, in the plain-text part, wrapped in
 * markdown brackets — so the match is trimmed of trailing punctuation and the entities decoded.
 */
export function extractVerificationLink(body: string): string | null {
    const match = /https?:\/\/[^\s"'<>]*verify-email[^\s"'<>)\]]*/.exec(body);
    if (match === null) return null;
    return match[0].replace(/&amp;/g, '&').replace(/[).,]+$/, '');
}
