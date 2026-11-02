import type { DriverRunSheet, FailDeliveryRequest } from '@healthy360/api-client/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The driver run sheet's data access — one list and one write.
 *
 * The narrowest hook module in this folder, and the shape follows the contract's
 * (`api-client/src/contracts/driver-jobs.ts`): there is nothing to filter, nothing to page and no
 * detail read, because a run sheet is what one person can carry in a car this afternoon.
 *
 * ## Why the write invalidates and keeps nothing
 *
 * `kitchen-orders-hooks.ts` seeds each write's answer into the detail entry, because those rows are
 * lock-versioned and the next action needs a validator the server will accept. Nothing here is: a
 * delivery job has no `lock_version` on the wire, and the endpoint answers `{id, status}` with the
 * status untyped. There is no second action to
 * prepare and nothing worth seeding, so the mutation invalidates the root and lets the list re-read
 * — which is what the screen wants anyway, since a delivered job leaves the run sheet.
 *
 * ## A second tap is refused, and the run is already gone
 *
 * What the driver says they collected becomes a receipt, so a double tap's second write answers
 * `resource.conflict` and writes nothing. Nothing in this module retries on the driver's behalf
 * either — a failed write is shown, and the sheet re-reads.
 */

export { toFailure } from './hooks.ts';

export interface DriverJobsQueryOptions {
    /**
     * Poll cadence in milliseconds, or `false` for a list that only refetches when something asks
     * it to.
     *
     * The run sheet uses it for the reason the kitchen display does: a job assigned to a driver who
     * is already out is a job nobody would otherwise see until they thought to pull the list down,
     * and this client slice has no push channel to deliver it. The screen switches it off while the
     * device is offline — the case a delivery driver meets most — because an interval firing into a
     * dead network is retries nobody asked for.
     */
    readonly refetchInterval?: number | false | undefined;
}

/**
 * The caller's own live jobs, oldest first, and the unassigned pool beside them.
 *
 * No parameters and no key scope: the endpoint takes none, and the narrowing is
 * `driver_user_id = me` rather than anything a filter could express.
 */
export function useDriverJobsQuery(
    enabled = true,
    options: DriverJobsQueryOptions = {},
): UseQueryResult<DriverRunSheet> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.driverJobs.list(),
        enabled: enabled && repositories !== null,
        refetchInterval: options.refetchInterval ?? false,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.driverJobs.listJobs();
        },
    });
}

/**
 * Take a run from the unassigned pool, then re-read the sheet — on failure too, because the usual
 * failure is `resource.conflict` (somebody else took it) and the run should leave the pool either way.
 */
export function useClaimDriverJobMutation(): UseMutationResult<void, unknown, string> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (jobId: string) => repositories.driverJobs.claimJob(jobId),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.driverJobs.all() });
        },
    });
}

/**
 * "Picked up" — the driver has the food (HA-19). Re-reads the sheet on failure too: the usual one is
 * `resource.conflict` from a second tap, and the card should show where the run really stands. The
 * kitchen's lists are re-read because the order now reads "Out for delivery" there.
 */
export function usePickUpDriverJobMutation(): UseMutationResult<void, unknown, string> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (jobId: string) => repositories.driverJobs.pickUpJob(jobId),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.driverJobs.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
        },
    });
}

/** "Could not deliver". Re-reads on failure too, for the reason Picked up does. */
export function useFailDriverJobMutation(): UseMutationResult<
    void,
    unknown,
    FailDeliveryRequest & { readonly jobId: string }
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ jobId, ...request }: FailDeliveryRequest & { readonly jobId: string }) =>
            repositories.driverJobs.failJob(jobId, request),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.driverJobs.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
        },
    });
}

/** What the deliver dialog collects: which job, what was taken, and whatever the driver typed. */
export interface DeliverDriverJobCommand {
    readonly jobId: string;
    /** `undefined` on a WISH order, which asks nothing. */
    readonly collectedMinor?: number | undefined;
    readonly note?: string | undefined;
}

/**
 * Stamps a job delivered, then re-reads the run sheet so the closed job leaves it. The handover also
 * fulfils the order (BUG-10), so the kitchen's order lists and the desk are re-read too.
 */
export function useDeliverDriverJobMutation(): UseMutationResult<
    void,
    unknown,
    DeliverDriverJobCommand
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (command: DeliverDriverJobCommand) =>
            repositories.driverJobs.deliverJob(command.jobId, {
                collectedMinor: command.collectedMinor,
                note: command.note,
            }),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.driverJobs.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
        },
    });
}
