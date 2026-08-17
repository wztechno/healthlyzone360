<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/driver/jobs — the caller's own outstanding runs, with enough on
 * each row to actually do one.
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
 * ## The telephone number is the one the order was given, and nothing else
 *
 * `orders.delivery_contact_point_id` names *which contact the courier was
 * handed at placement*; this resolves that row and serves its normalised value.
 * When the order names none — every order placed before the snapshot was
 * widened, and any address that never carried a contact — the answer is
 * **null**, and there is deliberately no fallback to "whatever number this
 * customer has today".
 *
 * Two reasons, and the second is the stronger. The snapshot answers *which
 * number was given*, and substituting a current one would answer a different
 * question while looking like the same field. And this route carries **no
 * permission code** — it is scoped by ownership, not authority — so resolving a
 * customer's best available number here would put a contact lookup behind a
 * gate that was never designed to hold one. The desk has
 * `order.view_customer_contact_organisation` for exactly that, and it is the
 * surface where somebody who cannot reach a customer goes.
 *
 * A `retired_at` contact is still served: a courier at the door needs the
 * number the order carried, and a number withdrawn from the customer's profile
 * an hour ago is more use than nothing.
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
 * **Scoped to the caller in the query, not filtered afterwards.** The
 * `where driver_user_id = me` *is* the isolation, on top of the organisation
 * scope the model applies and which fails closed.
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
        'cp.value_normalised as delivery_phone',
    ];

    public function __invoke(): JsonResponse
    {
        $userId = (string) auth()->id();

        $jobs = DeliveryJob::query()
            // `delivery_jobs.*` explicitly: both joins bring an `id` and a pair
            // of timestamps with them, and an unqualified `select *` would
            // hydrate a `DeliveryJob` whose primary key is an order's.
            ->select('delivery_jobs.*')
            ->addSelect(self::ORDER_COLUMNS)
            // An inner join would be the truer statement of the schema — the
            // foreign key is NOT NULL and cascades — but a left join is what
            // keeps a driver's whole sheet from disappearing if one order ever
            // fails to resolve. A row with no address is a job somebody can
            // still ring the kitchen about; a 200 with an empty list is a driver
            // who thinks their shift is over.
            ->leftJoin('orders', 'orders.id', '=', 'delivery_jobs.order_id')
            ->leftJoin('contact_points as cp', 'cp.id', '=', 'orders.delivery_contact_point_id')
            ->where('delivery_jobs.driver_user_id', $userId)
            ->whereNotIn('delivery_jobs.status', self::CLOSED_STATUSES)
            ->orderBy('delivery_jobs.created_at')
            ->get()
            ->map(fn (DeliveryJob $job): array => $this->row($job));

        return ApiResponse::data(['jobs' => $jobs]);
    }

    /**
     * @return array{
     *     id: string,
     *     order_id: string,
     *     order_number: string|null,
     *     status: string,
     *     tracking_status: string,
     *     assigned_at: string|null,
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
                // Which number the order was given, not which number the
                // customer has today. Null when the order named none.
                'phone' => $this->text($job, 'delivery_phone'),
            ],
        ];
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
