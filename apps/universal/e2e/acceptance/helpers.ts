import { readFile } from 'node:fs/promises';

import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { ACCEPTANCE_API_URL, ACCEPTANCE_MAIL_LOG } from '../../playwright.acceptance.config.ts';

/** Seeded demo accounts (`DatabaseSeeder`). One password for all of them, locally. */
export const DEMO_PASSWORD = 'password';
export const CEDAR_DIETITIAN = 'dietitian@cedar.test';

/** Where the web build keeps the bearer token (`src/session/storage.ts`). */
const SESSION_TOKEN_KEY = 'h360.session-token';

export interface StackStatus {
    readonly api: boolean;
    readonly mailLog: boolean;
    readonly reason: string;
}

async function reachable(url: string): Promise<boolean> {
    try {
        // Generous on purpose: the Windows Docker stack answers /up in ~5-6s cold (php-fpm over a
        // bind mount), and a probe that times out on a slow-but-alive stack skips the whole suite.
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function fileReadable(path: string): Promise<boolean> {
    try {
        await readFile(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Probes the stack once per file.
 *
 * A missing stack is not a failing test — it is a missing prerequisite — so the specs skip with an
 * instruction instead of timing out five times over. Mail is read from the API's log (`MAIL_MAILER=log`)
 * rather than a mail server, so the "inbox" prerequisite is simply that the log file is readable.
 */
export async function probeStack(): Promise<StackStatus> {
    const [api, mailLog] = await Promise.all([
        reachable(`${ACCEPTANCE_API_URL}/up`),
        fileReadable(ACCEPTANCE_MAIL_LOG),
    ]);

    const missing = [
        api ? null : `the API at ${ACCEPTANCE_API_URL}`,
        mailLog
            ? null
            : `a readable mail log at ${ACCEPTANCE_MAIL_LOG} (the API must have run at least once)`,
    ].filter((entry): entry is string => entry !== null);

    return {
        api,
        mailLog,
        reason:
            missing.length === 0
                ? ''
                : `Acceptance needs ${missing.join(' and ')}. Start it with \`docker compose up -d --wait\`.`,
    };
}

export function skipUnlessStackIsUp(status: StackStatus, mailLogRequired = false): void {
    test.skip(!status.api || (mailLogRequired && !status.mailLog), status.reason);
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
 * The newest verification link the API has mailed to an address.
 *
 * With `MAIL_MAILER=log` there is no mail server: the rendered message is appended to the Laravel
 * log, so this reads that file instead of polling an inbox. It is polled rather than awaited on a
 * hook because the mail is queued and the queue worker is a separate process. Each `log` mailer
 * entry is the full MIME message, quoted-printable encoded; entries are correlated to the address by
 * the `To:` header and the newest matching link is returned.
 */
export async function fetchVerificationLink(email: string, attempts = 60): Promise<string> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        let raw: string;
        try {
            raw = await readFile(ACCEPTANCE_MAIL_LOG, 'utf8');
        } catch {
            raw = '';
        }

        // Laravel log entries begin with a `[timestamp]` prefix; split so each block is one message.
        const entries = raw.split(/(?=^\[\d{4}-\d\d-\d\d[ T])/m);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const decoded = decodeQuotedPrintable(entries[index] ?? '');
            if (!decoded.includes(email)) continue;
            const link = extractVerificationLink(decoded);
            if (link !== null) return link;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`No verification mail was logged for ${email} within ${attempts * 500}ms.`);
}

/**
 * Undo the quoted-printable encoding the `log` mailer writes: soft line breaks (`=` at end of line)
 * are removed and `=XX` escapes decoded, so a signed URL split across lines becomes whole again.
 */
function decodeQuotedPrintable(body: string): string {
    return body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
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
