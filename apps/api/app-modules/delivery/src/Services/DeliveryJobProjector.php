<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Contracts\DeliveryJobProjection;
use Healthy360\Orders\Models\Order;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * A confirmed delivery order becomes a run somebody has to drive (C3).
 *
 * The real answer to the orders module's `DeliveryJobProjection` port, bound
 * over its null default by `DeliveryServiceProvider::boot()`. Orders decides
 * *when* — inside `confirm()`'s transaction, and only for
 * `FulfilmentType::Delivery` — and this decides *what*: one row on the module's
 * own table, in the state a job starts in.
 *
 * ## The state a job starts in
 *
 * `status = pending` and `tracking_status = awaiting_assignment`, which are the
 * column defaults written explicitly rather than left to the database. The two
 * columns are two audiences (see `DeliveryJob`): pending is what a dispatcher
 * sees — nothing has been done with this yet — and awaiting-assignment is what a
 * customer would be told. Naming them here means the row this class produces and
 * the row a reader of this class expects are the same row, and a later change to
 * a column default cannot silently move the state a job is born in.
 *
 * The branch is copied from the order. It is nullable on both tables and
 * legitimately null on either: an order placed with no production site named
 * produces a job with none, and a dispatcher assigns from the organisation's
 * whole driver pool rather than from a branch's.
 *
 * ## Idempotent through the constraint, never through a read
 *
 * The port's contract is that projecting twice creates one job, because the
 * closure this runs inside re-runs on a retried confirm. That guarantee is taken
 * from `delivery_jobs`' unique index on `order_id` and a catch on SQLSTATE
 * **23505**, not from `exists()`-then-`create()`: a check and a write with a gap
 * between them is a race that two confirms arriving together would lose, and the
 * database is the only party that can answer "is there already one" at the
 * instant of the write.
 *
 * This is `GenerationService::claim()`'s trick verbatim, and its comment applies
 * word for word — *"Losing this race is an expected outcome, not a fault, and
 * matched on the SQLSTATE rather than the message for the reason
 * `OrderIdempotency` gives."* Any other SQLSTATE is re-thrown: a foreign key
 * that does not resolve or a CHECK that refuses the status is a real fault, and
 * swallowing every `QueryException` here would turn a broken projection into a
 * confirm that quietly dispatches nobody.
 *
 * ## The nested transaction is the whole reason this does not poison a confirm
 *
 * The insert is wrapped in `DB::transaction()` even though it is a single
 * statement, and that is not ceremony. This runs inside the transaction
 * `OrderLifecycle::transition()` opened, and in PostgreSQL **any** error aborts
 * the enclosing transaction — every subsequent statement then fails with
 * *current transaction is aborted* until a rollback. A nested `DB::transaction`
 * is a `SAVEPOINT`, so a 23505 unwinds to the savepoint and the confirm carries
 * on. Without it, the second confirm of an already-projected order would take
 * the whole transition down with it, which is exactly the case this class exists
 * to survive.
 *
 * ## No ambient tenant is assumed
 *
 * `organisation_id` is set from the order rather than left to
 * `BelongsToOrganisation`'s auto-fill, and nothing here reads through the
 * organisation scope. `OrderConsumptionService` takes the same care for the same
 * reason: a confirm can arrive from a console command or a queued job with no
 * `TenantContext` published, and a fail-closed scope would turn that into a
 * `MissingTenantContext` on an order that is otherwise perfectly confirmable.
 * The order already names its seller, and it is the more trustworthy source
 * anyway — a job belongs to the kitchen that sold the food, never to whichever
 * organisation happened to be in context.
 */
final class DeliveryJobProjector implements DeliveryJobProjection
{
    /**
     * The dispatch state a run is born in: nobody has looked at it yet.
     */
    private const string INITIAL_STATUS = 'pending';

    /**
     * What a customer would be told at that moment.
     */
    private const string INITIAL_TRACKING_STATUS = 'awaiting_assignment';

    public function project(Order $order): void
    {
        try {
            DB::transaction(function () use ($order): void {
                $job = new DeliveryJob;
                $job->organisation_id = $order->organisation_id;
                $job->order_id = (string) $order->getKey();
                $job->branch_id = $order->branch_id;
                $job->status = self::INITIAL_STATUS;
                $job->tracking_status = self::INITIAL_TRACKING_STATUS;
                $job->save();
            });
        } catch (QueryException $exception) {
            // 23505 — unique violation on `order_id`. This order already has a
            // run, which is the expected outcome of a retried confirm rather
            // than a fault, and it is matched on the SQLSTATE rather than the
            // message for the reason `OrderIdempotency` gives.
            if ($exception->getCode() !== '23505') {
                throw $exception;
            }
        }
    }
}
