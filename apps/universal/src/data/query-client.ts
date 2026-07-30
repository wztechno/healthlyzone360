import { asApiFailure } from '@healthy360/api-client';
import { QueryClient } from '@tanstack/react-query';

/** Failures that are the *answer*, not a hiccup. Repeating the request cannot change them. */
export const MAX_QUERY_RETRIES = 2;

export function shouldRetry(failureCount: number, error: unknown): boolean {
    const failure = asApiFailure(error);
    // An unrecognised error is treated as transport-level and retried; an `ApiFailure` is retried
    // only when it says so, which is false for every auth, context, validation and rate-limit code.
    if (failure !== null && !failure.retryable) return false;
    return failureCount < MAX_QUERY_RETRIES;
}

/**
 * The application's TanStack Query configuration.
 *
 * Two decisions worth stating:
 *
 * * **Mutations never retry automatically.** A retried `POST` is a second side effect, and the
 *   foundation has no idempotency keys on these endpoints (plan §14 restricts them to explicitly
 *   idempotent commands). Failed mutations surface to the user, who decides.
 * * **`refetchOnReconnect` is on.** Coming back from offline is exactly when cached data is most
 *   likely to be stale (05-universal-frontend.md §9).
 */
export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: shouldRetry,
                retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
                staleTime: 30_000,
                refetchOnReconnect: true,
                refetchOnWindowFocus: false,
            },
            mutations: {
                retry: false,
            },
        },
    });
}
