import { useState } from 'react';

/**
 * The current page of a numbered catalogue list, reset whenever the filter changes.
 *
 * The reset is the whole point of the hook. Without it, narrowing a filter while on page 7 asks the
 * backend for page 7 of a collection that now has two pages, and `OffsetPage::assertWithinRange`
 * answers `400 request.invalid` — correctly, since that page does not exist. The screen would show
 * an error state for what the reader experienced as typing into a search box.
 *
 * Answering that with an empty list instead was the alternative, and it is worse: a page control
 * would then walk forever past the end of a two-page list, and "no results" would be indis-
 * tinguishable from "you are past the results".
 *
 * ## Adjusted during render, not in an effect
 *
 * React's own guidance for "reset state when a prop changes", and what `react-hooks/set-state-in-
 * effect` enforces here. Setting it in an effect would render page 7 first, fire the query for a
 * page that does not exist, and only then correct itself — the 400 this hook exists to prevent
 * would happen anyway, just invisibly. Adjusting during render re-runs the component before
 * anything is committed, so the query is never issued for the stale page.
 *
 * `resetKey` is the filter object itself. The seven screens all build theirs in a `useMemo` over
 * the filter state, so its identity changes exactly when the filter does — which is also why it
 * must be memoised at the call site: a fresh object every render would pin the list to page 1.
 */
export function useListPage(resetKey: unknown): readonly [number, (page: number) => void] {
    const [page, setPage] = useState(1);
    const [appliedKey, setAppliedKey] = useState(resetKey);

    if (appliedKey !== resetKey) {
        setAppliedKey(resetKey);
        setPage(1);
        return [1, setPage];
    }

    return [page, setPage];
}
