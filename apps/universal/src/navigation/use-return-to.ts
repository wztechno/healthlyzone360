import {
    useGlobalSearchParams,
    useNavigation,
    usePathname,
    useRouter,
    useSegments,
} from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';

import { clearResumeIntent } from '../features/marketplace/resume-intent.ts';
import { lastQuery, rememberQuery } from './last-query.ts';
import {
    hrefFromParts,
    pathnameOf,
    pathParamNames,
    queryOf,
    returnDestination,
    routeEntryPath,
    safeReturnTo,
    withQuery,
    withReturnTo,
} from './return-to.ts';
import type { ReturnDestination } from './return-to.ts';

/**
 * The hooks over `return-to.ts`. Each one takes the router from `useRouter()` rather than the
 * `router` singleton, so the suites' module mocks keep seeing every navigation.
 *
 * ## Which call, when
 *
 * | moment                                         | call                                      |
 * | ---------------------------------------------- | ----------------------------------------- |
 * | open a detour (add an address from checkout)   | `push(withReturnTo(step, here))`          |
 * | finish it (saved, verified, done)              | `back.finish()` — `dismissTo`, never push |
 * | cancel it, or "Back to …"                      | `back.leave()`                            |
 * | a choice on the page (address, tab, filter)    | `router.setParams`                        |
 * | a wizard's next step                           | `push(?step=next)`                        |
 *
 * `dismissTo` pops to the entry that opened the detour when it is still below, and otherwise
 * replaces the current one — so the submitted form is never what Back returns to. It replaces the
 * target's params rather than merging them, which is why it is always given a complete href.
 */

/**
 * The current page as an href — pathname plus its search params, `returnTo` encoded as written.
 *
 * ## Only the focused page's own params
 *
 * `useGlobalSearchParams` merges the params of every route on the focused chain, and after a cold
 * start — a deep link, a refresh — expo-router 57 seeds the area's and the root's routes with the
 * first page's path params and never updates them as the person moves on inside the `<Slot/>`. So
 * a refresh on `/customer/orders/o-1` followed by "Back to your orders" left `order=o-1` in the
 * global params of `/customer/account`, and an href built from them carried it into every return
 * and every remembered listing query (`use-return-to.test.tsx` pins this against the real router).
 * The browser's own URL is built from the focused route alone, so this keeps the keys the focused
 * route has — read from the navigator state, which a screen and a layout both reach — and takes
 * their values from the global params, where they are already decoded. A caller with no navigator
 * state to read (a suite's mock) gets every global param, as before.
 */
export function useCurrentHref(): string {
    const pathname = usePathname();
    const segments = useSegments();
    const params = useGlobalSearchParams();
    const navigation = useNavigation();
    const state = (navigation as { getState?: () => NavigatorStateLike | undefined }).getState?.();
    const keys = focusedParamKeys(state);
    // A string, so the memo compares the key set by value rather than by a fresh Set per render.
    const signature = keys === null ? null : [...keys].sort().join('\n');
    return useMemo(() => {
        const keep = signature === null ? null : new Set(signature.split('\n'));
        const own =
            keep === null
                ? params
                : Object.fromEntries(Object.entries(params).filter(([key]) => keep.has(key)));
        return hrefFromParts(pathname, own, pathParamNames(segments));
    }, [pathname, params, segments, signature]);
}

/**
 * The param names of the route in focus below `state`, or `null` when there is no state to read.
 * A navigation the nested navigator has not rendered yet is still folded into `params.screen` /
 * `params.params`, so that nesting is followed too. The index is read the way expo-router reads it
 * for the global params (`?? 0`), so both agree on which route is meant.
 */
function focusedParamKeys(state: NavigatorStateLike | undefined): ReadonlySet<string> | null {
    let routes = state?.routes;
    let index = state?.index ?? 0;
    let params: object | undefined;
    let found = false;
    while (routes !== undefined) {
        const route = routes[index];
        if (route === undefined) break;
        found = true;
        params = route.params;
        routes = route.state?.routes;
        index = route.state?.index ?? 0;
    }
    if (!found) return null;
    while (params !== undefined && 'screen' in params) {
        const nested = (params as { readonly params?: unknown }).params;
        params = typeof nested === 'object' && nested !== null ? nested : undefined;
    }
    return new Set(Object.keys(params ?? {}));
}

/** `canGoBack() ? back() : replace(fallback)` — the fallback after a refresh or a deep link. */
export function useGoBackOr(): (fallback: string) => void {
    const router = useRouter();
    return useCallback(
        (fallback: string) => {
            if (router.canGoBack()) router.back();
            else router.replace(fallback as never);
        },
        [router],
    );
}

export interface ReturnTo {
    /** The validated `?returnTo=`, or `null` when the page was not opened as a detour. */
    readonly returnTo: string | null;
    /** Where finishing goes: the return, else the screen's own fallback. */
    readonly target: string;
    /** What the target is called, for "Back to …" labels. */
    readonly destination: ReturnDestination;
    /**
     * Finish the detour. `patch` is merged into the return's query — the saved address's id, say —
     * and ignored for the fallback, which is used as it is.
     */
    readonly finish: (patch?: Readonly<Record<string, string | null | undefined>>) => void;
    /** Cancel: back to the return when there is one, else the previous page, else the fallback. */
    readonly leave: () => void;
    /** Up to the target, by name — what a labelled crumb does. */
    readonly up: () => void;
    /** Passes the chain on: `href` with this page's return attached. */
    readonly carry: (href: string) => string;
}

/**
 * The detour a screen is in.
 *
 * @param raw the route's `returnTo` param, as `useLocalSearchParams` gives it.
 * @param fallback where finishing goes when the page was opened directly.
 */
export function useReturnTo(raw: string | string[] | undefined, fallback: string): ReturnTo {
    const router = useRouter();
    const goBackOr = useGoBackOr();
    const returnTo = safeReturnTo(Array.isArray(raw) ? raw[0] : raw);
    const target = returnTo ?? fallback;

    return useMemo<ReturnTo>(
        () => ({
            returnTo,
            target,
            destination: returnDestination(target),
            finish: (patch) => {
                const href =
                    patch !== undefined && returnTo !== null ? withQuery(returnTo, patch) : target;
                router.dismissTo(href as never);
            },
            leave: () => {
                if (returnTo !== null) router.dismissTo(returnTo as never);
                else goBackOr(fallback);
            },
            up: () => {
                router.dismissTo(target as never);
            },
            carry: (href: string) => withReturnTo(href, returnTo),
        }),
        [fallback, goBackOr, returnTo, router, target],
    );
}

export interface PreviousEntry {
    readonly pathname: string;
    readonly params: Readonly<Record<string, unknown>>;
}

interface NavigatorStateLike {
    readonly index?: number | undefined;
    readonly routes?:
        | readonly {
              readonly name: string;
              readonly params?: object | undefined;
              readonly state?: NavigatorStateLike | undefined;
          }[]
        | undefined;
}

/**
 * The entry below this page in the navigator that owns it — the page Back returns to, when it is in
 * the same group. `null` when there is none (a deep link, a refresh, or a different group).
 */
export function usePreviousEntry(): PreviousEntry | null {
    const navigation = useNavigation();
    const pathname = usePathname();
    const state = (navigation as { getState?: () => NavigatorStateLike | undefined }).getState?.();
    const routes = state?.routes;
    const index = state?.index ?? 0;
    if (routes === undefined || index < 1) return null;

    const current = routes[index];
    const previous = routes[index - 1];
    if (current === undefined || previous === undefined) return null;

    // The navigator's routes are relative to it; the prefix is what the pathname has before them.
    const relative = routeEntryPath(current);
    const prefix =
        relative === '/'
            ? pathname.replace(/\/$/, '')
            : pathname.endsWith(relative)
              ? pathname.slice(0, pathname.length - relative.length)
              : '';
    const previousPath = routeEntryPath(previous);
    return {
        pathname: `${prefix}${previousPath === '/' && prefix !== '' ? '' : previousPath}`,
        params: (previous.params ?? {}) as Readonly<Record<string, unknown>>,
    };
}

/**
 * Up to a parent listing, as the person left it: Back when the parent is the entry right below,
 * otherwise a push of the parent with the query it was last shown with.
 */
export function useNavigateUp(): (parentHref: string) => void {
    const router = useRouter();
    const previous = usePreviousEntry();
    return useCallback(
        (parentHref: string) => {
            const parentPath = pathnameOf(parentHref);
            if (previous !== null && previous.pathname === parentPath) {
                router.back();
                return;
            }
            const remembered = lastQuery(parentPath);
            const href =
                remembered === ''
                    ? parentHref
                    : withQuery(parentPath, {
                          ...queryOf(`?${remembered}`),
                          ...queryOf(parentHref),
                      });
            router.push(href as never);
        },
        [previous, router],
    );
}

/** Records this listing's current query, so {@link useNavigateUp} can bring it back. */
export function useRememberQuery(): void {
    const href = useCurrentHref();
    useEffect(() => {
        const pathname = pathnameOf(href);
        rememberQuery(pathname, href.slice(pathname.length + 1));
    }, [href]);
}

/** Opens sign-in or registration, carrying the page to come back to. */
export function useGoToAuth(): (
    href: '/sign-in' | '/register',
    returnTo?: string | null | undefined,
) => void {
    const router = useRouter();
    const here = useCurrentHref();
    return useCallback(
        (href, returnTo) => {
            router.push(withReturnTo(href, returnTo === undefined ? here : returnTo) as never);
        },
        [here, router],
    );
}

/**
 * Ends a sign-in, a registration or an email verification: back through the launch resolver, which
 * sends the person on to the return when their session may be there.
 */
export function useCompleteAuth(): (returnTo: string | null) => void {
    const router = useRouter();
    return useCallback(
        (returnTo: string | null) => {
            clearResumeIntent();
            router.replace((returnTo === null ? '/' : withReturnTo('/', returnTo)) as never);
        },
        [router],
    );
}
