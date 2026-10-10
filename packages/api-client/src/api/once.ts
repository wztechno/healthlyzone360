/**
 * A lazily-run async load that every caller shares.
 *
 * The cache is the **promise**, not the result. Caching the result leaves a window between the
 * first call and its response in which every other caller also misses and fires the same request —
 * fourteen ingredient reads on the recipe editor made fourteen identical reference requests, and a
 * burst like that trips the API's per-user rate limit. Holding the pending promise closes the
 * window: concurrent callers await the one request, later callers get the settled value.
 *
 * A rejection is **not** kept. The stored promise is cleared when it rejects, so the next call
 * runs `load` again — one transient failure (a 429, a dropped connection) must not poison the
 * value for the rest of the session. Callers that were already awaiting still see the rejection.
 */
export function memoiseAsync<T>(load: () => Promise<T>): () => Promise<T> {
    let pending: Promise<T> | null = null;

    return () => {
        if (pending === null) {
            const attempt = load();
            pending = attempt;
            attempt.catch(() => {
                if (pending === attempt) pending = null;
            });
        }
        return pending;
    };
}

/**
 * `memoiseAsync` for each key: one shared load per key, held weakly so it lives exactly as long
 * as the key does. The kitchen catalogue keys its reference reads by transport, which is created
 * with the repositories and so already has the lifetime those caches should have.
 */
export function memoiseAsyncPer<K extends object, T>(
    load: (key: K) => Promise<T>,
): (key: K) => Promise<T> {
    const byKey = new WeakMap<K, () => Promise<T>>();

    return (key) => {
        let memo = byKey.get(key);
        if (memo === undefined) {
            memo = memoiseAsync(() => load(key));
            byKey.set(key, memo);
        }
        return memo();
    };
}
