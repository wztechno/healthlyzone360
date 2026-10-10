<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The one write that puts a driver on a run.
 *
 * Three callers: a dispatcher pressing Assign (`DeliveryJobAssignController`,
 * guarded by `If-Match`), the order desk naming a driver as it places a
 * delivery (`OrderDeskPlacementController`, on a job projected a moment ago),
 * and a driver claiming an unassigned run off the pool
 * (`DriverJobClaimController`, guarded by "nobody has it yet"). They differ only
 * in the guard folded into the `WHERE` and in the audit event, so those are the
 * two parameters, and the membership check, the columns written and the audit
 * shape are written once.
 *
 * The guard travels inside the `UPDATE` rather than being checked against a row
 * read a moment earlier — `OrderLifecycle::transition()`'s shape, and the reason
 * two dispatchers or two drivers cannot both win. Zero rows affected is returned
 * as `false`, and what that *means* (a stale validator, a run somebody else
 * took) is each caller's to say.
 *
 * `tracking_status` and the order are deliberately untouched — see
 * `DeliveryJobAssignController` for why naming a driver is not a customer
 * message and not a change to the sale.
 */
final readonly class DeliveryJobAssignment
{
    /**
     * The dispatch state a named driver puts a run into.
     */
    private const string ASSIGNED_STATUS = 'assigned';

    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * Give the job to the driver when `$guard` still holds.
     *
     * @param  array<string, string|int|null>  $guard  column → value, folded into the `WHERE`; a `null` value is `IS NULL`
     *
     * @throws ValidationException when the driver is not an active member here
     */
    public function assign(DeliveryJob $job, string $driverUserId, array $guard = [], string $event = 'delivery.job_assigned'): bool
    {
        $this->refuseOutsider($driverUserId);

        $assignedAt = CarbonImmutable::now();

        $updated = DeliveryJob::query()
            ->whereKey($job->getKey())
            ->where($guard)
            ->update([
                'driver_user_id' => $driverUserId,
                'assigned_at' => $assignedAt,
                'status' => self::ASSIGNED_STATUS,
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => $assignedAt,
            ]);

        if ($updated === 0) {
            return false;
        }

        $job->refresh();

        // After the write and outside any transaction of its own, matching
        // `OrderLifecycle`: the event describes something that has happened.
        // The subject is the **job**, because this is the delivery module's
        // decision about its own row.
        $this->audit->record(
            $event,
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_job',
            subjectId: (string) $job->getKey(),
            metadata: [
                'order_id' => $job->order_id,
                'driver_user_id' => $driverUserId,
                // Never `*_code`: the audit redactor blanks any key containing
                // `code`, and this is the field that says what the run became.
                'status' => $job->status,
                'lock_version' => $job->lock_version,
            ],
        );

        return true;
    }

    /**
     * A driver has to work here.
     *
     * `active`, not merely present: an invitation nobody accepted, a suspension
     * and an ended employment are all rows in `organisation_memberships`, and
     * none of them is somebody a kitchen can send out with its food. The read is
     * scoped by the ambient organisation through the model's global scope, so a
     * courier at the kitchen next door is refused on the same predicate as a
     * uuid that names nobody, and the message does not distinguish them.
     *
     * A `ValidationException` so the envelope is exactly what a form-request
     * rule would have produced: `validation.failed` with
     * `details.fields.driver_user_id`, on every caller.
     *
     * @throws ValidationException
     */
    private function refuseOutsider(string $driverUserId): void
    {
        $isMember = OrganisationMembership::query()
            ->where('user_id', $driverUserId)
            ->where('status', MembershipStatus::Active->value)
            ->exists();

        if ($isMember) {
            return;
        }

        throw ValidationException::withMessages([
            'driver_user_id' => 'That person is not an active member of this organisation, so this delivery cannot be given to them.',
        ]);
    }
}
