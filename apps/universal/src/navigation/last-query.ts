/**
 * The query each listing was last seen with, so a "back up" link can return to the list as the
 * person left it — filters, search and compare selection — rather than to its bare path.
 *
 * Module memory on purpose: it is a convenience for this visit, and a fresh tab starting from the
 * bare listing is the right answer there.
 */
const lastQueries = new Map<string, string>();

/** Records `query` (without the leading `?`) as the last one `pathname` was shown with. */
export function rememberQuery(pathname: string, query: string): void {
    if (query === '') lastQueries.delete(pathname);
    else lastQueries.set(pathname, query);
}

/** The query `pathname` was last shown with, without the leading `?`, or `''`. */
export function lastQuery(pathname: string): string {
    return lastQueries.get(pathname) ?? '';
}

/** Test seam. */
export function forgetQueries(): void {
    lastQueries.clear();
}
