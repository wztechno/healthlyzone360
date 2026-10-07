<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Concerns\ReadsPrecondition;
use Healthy360\Delivery\Http\Requests\AssignDeliveryJobRequest;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Delivery\Services\DeliveryJobAssignment;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/delivery/jobs/{job}/assign — this run is yours.
 *
 * The first endpoint that *changes* a delivery job. Everything before C3 either
 * read the table or was the driver stamping their own row delivered, which is
 * why the table had no `lock_version` until the migration beside this class
 * added one: assignment is the first write two people can race.
 *
 * ## Who may do it
 *
 * **`order.manage_organisation`**, not a new `delivery.*` code. Sending a driver
 * is the same authority as confirming the order that created the run — it is the
 * kitchen committing operational capacity to a sale it has already accepted —
 * and a separate code would mean a kitchen manager who may confirm an order and
 * cancel it cannot say who takes it out. The read side of this table stays
 * codeless (`org.context` alone) for the reason the routing table states: a
 * driver's run sheet is theirs by ownership. Deciding whose it is, is authority,
 * and it is the first thing on this table that is.
 *
 * `delivery_zone.manage_organisation` was the other candidate and is the wrong
 * one: that code governs the *map* — where a kitchen delivers and in which slots
 * — which is configuration a commercial manager owns and has nothing to do with
 * tonight's rota.
 *
 * ## The job is resolved through the tenant, and the tenant fails closed
 *
 * `DeliveryJob` is `OrganisationScoped`, so `whereKey()` here is already
 * `whereKey() AND organisation_id = <context>` and a job belonging to another
 * kitchen is simply absent — a `404`, never a `403`, because a `403` would
 * confirm that the identifier names something real. The scope throws rather than
 * silently unscoping when no organisation is published, which is why this route
 * carries `org.context` like every other reader of this table.
 *
 * ## `If-Match`, and why the conditional `UPDATE` rather than a re-read
 *
 * A dispatch board is a shared screen. Two dispatchers can be looking at the
 * same unassigned run and the same free driver, and without a validator the
 * second write silently wins: one driver is told about a job that is no longer
 * theirs, and the row remembers only the later decision.
 *
 * The version is folded into the `UPDATE`'s `WHERE` rather than checked against
 * a row read a moment earlier, which is `OrderLifecycle::transition()`'s shape
 * and for its reason — there is then **no window** between the check and the
 * write for the other dispatcher to land in. Zero rows affected means somebody
 * moved it, and the answer carries the current validator and the current state
 * so a client can re-render without a second round trip. A header that is
 * present but is not a Healthy360 validator is `400` (`ReadsPrecondition`), and
 * an absent one is `428` from the `precondition` middleware: three different
 * mistakes, three different answers.
 *
 * ## Re-assignment is permitted, on purpose
 *
 * A job that already has a driver may be assigned to another one, under a fresh
 * `If-Match`. **Drivers get sick**, vans break down, and a run that has been
 * handed to somebody who cannot do it is the single most likely reason anybody
 * opens this endpoint twice. Refusing would leave a dispatcher with no move
 * except to cancel a delivery the customer is still expecting.
 *
 * The validator is what makes that safe rather than sloppy: re-assigning
 * requires having read the job *since* it was last assigned, so the second
 * dispatcher is acting on the knowledge that it already has a driver rather than
 * discovering it afterwards. `assigned_at` is re-stamped, because the useful
 * question is when the person now holding it was given it; the audit trail keeps
 * every earlier answer.
 *
 * **Delivered and cancelled runs refuse**, `409` with the state they are in.
 * Assignment sets `status = assigned`, and applying that to a finished job would
 * produce a row that is simultaneously assigned and stamped `delivered_at` —
 * un-delivering a delivery nobody can un-deliver. "The driver is unwell" has no
 * meaning once the food is at the door; what happened there is a new order or a
 * refund, not a re-assignment.
 *
 * ## What is deliberately not written
 *
 * **`tracking_status` does not move.** The customer-facing vocabulary runs
 * `awaiting_assignment → picked_up → en_route → arrived → delivered`, and there
 * is no value between the first two — deliberately, per `DeliveryJob`: one
 * dispatch state may map to two customer messages, and *a driver has been named
 * but has not collected the food* is not a message a customer is owed. Moving it
 * to `picked_up` here would tell somebody their food had left the kitchen while
 * it was still on the pass. Minting a new tracking value is a wire-enum change
 * with a schema CHECK behind it, and it is not this endpoint's to make.
 *
 * **The order is not touched.** Not its status, not its `lock_version`. The run
 * is the delivery module's row and the sale is the orders module's; a dispatcher
 * naming a driver changes nothing a customer agreed to, and bumping the order's
 * validator would invalidate every desk screen holding it for a change none of
 * them can see. This is `DriverJobDeliverController`'s rule from the other end —
 * that endpoint stamps the job and never the order — and it holds in both
 * directions.
 */
final class DeliveryJobAssignController
{
    use ReadsPrecondition;

    /**
     * States from which there is nothing left to assign. Both are ends of the
     * line — one because the food arrived, one because the run was called off —
     * and neither is a place a fresh driver can be inserted into.
     *
     * @var list<string>
     */
    private const array TERMINAL_STATUSES = ['delivered', 'cancelled'];

    public function __construct(private readonly DeliveryJobAssignment $assignment) {}

    /**
     * @throws ApiException
     */
    public function __invoke(AssignDeliveryJobRequest $request, string $job): JsonResponse
    {
        $expected = $this->requiredLockVersion($request);
        $record = $this->job($job);

        $this->refuseTerminal($record);

        // The validator travels inside the `WHERE`, so the check and the write
        // are one statement and no second dispatcher can land between them.
        // `DeliveryJobAssignment` refuses an outsider driver (422) before it
        // writes and records `delivery.job_assigned` after.
        if (! $this->assignment->assign($record, $request->driverUserId(), ['lock_version' => $expected])) {
            $this->refuseStale($record);
        }

        return ApiResponse::data(['job' => $this->row($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }

    /**
     * One of this organisation's jobs, or nothing at all.
     *
     * The organisation predicate is the model's global scope rather than a
     * `where` written here, and that is the stronger version: there is no query
     * on this model that can forget it, because forgetting requires the explicit
     * `withoutTenancy()` bypass.
     *
     * @throws ApiException
     */
    private function job(string $id): DeliveryJob
    {
        $job = DeliveryJob::query()->whereKey($id)->first();

        if (! $job instanceof DeliveryJob) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $job;
    }

    /**
     * @throws ApiException
     */
    private function refuseTerminal(DeliveryJob $job): void
    {
        if (! in_array($job->status, self::TERMINAL_STATUSES, true)) {
            return;
        }

        throw new ApiException(
            ErrorCode::ResourceConflict,
            'This delivery job has finished and cannot be assigned to a driver.',
            [
                'status' => $job->status,
                'current_lock_version' => $job->lock_version,
            ],
        );
    }

    /**
     * Somebody moved it between the read and the write.
     *
     * The current state is re-read rather than taken from the model this request
     * loaded: the client is being told to re-render, and the figures it
     * re-renders from should be the ones that are true now. If the row has gone
     * entirely between the two reads — a cascade from a deleted order — the
     * request's own copy is the last true thing anybody knows about it, which is
     * a better answer than a conflict with no state in it.
     *
     * @throws ApiException
     */
    private function refuseStale(DeliveryJob $job): void
    {
        $current = DeliveryJob::query()->whereKey($job->getKey())->first() ?? $job;

        throw new ApiException(
            ErrorCode::ResourceConflict,
            'This delivery job changed while you were working on it. Reload it and try again.',
            [
                'status' => $current->status,
                'driver_user_id' => $current->driver_user_id,
                'current_lock_version' => $current->lock_version,
            ],
        );
    }

    /**
     * The dispatch board's shape, plus what the assignment just decided.
     *
     * `DeliveryJobIndexController` serves the first four fields and this serves
     * those plus `assigned_at` and `lock_version`, because a client that has
     * just written needs the validator for its next write and the moment for its
     * next render. It is a superset rather than a different shape, so a board
     * refreshing a single row from this response does not have to reconcile two
     * vocabularies.
     *
     * @return array{id: string, order_id: string, status: string, tracking_status: string, driver_user_id: string|null, assigned_at: string|null, lock_version: int}
     */
    private function row(DeliveryJob $job): array
    {
        return [
            'id' => (string) $job->getKey(),
            'order_id' => $job->order_id,
            'status' => $job->status,
            'tracking_status' => $job->tracking_status,
            'driver_user_id' => $job->driver_user_id,
            'assigned_at' => $job->assigned_at?->utc()->toIso8601String(),
            'lock_version' => $job->lock_version,
        ];
    }
}
