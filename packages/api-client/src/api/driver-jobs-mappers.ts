import { OrderId } from '@healthy360/domain-types';

import type { DriverJob, DriverJobDelivery } from '../contracts/driver-jobs.ts';
import type {
    DriverJobDelivery as WireDriverJobDelivery,
    DriverJob as WireDriverJob,
} from '../generated/types.ts';

/**
 * The run sheet's wire shapes, in domain terms.
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
 *
 * **Every nullable field keeps its null.** `order_number` is not defaulted to the order identifier,
 * and no address part is defaulted to an empty string: a job with no recorded floor and a job whose
 * floor is blank are the same absence, and inventing `''` for it would put a labelled empty line on
 * a screen somebody is reading in a stairwell. The screen decides what to draw for an absence; this
 * mapper only reports one.
 */
function mapDelivery(wire: WireDriverJobDelivery): DriverJobDelivery {
    return {
        lineOne: wire.line_one,
        building: wire.building,
        floor: wire.floor,
        apartment: wire.apartment,
        directions: wire.directions,
        areaNameEn: wire.area_name_en,
        areaNameAr: wire.area_name_ar,
        windowCode: wire.window_code,
        requestedDate: wire.requested_date,
        phone: wire.phone,
    };
}

export function mapDriverJob(wire: WireDriverJob): DriverJob {
    return {
        id: wire.id,
        orderId: OrderId.unsafe(wire.order_id),
        orderNumber: wire.order_number,
        status: wire.status,
        trackingStatus: wire.tracking_status,
        assignedAt: wire.assigned_at,
        delivery: mapDelivery(wire.delivery),
    };
}
