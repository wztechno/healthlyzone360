import type {
    DeliverDriverJobRequest,
    DriverJobsRepository,
    DriverRunSheet,
    FailDeliveryRequest,
} from '../contracts/driver-jobs.ts';
import type { DriverJob as WireDriverJob } from '../generated/types.ts';
import { mapDriverJob } from './driver-jobs-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The driver's run sheet, backed by the real Laravel routes under `/driver`.
 *
 * ## Three calls, one organisation header, no permission code
 *
 * All three routes sit inside `org.context` and none carries a `permission:` middleware. The
 * narrowing that matters is `where driver_user_id = me`, enforced in the controllers — ownership
 * rather than authority. Nothing in this module can ask for anybody else's jobs, because no call
 * takes a driver: the list has no parameters at all, `deliver` is scoped by the same predicate
 * before it looks at the identifier in the path, and `claim` can only ever name the caller — and
 * only on a run nobody holds, which the server checks inside the write (`409` when it lost).
 *
 * That is also why a job belonging to another driver answers `resource.not_found` rather than a
 * refusal — the endpoint declines to confirm the job exists. This module passes that through
 * untranslated; a screen that said "not yours" would leak exactly what the server withheld.
 *
 * ## Neither call is lock-versioned, and that is not an oversight here
 *
 * `kitchen-orders-repository.ts` sends `If-Match` on all three of its writes because an order's
 * lifecycle is a state machine several tablets race on. A delivery job has no `lock_version` on the
 * wire at all: the guard on `deliver` is that the run is still open, so a driver on a bad connection
 * who taps twice writes one receipt and has the second tap answered `resource.conflict`.
 */
/** The note left out when blank, on the driver's route and the kitchen's alike. */
export function failureBody(request: FailDeliveryRequest): Record<string, unknown> {
    return {
        reason: request.reason,
        ...(request.note === undefined || request.note.trim() === ''
            ? {}
            : { note: request.note.trim() }),
    };
}

export function createApiDriverJobsRepository(transport: Transport): DriverJobsRepository {
    return {
        async listJobs(): Promise<DriverRunSheet> {
            const payload = await transport.request<{
                readonly jobs: readonly WireDriverJob[];
                readonly available: readonly WireDriverJob[];
            }>({
                method: 'GET',
                path: '/driver/jobs',
            });
            return {
                jobs: payload.jobs.map(mapDriverJob),
                available: payload.available.map(mapDriverJob),
            };
        },

        async claimJob(jobId: string): Promise<void> {
            await transport.request({
                method: 'POST',
                path: `/driver/jobs/${encodeURIComponent(jobId)}/claim`,
            });
        },

        async pickUpJob(jobId: string): Promise<void> {
            await transport.request({
                method: 'POST',
                path: `/driver/jobs/${encodeURIComponent(jobId)}/pick-up`,
            });
        },

        async deliverJob(jobId: string, request: DeliverDriverJobRequest = {}): Promise<void> {
            await transport.request({
                method: 'POST',
                path: `/driver/jobs/${encodeURIComponent(jobId)}/deliver`,
                body: {
                    ...(request.collectedMinor === undefined
                        ? {}
                        : { collected_minor: request.collectedMinor }),
                    ...(request.note === undefined || request.note.trim() === ''
                        ? {}
                        : { note: request.note.trim() }),
                },
            });
        },

        async failJob(jobId: string, request: FailDeliveryRequest): Promise<void> {
            await transport.request({
                method: 'POST',
                path: `/driver/jobs/${encodeURIComponent(jobId)}/fail`,
                body: failureBody(request),
            });
        },
    };
}
