import { isRouteArea } from '@healthy360/domain-types';

import { isPathAvailable } from '../features/availability.ts';

/**
 * "Take me back to where I was", as a URL.
 *
 * A detour — checkout sends somebody to add an address, the gate sends them to sign in — carries the
 * page that sent it in `?returnTo=`, and the detour's finish goes back there. The value lives in the
 * URL rather than in memory because every `/customer/*` page is a sibling inside one `<Slot/>`: a
 * push unmounts the page underneath, so nothing it held survives the trip.
 *
 * ## The value is encoded twice
 *
 * expo-router decodes a query value once when it parses the URL (`URLSearchParams`) and both
 * `useLocalSearchParams` and `useGlobalSearchParams` run `decodeURIComponent` over it a second time.
 * A return path is itself a URL, so a single encoding loses its own query the moment it holds a `%` —
 * a nested `returnTo`, or a search for "a b". Writing `returnTo` only through {@link withReturnTo} and
 * {@link withQuery} encodes it twice, which the two decodes undo exactly. A hand-typed
 * `?returnTo=/customer/cart` still works: decoding a string with no `%` changes nothing.
 *
 * ## It is never trusted
 *
 * Anything read back goes through {@link safeReturnTo} before it reaches the router. expo-router
 * opens an href that starts with `//` or a scheme through `Linking.openURL`, so an unchecked value
 * would be an open redirect.
 */

export const RETURN_TO_PARAM = 'returnTo';

/** What a "Back to …" control names. Drives `common:returnTo.*` and `common:destination.*`. */
export const RETURN_DESTINATIONS = [
    'checkout',
    'planSetup',
    'subscription',
    'account',
    'basket',
    'order',
    'closure',
    'previous',
] as const;
export type ReturnDestination = (typeof RETURN_DESTINATIONS)[number];

const MAX_LENGTH = 2048;

/** Pages a person is never sent *back* to: the ways in, and the launch resolver itself. */
const NON_RETURNABLE: ReadonlySet<string> = new Set([
    '/',
    '/sign-in',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/verify-phone',
    '/change-password',
    '/select-organisation',
    '/select-branch',
    '/forbidden',
]);

/**
 * Paths outside the gated areas that still sit behind a session: the workspace group and the
 * business application. Everything else whose first segment is not a gated area is public.
 */
const GATED_PREFIXES: readonly string[] = ['/workspace', '/profile', '/devices', '/apply'];

/** Unreserved and sub-delimiter characters, `%` escapes and `/`. Nothing else is a path here. */
const PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/[\]]*$/;

/** Whitespace, control characters and the backslash some browsers read as a slash. */
function hasForbiddenCharacter(value: string): boolean {
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code <= 0x20 || code === 0x7f || character === '\\' || /\s/.test(character)) {
            return true;
        }
    }
    return false;
}

function decodeSafely(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

interface SplitHref {
    readonly pathname: string;
    readonly query: string;
}

function splitHref(href: string): SplitHref {
    const withoutHash = href.split('#')[0] ?? '';
    const queryAt = withoutHash.indexOf('?');
    return queryAt === -1
        ? { pathname: withoutHash, query: '' }
        : { pathname: withoutHash.slice(0, queryAt), query: withoutHash.slice(queryAt + 1) };
}

function joinHref(pathname: string, search: URLSearchParams): string {
    const query = search.toString();
    return query === '' ? pathname : `${pathname}?${query}`;
}

/**
 * An in-application path to return to, or `null`.
 *
 * Accepted: a string of at most 2048 characters, with no whitespace, control characters or
 * backslash, starting with exactly one `/` — also once decoded — whose path is not one of the ways in
 * ({@link NON_RETURNABLE}) and is available in this build. The hash is dropped; path and query are
 * returned as given.
 */
export function safeReturnTo(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    if (raw.length === 0 || raw.length > MAX_LENGTH) return null;
    if (hasForbiddenCharacter(raw)) return null;

    const { pathname, query } = splitHref(raw);
    if (!PATH_PATTERN.test(pathname) || pathname.startsWith('//')) return null;

    const decoded = decodeSafely(pathname);
    if (decoded === null || decoded.startsWith('//') || hasForbiddenCharacter(decoded)) {
        return null;
    }

    const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (NON_RETURNABLE.has(normalised)) return null;
    if (!isPathAvailable(normalised)) return null;

    return query === '' ? normalised : `${normalised}?${query}`;
}

/**
 * Sets (or, for `null` / `undefined`, deletes) query keys on an href. Values are encoded once;
 * `returnTo` goes through the double encoding described above.
 */
export function withQuery(
    href: string,
    patch: Readonly<Record<string, string | number | null | undefined>>,
): string {
    const { pathname, query } = splitHref(href);
    const search = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') {
            search.delete(key);
        } else if (key === RETURN_TO_PARAM) {
            search.set(key, encodeURIComponent(String(value)));
        } else {
            search.set(key, String(value));
        }
    }
    return joinHref(pathname, search);
}

/** `href` carrying `?returnTo=` (replacing any it had). An unsafe or empty return is left off. */
export function withReturnTo(href: string, returnTo: string | null | undefined): string {
    const safe = safeReturnTo(returnTo);
    return withQuery(href, { [RETURN_TO_PARAM]: safe });
}

/** The dynamic segment names of a route — `['customer', 'orders', '[order]']` gives `order`. */
export function pathParamNames(segments: readonly string[]): ReadonlySet<string> {
    const names = new Set<string>();
    for (const segment of segments) {
        const match = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment);
        if (match?.[1] !== undefined) names.add(match[1]);
    }
    return names;
}

/**
 * The current page's href from the router's parts: the pathname plus every search param that is not
 * a path param. `params` are the hooks' values — already decoded to what the page means — so they
 * are encoded once here, and `returnTo` twice.
 */
export function hrefFromParts(
    pathname: string,
    params: Readonly<Record<string, string | string[] | undefined>>,
    pathParams: ReadonlySet<string>,
): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (pathParams.has(key) || key === '#' || value === undefined) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) {
            search.append(key, key === RETURN_TO_PARAM ? encodeURIComponent(entry) : entry);
        }
    }
    return joinHref(pathname, search);
}

/** Whether an href is reachable without a session. */
export function isPublicHref(href: string): boolean {
    const { pathname } = splitHref(href);
    if (GATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        return false;
    }
    const first = pathname.split('/')[1] ?? '';
    return !isRouteArea(first) || first === 'public' || first === 'auth';
}

/** Path prefixes and what a control returning there is called, most specific first. */
const DESTINATION_PREFIXES: readonly (readonly [string, ReturnDestination])[] = [
    ['/customer/checkout', 'checkout'],
    ['/customer/subscriptions/new', 'planSetup'],
    ['/customer/subscriptions/', 'subscription'],
    ['/customer/account/close', 'closure'],
    ['/customer/account', 'account'],
    ['/customer/cart', 'basket'],
    ['/customer/orders', 'order'],
];

export function returnDestination(href: string | null | undefined): ReturnDestination {
    if (href === null || href === undefined) return 'previous';
    const { pathname } = splitHref(href);
    for (const [prefix, destination] of DESTINATION_PREFIXES) {
        if (prefix.endsWith('/')) {
            if (pathname.startsWith(prefix) && pathname.length > prefix.length) return destination;
        } else if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
            return destination;
        }
    }
    return 'previous';
}

/** The pathname of an href, without its query or hash. */
export function pathnameOf(href: string): string {
    return splitHref(href).pathname;
}

/** The query of an href as a plain record (values decoded once, as `URLSearchParams` reads them). */
export function queryOf(href: string): Readonly<Record<string, string>> {
    return Object.fromEntries(new URLSearchParams(splitHref(href).query).entries());
}

/**
 * The path a navigator's route stands for, relative to that navigator: `meals/[meal]` with
 * `{ meal: '12' }` gives `/meals/12`. Group segments and a trailing `index` are dropped.
 */
export function routeEntryPath(route: {
    readonly name: string;
    readonly params?: object | undefined;
}): string {
    const params = (route.params ?? {}) as Readonly<Record<string, unknown>>;
    const parts: string[] = [];
    for (const segment of route.name.split('/')) {
        if (segment === '' || segment === 'index' || /^\(.*\)$/.test(segment)) continue;
        const dynamic = /^\[(\.\.\.)?([^\]]+)\]$/.exec(segment);
        if (dynamic === null) {
            parts.push(segment);
            continue;
        }
        const value = params[dynamic[2] ?? ''];
        if (Array.isArray(value)) parts.push(...value.map(String));
        else if (typeof value === 'string' || typeof value === 'number') parts.push(String(value));
    }
    return `/${parts.join('/')}`;
}
