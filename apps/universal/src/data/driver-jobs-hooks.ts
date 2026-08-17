import type { DriverJob } from '@healthy360/api-client/contracts';
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
 * delivery job has no `lock_version` on the wire, `deliverJob` is a stamp rather than a transition,
 * and the endpoint answers `{id, status}` with the status untyped. There is no second action to
 * prepare and nothing worth seeding, so the mutation invalidates the root and lets the list re-read
 * — which is what the screen wants anyway, since a delivered job leaves the run sheet.
 *
 * ## No conflict handling, because there is no conflict
 *
 * The same double tap that earns a `resource.conflict` on the order book is simply the same write
 * twice here, and the second one succeeds. That is the wire's stated behaviour and it is the right
 * one for a phone on a bad connection at somebody's front door. Nothing in this module retries on
 * the driver's behalf either — a failed stamp is shown, and the button is still there.
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
 * The caller's own live jobs, oldest first.
 *
 * No parameters and no key scope: the endpoint takes none, and the narrowing is
 * `driver_user_id = me` rather than anything a filter could express.
 */
export function useDriverJobsQuery(
    enabled = true,
    options: DriverJobsQueryOptions = {},
): UseQueryResult<readonly DriverJob[]> {
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

/** What the deliver dialog collects: which job, and whatever the driver typed as proof. */
export interface DeliverDriverJobCommand {
    readonly jobId: string;
    /** `undefined` clears the field — the wire is replace-or-clear. See the contract. */
    readonly notes?: string | undefined;
}

/** Stamps a job delivered, then re-reads the run sheet so the closed job leaves it. */
export function useDeliverDriverJobMutation(): UseMutationResult<
    void,
    unknown,
    DeliverDriverJobCommand
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (command: DeliverDriverJobCommand) =>
            repositories.driverJobs.deliverJob(command.jobId, { notes: command.notes }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.driverJobs.all() });
        },
    });
}
