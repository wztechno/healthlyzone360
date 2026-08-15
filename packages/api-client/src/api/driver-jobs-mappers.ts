import { OrderId } from '@healthy360/domain-types';

import type { DriverJob } from '../contracts/driver-jobs.ts';
import type { DriverJob as WireDriverJob } from '../generated/types.ts';

/**
 * The run sheet's one wire shape, in domain terms.
 *
 * Its own file rather than a function at the top of `driver-jobs-repository.ts` — the naming follows
 * `kitchen-admin-mappers.ts` / `marketplace-mappers.ts` / `plan-mappers.ts`, and the split keeps the
 * repository about transport: paths, bodies and the one write.
 *
 * Both status fields are assigned straight across rather than narrowed or defaulted. The generated
 * unions *are* this contract's unions (`DRIVER_JOB_STATUSES` / `DRIVER_JOB_TRACKING_STATUSES` are
 * the same six and five values), so the compiler proves the vocabularies agree — and if the wire
 * ever gains a seventh dispatch state, this line fails to build, which is the correct place to
 * find out. A `?? 'pending'` fallback would turn that into a row silently claiming the job has not
 * started.
 */
export function mapDriverJob(wire: WireDriverJob): DriverJob {
    return {
        id: wire.id,
        orderId: OrderId.unsafe(wire.order_id),
        status: wire.status,
        trackingStatus: wire.tracking_status,
    };
}
