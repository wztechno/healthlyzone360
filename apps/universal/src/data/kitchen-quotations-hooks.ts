import type {
    KitchenQuotation,
    QuoteKitchenQuotationRequest,
} from '@healthy360/api-client/contracts';
import type { QuotationId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The kitchen's B2B quotation queue — a list, a detail read, and the one action that answers it.
 *
 * One hook per repository operation, same as `./kitchen-orders-hooks.ts`, and it inherits that
 * file's central constraint for the same reason: these rows are lock-versioned, so a screen here is
 * not free to invalidate and forget.
 *
 * ## Why the write seeds the detail entry *and* invalidates the root
 *
 * `quoteQuotation` answers the fresh quotation carrying the next `lockVersion`. Writing it straight
 * into `queryKeys.kitchenQuotations.quotation(id)` keeps the open panel holding a validator the
 * server will still accept — the same reason the order book does it, minus the second action: a
 * quoted quotation has no further move on this side, so the seed is what stops the panel showing a
 * stale `submitted` badge under a price it just named.
 *
 * The list is invalidated as well, because a row's status and its quoted timestamp both just
 * changed, and because another tablet's list is not this tablet's problem to patch.
 *
 * ## Conflicts and state refusals are not retried here
 *
 * `resource.conflict` means somebody re-read and re-priced this quotation between the screen's read
 * and its write; `b2b.quotation_state_invalid` means the **buyer** moved it — accepted, declined, or
 * let it expire — while the kitchen had it open. Neither resolves by asking again with the same
 * body, and a hook that refetched and retried would either overwrite somebody's prices or price a
 * quotation nobody is waiting on. Both are the caller's to surface.
 */

export { toFailure } from './hooks.ts';

/**
 * Every non-draft quotation submitted against this kitchen, newest first.
 *
 * No filter argument, because the endpoint takes none: there is one list, and the screen's status
 * filter narrows the rows it already holds. That keeps the cache honest — a filter in the key here
 * would imply a server-side view that does not exist.
 */
export function useKitchenQuotationsQuery(
    enabled = true,
): UseQueryResult<readonly KitchenQuotation[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenQuotations.list(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenQuotations.listQuotations();
        },
    });
}

/**
 * One quotation **with its lines**, which is the reason the detail panel cannot be rendered from a
 * list row: the index answers `lines: []` by the wire's own contract, and the lines are what is
 * being priced.
 *
 * `quotationId` is nullable so the slide-in can mount before anything is selected without the caller
 * writing its own `enabled` dance.
 */
export function useKitchenQuotationQuery(
    quotationId: QuotationId | null,
    enabled = true,
): UseQueryResult<KitchenQuotation> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenQuotations.quotation(quotationId ?? ('' as QuotationId)),
        enabled: enabled && quotationId !== null && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (quotationId === null) throw new Error('No quotation is selected.');
            return repositories.kitchenQuotations.getQuotation(quotationId);
        },
    });
}

/** `submitted → quoted`. Sends the `lockVersion` the caller read as `If-Match`. */
export function useQuoteQuotationMutation(): UseMutationResult<
    KitchenQuotation,
    unknown,
    QuoteKitchenQuotationRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: QuoteKitchenQuotationRequest) =>
            repositories.kitchenQuotations.quoteQuotation(request),
        onSuccess: (quotation: KitchenQuotation) => {
            queryClient.setQueryData(
                queryKeys.kitchenQuotations.quotation(quotation.id),
                quotation,
            );
            void queryClient.invalidateQueries({
                queryKey: queryKeys.kitchenQuotations.all(),
            });
        },
    });
}
