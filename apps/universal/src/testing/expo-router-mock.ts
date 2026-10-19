import { createElement, Fragment, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/**
 * One `expo-router` module mock for the customer suites.
 *
 * Each suite used to hand-write its own factory with `push` and `replace` and nothing else. The
 * navigation helpers (`navigation/use-return-to.ts`) also need `dismissTo`, `canGoBack`, `navigate`,
 * the search params, the segments and the owning navigator's state, so they are provided here once:
 *
 * ```ts
 * jest.mock('expo-router', () =>
 *     require('../../testing/expo-router-mock.ts').createExpoRouterMock({ pathname: '/customer/cart' }),
 * );
 * const routerMock = require('expo-router') as ExpoRouterMock;
 * beforeEach(() => routerMock.__reset());
 * ```
 *
 * `__set` changes the pathname, params, segments, navigator state or `canGoBack` for one test;
 * `__reset` restores the factory's options and clears every spy. `Redirect` records its `href` in
 * `__redirect` instead of navigating. `__push` and `__replace` stay for the assertions that already
 * read them.
 *
 * ## The route hooks are live
 *
 * `usePathname`, the two search-param hooks and `useSegments` re-render their component when the
 * mock's location changes, so a `__set` inside `act` is seen by a screen that is already mounted —
 * the way a real `setParams` is.
 *
 * ## Following navigation, when a case asks for it
 *
 * By default every router call is only a spy: the screen stays where it is and the assertion is the
 * call. A screen whose *state* is its URL — the checkout's address, date, window and step — cannot
 * be walked like that: choosing a window is a `setParams`, and the screen only shows the choice
 * once the URL has it. `follow: true` (on the factory, or per case through `__set`) makes the calls
 * move the mock as the real router would — `setParams` merges into the params, `push` / `replace` /
 * `navigate` / `dismissTo` / `back` walk a small history of hrefs — while still recording every
 * call on the spies. The rendered component does not change: a push to another page leaves the
 * screen under test mounted with that page's location, so a case that follows a push asserts the
 * call and stops there, or asserts on what the same screen does with the new URL.
 *
 * A pushed href's query is read back the way `useLocalSearchParams` reads it — decoded once by the
 * URL and once more by the hook — so a `returnTo` written by `withReturnTo` arrives as the href it
 * names.
 */

export interface NavigatorStateMock {
    readonly index: number;
    readonly routes: readonly {
        readonly name: string;
        readonly params?: object | undefined;
        /** The history entry's key — what the marketplace chrome keeps each page's place by. */
        readonly key?: string | undefined;
        /** A nested navigator's state, as a layout's navigator holds its group's. */
        readonly state?: NavigatorStateMock | undefined;
    }[];
}

export interface ExpoRouterMockOptions {
    readonly pathname?: string | undefined;
    readonly params?: Readonly<Record<string, string | string[] | undefined>> | undefined;
    readonly segments?: readonly string[] | undefined;
    readonly navState?: NavigatorStateMock | undefined;
    readonly canGoBack?: boolean | undefined;
    /** Router calls move the mock's location as well as being recorded. See the module note. */
    readonly follow?: boolean | undefined;
}

type MockParams = Readonly<Record<string, string | string[] | undefined>>;

interface MockLocation {
    readonly pathname: string;
    readonly params: MockParams;
}

interface MockState {
    pathname: string;
    params: MockParams;
    segments: readonly string[] | undefined;
    navState: NavigatorStateMock | undefined;
    canGoBack: boolean;
    follow: boolean;
    /** Entries below the current one, oldest first — only walked in `follow` mode. */
    below: MockLocation[];
}

function decodeTwice(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** An href as the real router hands it to a screen: pathname, and params decoded twice. */
function locationOf(href: unknown): MockLocation | null {
    if (typeof href !== 'string') return null;
    const [withoutHash = ''] = href.split('#');
    const queryAt = withoutHash.indexOf('?');
    const pathname = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
    const params: Record<string, string | string[]> = {};
    if (queryAt !== -1) {
        for (const [key, value] of new URLSearchParams(withoutHash.slice(queryAt + 1))) {
            const decoded = decodeTwice(value);
            const existing = params[key];
            params[key] =
                existing === undefined
                    ? decoded
                    : [...(Array.isArray(existing) ? existing : [existing]), decoded];
        }
    }
    return { pathname, params };
}

export interface RouterSpies {
    readonly push: jest.Mock;
    readonly replace: jest.Mock;
    readonly navigate: jest.Mock;
    readonly back: jest.Mock;
    readonly dismiss: jest.Mock;
    readonly dismissTo: jest.Mock;
    readonly setParams: jest.Mock;
    readonly canGoBack: jest.Mock;
}

export interface ExpoRouterMock {
    readonly __router: RouterSpies;
    readonly __push: jest.Mock;
    readonly __replace: jest.Mock;
    readonly __redirect: jest.Mock;
    readonly __set: (patch: ExpoRouterMockOptions) => void;
    readonly __reset: () => void;
}

export function createExpoRouterMock(options: ExpoRouterMockOptions = {}) {
    const initial = (): MockState => ({
        pathname: options.pathname ?? '/',
        params: options.params ?? {},
        segments: options.segments,
        navState: options.navState,
        canGoBack: options.canGoBack ?? false,
        follow: options.follow ?? false,
        below: [],
    });
    const state: MockState = initial();

    // A version bumped on every change of location, so the route hooks can re-render on it.
    let version = 0;
    const listeners = new Set<() => void>();
    const emit = () => {
        version += 1;
        for (const listener of listeners) listener();
    };
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };
    const useLocation = () => {
        useSyncExternalStore(
            subscribe,
            () => version,
            () => version,
        );
        return state;
    };

    const moveTo = (location: MockLocation) => {
        state.pathname = location.pathname;
        state.params = location.params;
        emit();
    };
    const current = (): MockLocation => ({ pathname: state.pathname, params: state.params });

    /** What each call does to the location in `follow` mode; nothing otherwise. */
    const follow = {
        push: (href: unknown) => {
            const next = locationOf(href);
            if (next === null) return;
            state.below.push(current());
            moveTo(next);
        },
        replace: (href: unknown) => {
            const next = locationOf(href);
            if (next !== null) moveTo(next);
        },
        // NAVIGATE to the page already showing reuses it rather than stacking a copy.
        navigate: (href: unknown) => {
            const next = locationOf(href);
            if (next === null) return;
            if (next.pathname !== state.pathname) state.below.push(current());
            moveTo(next);
        },
        // POP_TO: back to the nearest entry for the same page, given the target's params; else a
        // replace. The real router matches by route name, which a pathname stands in for here.
        dismissTo: (href: unknown) => {
            const next = locationOf(href);
            if (next === null) return;
            for (let index = state.below.length - 1; index >= 0; index -= 1) {
                if (state.below[index]?.pathname === next.pathname) {
                    state.below = state.below.slice(0, index);
                    break;
                }
            }
            moveTo(next);
        },
        back: () => {
            const previous = state.below.pop();
            if (previous !== undefined) moveTo(previous);
        },
        setParams: (patch: unknown) => {
            if (typeof patch !== 'object' || patch === null) return;
            const merged: Record<string, string | string[] | undefined> = { ...state.params };
            for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
                if (value === undefined || value === null) delete merged[key];
                else merged[key] = Array.isArray(value) ? value.map(String) : String(value);
            }
            moveTo({ pathname: state.pathname, params: merged });
        },
    };

    const router: RouterSpies = {
        push: jest.fn((href: unknown) => {
            if (state.follow) follow.push(href);
        }),
        replace: jest.fn((href: unknown) => {
            if (state.follow) follow.replace(href);
        }),
        navigate: jest.fn((href: unknown) => {
            if (state.follow) follow.navigate(href);
        }),
        back: jest.fn(() => {
            if (state.follow) follow.back();
        }),
        dismiss: jest.fn(),
        dismissTo: jest.fn((href: unknown) => {
            if (state.follow) follow.dismissTo(href);
        }),
        setParams: jest.fn((patch: unknown) => {
            if (state.follow) follow.setParams(patch);
        }),
        canGoBack: jest.fn(() => state.canGoBack || (state.follow && state.below.length > 0)),
    };
    const redirect = jest.fn();
    const navigation = {
        getState: () => state.navState,
        setOptions: jest.fn(),
        addListener: jest.fn(() => () => undefined),
    };

    const segments = () =>
        state.segments ?? state.pathname.split('/').filter((segment) => segment !== '');

    return {
        __esModule: true,
        router,
        useRouter: () => router,
        usePathname: () => useLocation().pathname,
        useLocalSearchParams: () => useLocation().params,
        useGlobalSearchParams: () => useLocation().params,
        useSegments: () => {
            useLocation();
            return segments();
        },
        useNavigation: () => navigation,
        useFocusEffect: (effect: () => undefined | void | (() => void)) => {
            useEffect(() => effect() ?? undefined, [effect]);
        },
        useIsFocused: () => true,
        Redirect: ({ href }: { readonly href: unknown }) => {
            redirect(href);
            return null;
        },
        Link: ({ children }: { readonly children?: ReactNode }) =>
            createElement(Fragment, null, children),
        Slot: () => null,
        Stack: () => null,
        __router: router,
        __push: router.push,
        __replace: router.replace,
        __redirect: redirect,
        __set: (patch: ExpoRouterMockOptions) => {
            if (patch.pathname !== undefined) state.pathname = patch.pathname;
            if (patch.params !== undefined) state.params = patch.params;
            if ('segments' in patch) state.segments = patch.segments;
            if ('navState' in patch) state.navState = patch.navState;
            if (patch.canGoBack !== undefined) state.canGoBack = patch.canGoBack;
            if (patch.follow !== undefined) state.follow = patch.follow;
            emit();
        },
        __reset: () => {
            Object.assign(state, initial());
            for (const spy of Object.values(router)) spy.mockClear();
            redirect.mockClear();
            emit();
        },
    };
}
