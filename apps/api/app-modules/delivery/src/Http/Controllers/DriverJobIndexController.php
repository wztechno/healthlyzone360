<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Carbon\CarbonImmutable;
use Closure;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/v1/driver/jobs — the caller's own outstanding runs, with enough on
 * each row to actually do one, and the unassigned pool beside them.
 *
 * ## Two lists, one row shape
 *
 * `jobs` is the caller's own live work. `available` is every projected run
 * nobody has been given yet — `driver_user_id IS NULL AND status = pending` —
 * which a driver may take with `POST /driver/jobs/{job}/claim`. There is no
 * driver role by design (see `OrderDeskDriverIndexController`), so any active
 * member who opens `/driver` sees the pool; the organisation scope on the model
 * is what keeps it to this kitchen. Both lists serve the same row, because a
 * driver deciding whether to claim a run needs to know where it is going.
 *
 * ## Why the row got wider
 *
 * Until C3 this served four identifiers and two status strings. That was
 * honest while nothing created delivery jobs and no driver client existed to
 * read them; it stopped being honest the moment `OrderLifecycle::confirm()`
 * started projecting real runs, because a courier holding `{id, order_id,
 * status}` cannot deliver anything. They would have to open a second screen per
 * job to find out where they were going — and there is no such screen on a
 * driver's build, so in practice they could not.
 *
 * So the row now carries what somebody standing next to a van needs: which
 * order this is by the number printed on the bag, where the food is going in
 * enough detail to find a door, when it was promised, when they were given it,
 * and the number to ring when they still cannot find the building.
 *
 * ## Read from the order's snapshot, never from the customer's address book
 *
 * Every delivery field here comes from `orders`, which took its copy at
 * placement. That is the whole point of the snapshot: a customer who edits
 * their address book at eight o'clock has not changed where tonight's delivery
 * is going, and a run sheet that joined the live address would send a driver to
 * a door the order was never for.
 *
 * `orders` is joined as a **table** rather than through
 * `Healthy360\Orders\Models\Order`, and deliberately. The module registry gives
 * Delivery edges to Support, ReferenceData, Organisations, Tenancy,
 * AccessControl and Audit — not to Orders — and a read-only join for a
 * projection is not the argument for opening one. `OrderDeskQueue::
 * contactsFor()` reads `contact_points` the same way and records the same
 * reasoning: two columns of a lookup is not a dependency, and a later slice that
 * needs more than a projection should open a **port** rather than inherit an
 * import nobody decided on.
 *
 * ## Who to ask for, and the number to ring
 *
 * A courier at a door they cannot find rings the customer, and asks for them
 * by name when somebody else answers. So the row carries the customer's name
 * and a number, the same pair the order desk shows beside the same order.
 *
 * The number prefers `orders.delivery_contact_point_id` — *which contact the
 * courier was handed at placement* — and falls back to the account's best live
 * phone when the order names none (every order placed before the snapshot was
 * widened, and every address that never carried a contact). The fallback uses
 * the order desk's ordering — primary, account-owned, proven, oldest — so the
 * desk and the driver name one number. This used to be a deliberate `null`;
 * in practice it left every desk order and most app orders reaching the driver
 * with no number at all, and a run sheet with no way to reach the customer is
 * worse than the narrower lookup it was protecting.
 *
 * A `retired_at` snapshot contact is still served: a courier at the door needs
 * the number the order carried, and a number withdrawn from the customer's
 * profile an hour ago is more use than nothing. The fallback, which is a
 * choice rather than a record, skips retired rows.
 *
 * The name is the account's `display_name`. There is no snapshot of it on the
 * order — `OrderDeskQueue::contactsForOrders()` records why — and a guest or an
 * anonymised account answers `null`.
 *
 * ## What is still deliberately absent
 *
 * `driver_user_id`. It would say the same thing on every row — the caller's own
 * id, which they already have — and the dispatch board is the surface where
 * whose job it is is a question worth answering. Money is absent for the same
 * class of reason: a driver collecting cash on delivery is a real flow, and it
 * is `order_payment_receipts`' to build when somebody builds it, not a total
 * bolted onto a run sheet.
 *
 * **Scoped in the query, not filtered afterwards.** `jobs`' `where
 * driver_user_id = me` *is* its isolation, on top of the organisation scope the
 * model applies and which fails closed.
 */
final class DriverJobIndexController
{
    /**
     * States a run has finished in. A driver's sheet is what is left to do.
     *
     * @var list<string>
     */
    private const array CLOSED_STATUSES = ['delivered', 'cancelled'];

    /**
     * The order's half of a run sheet row, aliased so the joined values land as
     * plain attributes on the hydrated job.
     *
     * Each entry is written `table.column as alias` rather than as an
     * associative array: Laravel's `addSelect()` only honours a string key when
     * the value is a sub-query, and a plain column would silently lose its
     * alias — the sort of failure that reads as "the join returned nothing".
     *
     * @var list<string>
     */
    private const array ORDER_COLUMNS = [
        'orders.order_number as order_number',
        'orders.delivery_line_one as delivery_line_one',
        'orders.delivery_building as delivery_building',
        'orders.delivery_floor as delivery_floor',
        'orders.delivery_apartment as delivery_apartment',
        'orders.delivery_directions as delivery_directions',
        'orders.delivery_area_name_en as delivery_area_name_en',
        'orders.delivery_area_name_ar as delivery_area_name_ar',
        'orders.delivery_window_code as delivery_window_code',
        'orders.requested_delivery_date as requested_delivery_date',
        'orders.ready_at as order_ready_at',
        'ca.display_name as customer_name',
    ];

    /**
     * The order's own contact, else the account's best live phone — in
     * `OrderDeskQueue::phoneRows()`'s ordering, so the desk and the driver name
     * one number. Both ownership arms, because a phone hangs off the account
     * or off the user behind it.
     */
    private const string PHONE_SQL = <<<'SQL'
        coalesce(cp.value_normalised, (
            select fallback.value_normalised
            from contact_points as fallback
            where fallback.channel = 'phone'
              and fallback.retired_at is null
              and (
                  fallback.customer_account_id = orders.customer_account_id
                  or (ca.user_id is not null and fallback.user_id = ca.user_id)
              )
            order by fallback.is_primary desc,
                     (fallback.customer_account_id is not null) desc,
                     (fallback.verified_at is not null) desc,
                     fallback.created_at,
                     fallback.id
            limit 1
        )) as delivery_phone
        SQL;

    public function __invoke(): JsonResponse
    {
        $userId = (string) auth()->id();

        return ApiResponse::data([
            'jobs' => $this->sheet(fn (Builder $query) => $query
                ->where('delivery_jobs.driver_user_id', $userId)
                ->whereNotIn('delivery_jobs.status', self::CLOSED_STATUSES)),
            // The unassigned pool: projected runs nobody has been given yet,
            // which any member here may claim (`DriverJobClaimController`) —
            // once the kitchen has marked the food ready (HA-28). A run is
            // projected on confirm, which for a scheduled order is days before
            // it is cooked; offering it then let a driver claim and "pick up"
            // food that did not exist yet.
            'available' => $this->sheet(fn (Builder $query) => $query
                ->whereNull('delivery_jobs.driver_user_id')
                ->where('delivery_jobs.status', 'pending')
                ->whereNotNull('orders.ready_at')),
        ]);
    }

    /**
     * One list of run-sheet rows, narrowed by `$narrow`.
     *
     * @param  Closure(Builder<DeliveryJob>): mixed  $narrow
     * @return array<int, array<string, mixed>>
     */
    private function sheet(Closure $narrow): array
    {
        $query = DeliveryJob::query()
            // `delivery_jobs.*` explicitly: both joins bring an `id` and a pair
            // of timestamps with them, and an unqualified `select *` would
            // hydrate a `DeliveryJob` whose primary key is an order's.
            ->select('delivery_jobs.*')
            ->addSelect(self::ORDER_COLUMNS)
            ->addSelect(DB::raw(self::PHONE_SQL))
            // An inner join would be the truer statement of the schema — the
            // foreign key is NOT NULL and cascades — but a left join is what
            // keeps a driver's whole sheet from disappearing if one order ever
            // fails to resolve. A row with no address is a job somebody can
            // still ring the kitchen about; a 200 with an empty list is a driver
            // who thinks their shift is over.
            ->leftJoin('orders', 'orders.id', '=', 'delivery_jobs.order_id')
            ->leftJoin('contact_points as cp', 'cp.id', '=', 'orders.delivery_contact_point_id')
            ->leftJoin('customer_accounts as ca', 'ca.id', '=', 'orders.customer_account_id');

        $narrow($query);

        return $query
            ->orderBy('delivery_jobs.created_at')
            ->get()
            ->map(fn (DeliveryJob $job): array => $this->row($job))
            ->all();
    }

    /**
     * @return array{
     *     id: string,
     *     order_id: string,
     *     order_number: string|null,
     *     status: string,
     *     tracking_status: string,
     *     assigned_at: string|null,
     *     picked_up_at: string|null,
     *     ready_at: string|null,
     *     delivery: array{
     *         line_one: string|null,
     *         building: string|null,
     *         floor: string|null,
     *         apartment: string|null,
     *         directions: string|null,
     *         area_name_en: string|null,
     *         area_name_ar: string|null,
     *         window_code: string|null,
     *         requested_date: string|null,
     *         customer_name: string|null,
     *         phone: string|null
     *     }
     * }
     */
    private function row(DeliveryJob $job): array
    {
        return [
            'id' => (string) $job->getKey(),
            'order_id' => $job->order_id,
            'order_number' => $this->text($job, 'order_number'),
            'status' => $job->status,
            'tracking_status' => $job->tracking_status,
            'assigned_at' => $job->assigned_at?->utc()->toIso8601String(),
            'picked_up_at' => $job->picked_up_at?->utc()->toIso8601String(),
            // When the kitchen marked the food ready; the driver's Picked up
            // waits for it (HA-28).
            'ready_at' => $this->instant($job, 'order_ready_at'),
            'delivery' => [
                'line_one' => $this->text($job, 'delivery_line_one'),
                // The half of the snapshot a courier navigates by: the street
                // gets them to the building, and these get them to the door.
                'building' => $this->text($job, 'delivery_building'),
                'floor' => $this->text($job, 'delivery_floor'),
                'apartment' => $this->text($job, 'delivery_apartment'),
                'directions' => $this->text($job, 'delivery_directions'),
                'area_name_en' => $this->text($job, 'delivery_area_name_en'),
                'area_name_ar' => $this->text($job, 'delivery_area_name_ar'),
                'window_code' => $this->text($job, 'delivery_window_code'),
                'requested_date' => $this->date($job, 'requested_delivery_date'),
                // Who to ask for at the door. Null for a guest or an
                // anonymised account.
                'customer_name' => $this->text($job, 'customer_name'),
                // The number the order was given, else the account's best
                // live one. Null only when the customer has no phone at all.
                'phone' => $this->text($job, 'delivery_phone'),
            ],
        ];
    }

    /**
     * A joined timestamp column as ISO 8601 UTC, or null.
     */
    private function instant(DeliveryJob $job, string $attribute): ?string
    {
        $value = $job->getAttribute($attribute);

        if ($value === null || $value === '') {
            return null;
        }

        return CarbonImmutable::parse((string) $value)->utc()->toIso8601String();
    }

    /**
     * A joined column as a string, or null.
     *
     * The joined values arrive as raw attributes on a model that has no casts
     * for them, so they are strings or nulls. Normalising here keeps every
     * branch of "the order did not resolve" and "the column is empty" answering
     * `null`, which is the one thing a client can render.
     */
    private function text(DeliveryJob $job, string $attribute): ?string
    {
        $value = $job->getAttribute($attribute);

        if (! is_scalar($value)) {
            return null;
        }

        $string = (string) $value;

        return $string === '' ? null : $string;
    }

    /**
     * `requested_delivery_date` is a date on `orders` and an uncast attribute
     * here, so it arrives as whatever the driver hands back — `2026-05-10` on
     * PostgreSQL, occasionally with a time appended. Parsed and re-rendered so
     * the wire carries a plain date exactly as `OrderPresenter` serves it.
     */
    private function date(DeliveryJob $job, string $attribute): ?string
    {
        $value = $this->text($job, $attribute);

        return $value === null ? null : CarbonImmutable::parse($value)->toDateString();
    }
}
