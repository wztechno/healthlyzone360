import type { OrderId } from '@healthy360/domain-types';

/**
 * A driver's own run sheet — the delivery jobs assigned to the signed-in person, and the one action
 * that closes them.
 *
 * ## Why this is not a filter on the dispatch board
 *
 * `/delivery/jobs` and `/driver/jobs` read the same table and answer different shapes, and the
 * difference is the point. The board is the organisation's — every driver's jobs, newest first,
 * capped at fifty — and it carries `driver_user_id` because the question it answers is "who has
 * this one?". The run sheet is one driver's, oldest first, and `driver_user_id` is deliberately
 * **absent** from it: it would say the same thing on every row, and that thing is "you".
 *
 * The narrowing is `where driver_user_id = me`, which is ownership rather than authority — which is
 * why the two driver routes carry no permission code at all, only `org.context`. Nothing on this
 * contract may be reached for somebody else's jobs, because there is no call shape that could ask.
 *
 * ## No cursor, no cap, no filters
 *
 * The wire offers none of the three, and that is a fit to the subject rather than an omission a
 * later version fills in: a run sheet is what one person can carry in a car this afternoon. A list
 * that needed paging would be a rota, not a run.
 *
 * `listJobs` therefore answers a plain array rather than a `CursorPage`, on the same terms as
 * `KitchenQuotationsRepository.listQuotations` — a `nextCursor: null` field would be a promise of
 * paging this endpoint cannot keep.
 *
 * ## Terminal jobs are simply not on it
 *
 * The endpoint excludes `delivered` and `cancelled`, so the run sheet empties itself as the run is
 * worked. Both values stay in {@link DRIVER_JOB_STATUSES} because they are the wire's vocabulary
 * and the mapper reads it literally — a narrower union here would be a second, quieter copy of the
 * server's filter, and the day the filter changes the two would disagree silently.
 *
 * ## Delivering is a stamp, not a transition
 *
 * There is no lock version on a delivery job and therefore no `If-Match` anywhere in this contract.
 * `deliverJob` writes `delivered` over whatever was there, twice if asked — the wire's own note
 * says a driver on a bad connection who taps again gets the same answer rather than a conflict. So
 * the action is idempotent by construction and nothing here re-reads before writing.
 *
 * It answers nothing worth keeping, which is why it answers `void`. The acknowledgement on the wire
 * is `{id, status}` with `status` typed as a bare string — not the enum — so mapping it into a
 * `DriverJob` would mean inventing three fields the server did not send and trusting a fourth it
 * did not type. The run sheet re-reads instead, and re-reading is what the screen wants anyway: the
 * delivered job leaves the list.
 */

/**
 * Dispatch state — where the job is in the organisation's process.
 *
 * `delivered` and `cancelled` are terminal and never appear on a run sheet (see the header); they
 * are here because this is the wire's enum, read whole.
 */
export const DRIVER_JOB_STATUSES = [
    'pending',
    'assigned',
    'in_transit',
    'delivered',
    'failed',
    'cancelled',
] as const;
export type DriverJobStatus = (typeof DRIVER_JOB_STATUSES)[number];

/**
 * What the customer would be told — a second axis rather than a finer {@link DriverJobStatus},
 * because "assigned but not yet collected" and "collected" are the same dispatch state and two
 * different customer messages. The driver's screen shows both for that reason: the first says what
 * the job *is*, the second says what somebody has already been promised about it.
 */
export const DRIVER_JOB_TRACKING_STATUSES = [
    'awaiting_assignment',
    'picked_up',
    'en_route',
    'arrived',
    'delivered',
] as const;
export type DriverJobTrackingStatus = (typeof DRIVER_JOB_TRACKING_STATUSES)[number];

export interface DriverJob {
    /**
     * The delivery job. Unbranded: no `DeliveryJobId` codec exists in `@healthy360/domain-types`,
     * and this identifier is never compared with, or substituted for, another kind — it is read
     * from a row and handed straight back to `deliverJob`. Same treatment as `KitchenOrderLine.id`.
     */
    readonly id: string;
    /**
     * The order being delivered. Branded, because this one *is* crossed with other surfaces — it is
     * the reference a driver reads out and the kitchen looks up.
     */
    readonly orderId: OrderId;
    readonly status: DriverJobStatus;
    readonly trackingStatus: DriverJobTrackingStatus;
}

/**
 * What a driver may attach when they close a job.
 *
 * **Replace-or-clear**, exactly as the wire has it: omitting the notes writes `null` over whatever
 * was there. There is no partial update of this field, so the repository always sends the key —
 * "leave it alone" is not something this endpoint can be asked for, and pretending otherwise here
 * would put a difference between the two call shapes that the server does not honour.
 */
export interface DeliverDriverJobRequest {
    /** Free text the driver typed as proof. Up to 1000 characters; `undefined` clears it. */
    readonly notes?: string | undefined;
}

export interface DriverJobsRepository {
    /** The caller's own live jobs, oldest first. Empty when there is nothing to run. */
    listJobs(): Promise<readonly DriverJob[]>;

    /**
     * Stamp a job delivered, optionally with proof-of-delivery notes.
     *
     * Idempotent and answers nothing — see the header. A job that is not the caller's is
     * `resource.not_found`, which is the same answer as a job that does not exist: the endpoint
     * declines to confirm that somebody else's job is out there.
     */
    deliverJob(jobId: string, request?: DeliverDriverJobRequest): Promise<void>;
}
