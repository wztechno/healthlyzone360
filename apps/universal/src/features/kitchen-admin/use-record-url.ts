import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

/** A record opened inside a list page, as the page holds it: which view, and which record. */
export interface OpenRecord<K extends string> {
    readonly key: K;
    readonly id: string;
}

/**
 * Mirrors a record a list page opens in place (its view or its editor) into the URL, so the browser
 * treats it as a page: Back closes it and lands on the list, and `?view=<id>` opens it directly.
 *
 * The page's own state stays the source of truth. This hook only follows it into the address bar,
 * and calls `onUrlChange` when the address bar moves on its own (Back, Forward, a pasted link).
 * Opening pushes a history entry; switching from one open record to another replaces it, so Back
 * never walks through every record looked at; closing goes back if this page pushed the entry, or
 * replaces it if the record arrived by link.
 *
 * Only a *change* in the URL is acted on, never a mismatch: a render in which the page has opened a
 * record but the URL has not caught up yet must not read as "the reader went back".
 */
export function useRecordUrl<K extends string>(
    keys: readonly K[],
    current: OpenRecord<K> | null,
    onUrlChange: (next: OpenRecord<K> | null) => void,
): void {
    const router = useRouter();
    const pathname = usePathname();
    const params = useLocalSearchParams<Record<string, string | string[]>>();

    const fromUrl = recordFromParams(keys, params);
    const urlKey = fromUrl === null ? null : `${fromUrl.key}:${fromUrl.id}`;
    const currentKey = current === null ? null : `${current.key}:${current.id}`;

    /** Whether the entry in the address bar is one this page pushed, so closing may go back. */
    const pushed = useRef(false);
    const lastUrl = useRef<string | null>(null);
    const lastCurrent = useRef(currentKey);
    const latestUrl = useRef(urlKey);
    const notify = useRef(onUrlChange);
    // Declared first, so it has run before either effect below reads the two refs.
    useEffect(() => {
        latestUrl.current = urlKey;
        notify.current = onUrlChange;
    });

    // The address bar moved on its own: follow it.
    useEffect(() => {
        if (urlKey === lastUrl.current) return;
        lastUrl.current = urlKey;
        if (urlKey === null) pushed.current = false;
        if (urlKey !== currentKey) notify.current(fromUrl);
        // `fromUrl` and `currentKey` are read at the moment the URL changes, not tracked.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlKey]);

    // The page opened, switched or closed a record: follow it into the address bar. Only a change
    // counts — on mount the page holds nothing yet, and a record arriving by link is the URL's to
    // hand over (above), not one to clear.
    useEffect(() => {
        if (currentKey === lastCurrent.current) return;
        lastCurrent.current = currentKey;
        if (currentKey === latestUrl.current) return;
        if (current === null) {
            if (pushed.current) {
                pushed.current = false;
                router.back();
            } else {
                router.replace(pathname as never);
            }
            return;
        }
        // The object form: expo-router drops a query written into a string href on the web.
        const href = { pathname, params: { [current.key]: current.id } };
        if (latestUrl.current === null) {
            pushed.current = true;
            router.push(href as never);
        } else {
            router.replace(href as never);
        }
        // Keyed on the record itself; the router and path are stable for one mounted page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentKey]);
}

function recordFromParams<K extends string>(
    keys: readonly K[],
    params: Readonly<Record<string, string | string[]>>,
): OpenRecord<K> | null {
    for (const key of keys) {
        const raw = params[key];
        const id = Array.isArray(raw) ? raw[0] : raw;
        if (id !== undefined && id !== '') return { key, id };
    }
    return null;
}
