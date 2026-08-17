import type {
    DeliverDriverJobRequest,
    DriverJob,
    DriverJobsRepository,
} from '../contracts/driver-jobs.ts';
import type { DriverJob as WireDriverJob } from '../generated/types.ts';
import { mapDriverJob } from './driver-jobs-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The driver's run sheet, backed by the real Laravel routes under `/driver`.
 *
 * ## Two calls, one organisation header, no permission code
 *
 * Both routes sit inside `org.context` and neither carries a `permission:` middleware. The
 * narrowing that matters is `where driver_user_id = me`, enforced in the controllers — ownership
 * rather than authority. Nothing in this module can ask for anybody else's jobs, because neither
 * call takes a driver: the list has no parameters at all, and the write is scoped by the same
 * predicate before it looks at the identifier in the path.
 *
 * That is also why a job belonging to another driver answers `resource.not_found` rather than a
 * refusal — the endpoint declines to confirm the job exists. This module passes that through
 * untranslated; a screen that said "not yours" would leak exactly what the server withheld.
 *
 * ## Neither call is lock-versioned, and that is not an oversight here
 *
 * `kitchen-orders-repository.ts` sends `If-Match` on all three of its writes because an order's
 * lifecycle is a state machine several tablets race on. A delivery job has no `lock_version` on the
 * wire at all, and `deliver` is a stamp rather than a transition: it writes `delivered` over
 * whatever was there and answers the same thing the second time. So there is no validator to send
 * and no conflict to resolve, and a driver on a bad connection who taps twice gets one delivered
 * job rather than a `resource.conflict` they did nothing to earn.
 *
 * ## The write always sends the notes key
 *
 * `proof_of_delivery_notes` is replace-or-clear on the wire — omitting it writes `null`. Sending
 * `null` explicitly when the driver typed nothing is therefore the same request with one fewer way
 * to read it, and it keeps the two call shapes (`deliverJob(id)` and `deliverJob(id, { notes })`)
 * from meaning something the server does not honour.
 */
export function createApiDriverJobsRepository(transport: Transport): DriverJobsRepository {
    return {
        async listJobs(): Promise<readonly DriverJob[]> {
            const payload = await transport.request<{ readonly jobs: readonly WireDriverJob[] }>({
                method: 'GET',
                path: '/driver/jobs',
            });
            return payload.jobs.map(mapDriverJob);
        },

        async deliverJob(jobId: string, request: DeliverDriverJobRequest = {}): Promise<void> {
            await transport.request({
                method: 'POST',
                path: `/driver/jobs/${encodeURIComponent(jobId)}/deliver`,
                body: {
                    // See the header: the key is always present, `null` when nothing was typed.
                    proof_of_delivery_notes:
                        request.notes === undefined || request.notes.trim() === ''
                            ? null
                            : request.notes.trim(),
                },
            });
        },
    };
}
