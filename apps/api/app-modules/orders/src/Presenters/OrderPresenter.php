<?php

declare(strict_types=1);

namespace Healthy360\Orders\Presenters;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Contracts\OrderPlanDays;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Models\OrderRefund;
use Healthy360\Orders\Services\OrderAmendability;
use Healthy360\Orders\Services\OrderWindowNames;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\DB;

/**
 * The two wire shapes of an order, built separately on purpose.
 *
 * **Neither shape is the other with fields removed.** `customer()` and
 * `kitchen()` construct their arrays independently, and the duplication is the
 * point — it is the same rule `CatalogueItemAdminPresenter` states about its
 * absent public projection. A narrow shape produced by unsetting keys from a
 * wide one is one careless refactor away from leaking: somebody adds a column
 * to the wide array, the subtraction list is not updated, and a price list
 * identifier appears on a receipt. Here, a new column reaches a customer only
 * if somebody writes it into the customer method, which is a decision rather
 * than an oversight.
 *
 * ## What a customer is never shown, and why each one
 *
 * * **`price_list_id`, `price_list_item_id`** — the snapshot's provenance.
 *   They exist so that "why was this the price?" is answerable a year later,
 *   and `OrderLine` classifies them `Internal` for exactly that reason. On a
 *   receipt they would name a kitchen's tariff structure to the person being
 *   charged by it — and on a B2B or agreement list, one customer's negotiated
 *   position is reconstructable from which list priced their line.
 * * **`organisation_id`** — the seller's internal key. The customer bought
 *   from a kitchen, not from a UUID, and an identifier is not an answer to
 *   "who cooked this". *That the customer-facing shape carries no kitchen
 *   identity at all is a stated gap*: naming the kitchen means a public
 *   projection of an organisation, which is M1's marketplace surface and not
 *   this slice's to invent.
 * * **`created_by`** — the user who transacted the placement. For a
 *   self-service order that is the customer themselves and says nothing; for
 *   an order placed by staff it names an employee to a member of the public.
 * * **`placed_on_behalf_by`** — the same disclosure, sharper. Where
 *   `created_by` merely *might* be an employee, this column is non-null on
 *   exactly the orders a member of staff took for somebody else, so serving it
 *   would name a named individual to the customer they served every single
 *   time. Who at the kitchen answered the telephone is the kitchen's own
 *   record of its own shift: it is what a manager reads to answer "who took
 *   this order", and a customer with a complaint has the kitchen to complain
 *   to, not an employee to identify. *`fulfilment_type` is served to both* and
 *   is the pair's counter-example — how the food reaches somebody is a term of
 *   their own order, and withholding it would leave a receipt with an empty
 *   delivery block and no reason for it.
 * * **`lock_version`** — the optimistic-concurrency validator of a resource
 *   the customer cannot write. Serving a validator with no writer is an
 *   invitation to send `If-Match` at an endpoint that would ignore it.
 * * **`branch_id`, `sales_channel_id`, `delivery_zone_id`** — where the food
 *   was made, which route to market took the money, and which slice of the
 *   delivery map the address fell into. All three are the kitchen's operating
 *   arrangements; none of them changes anything the customer can do.
 * * **`allergy`** — what they declared is already theirs on their own profile,
 *   and the note and the acknowledgement are the kitchen's working record.
 *
 * The **amounts are shown to both**, and that is not an oversight either.
 * `Order` classifies them `Internal` rather than `Confidential` because what
 * somebody was charged is printed on their own receipt; what the food *cost*
 * the kitchen is the confidential figure, and no column on either table carries
 * it.
 *
 * The **allergen list is shown to both**, exactly as `OrderPlacementService`
 * snapshotted it: code and containment, never the derivation or the source
 * ingredient. It is what the customer was told the food contains, and an order
 * line is the most likely row on the platform to be handed to a courier.
 *
 * ## The two payment shapes live here as well
 *
 * `paymentReceipt()` and `paymentSummary()` are kitchen-side shapes for an
 * order's money, and they are here rather than in a presenter of their own for
 * one reason: **two surfaces serve them and neither owns them.** The desk's
 * receipt endpoint returns both, and `OrderDeskPresenter` puts the summary on
 * every queue row. A shape defined at one of those two call sites would be
 * imported by the other, which is how a queue row and a receipt response start
 * disagreeing about what `receipted` means.
 *
 * Neither is a customer shape and neither ever will be. What a kitchen has been
 * paid is the kitchen's ledger; what the customer owes is their order total,
 * which the customer shape already carries.
 */
final class OrderPresenter
{
    /** @var array<string, list<array{slot: string, sequence: int, catalogue_item_id: string, source: string}>> order id → its plan day's meals, read ahead for a page */
    private array $planDays = [];

    /** @var array<string, array{remake_of: array{id: string, number: string}|null, cancelled_by_name: string|null}> order id → the order it remakes and who cancelled it, read ahead for a page */
    private array $remakes = [];

    public function __construct(
        private readonly OrderWindowNames $windows,
        private readonly OrderAmendability $amendability,
        private readonly OrderPlanDays $plans,
        private readonly AuditRecorder $audit,
        private readonly TenantContext $context,
    ) {}

    /**
     * Read the plan days of a whole page at once, so `kitchen()` for each row
     * asks nothing of its own.
     *
     * @param  list<string>  $orderIds
     */
    public function preloadPlanDays(array $orderIds): void
    {
        $found = $this->plans->forOrders($orderIds);

        foreach ($orderIds as $orderId) {
            $this->planDays[$orderId] = $found[$orderId] ?? [];
        }
    }

    /**
     * Read a whole page's remake links, and who cancelled each order, in one
     * query, so `kitchen()` for each row asks nothing of its own.
     *
     * A remake is the order a complaint placed (`order_complaints.remake_order_id`);
     * it links back to the order complained about. The name is the profile's,
     * joined as the cash report joins it: `LEFT`, and `user_profiles.user_id` is
     * unique, so neither join fans out (`remake_order_id` is unique too).
     *
     * @param  list<string>  $orderIds
     */
    public function preloadRemakes(array $orderIds): void
    {
        if ($orderIds === []) {
            return;
        }

        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";

        $found = DB::table('orders')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'orders.cancelled_by')
            ->leftJoin('order_complaints', 'order_complaints.remake_order_id', '=', 'orders.id')
            ->leftJoin('orders as original', 'original.id', '=', 'order_complaints.order_id')
            ->whereIn('orders.id', $orderIds)
            ->select(['orders.id', 'original.id as remake_of_id', 'original.order_number as remake_of_number'])
            ->selectRaw($name.' as cancelled_by_name')
            ->get()
            ->keyBy('id');

        foreach ($orderIds as $orderId) {
            $row = $found->get($orderId);

            $this->remakes[$orderId] = [
                'remake_of' => $row === null || $row->remake_of_id === null
                    ? null
                    : ['id' => (string) $row->remake_of_id, 'number' => (string) $row->remake_of_number],
                'cancelled_by_name' => $row === null || $row->cancelled_by_name === null ? null : (string) $row->cancelled_by_name,
            ];
        }
    }

    /**
     * The receipt.
     *
     * @param  iterable<int, OrderLine>  $lines
     * @param  array{status: string, tracking_status: string, driver_name: string|null, assigned_at: string|null, picked_up_at: string|null, delivered_at: string|null, failed_at: string|null, failure_reason: string|null, failure_note: string|null, courier_name: string|null}|null  $run  the order's delivery run, from `OrderDeliveryRuns`
     * @return array{
     *     id: string,
     *     order_number: string,
     *     status: string,
     *     currency_code: string,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     payment_method: string,
     *     fulfilment_type: string,
     *     delivery: array{
     *         label: string|null,
     *         line_one: string|null,
     *         line_two: string|null,
     *         city: string|null,
     *         area_name_en: string|null,
     *         area_name_ar: string|null,
     *         area_id: string|null,
     *         building: string|null,
     *         floor: string|null,
     *         apartment: string|null,
     *         directions: string|null,
     *         contact_point_id: string|null,
     *         window_code: string|null,
     *         window_name_en: string|null,
     *         window_name_ar: string|null,
     *         requested_date: string|null
     *     },
     *     placed_at: string,
     *     confirmed_at: string|null,
     *     preparing_at: string|null,
     *     ready_at: string|null,
     *     fulfilled_at: string|null,
     *     out_for_delivery_at: string|null,
     *     delivered_at: string|null,
     *     cancelled_at: string|null,
     *     cancellation_reason: string|null,
     *     line_count: int,
     *     lines: list<array{
     *         id: string,
     *         catalogue_item_id: string,
     *         catalogue_item_variant_id: string|null,
     *         name_en: string,
     *         name_ar: string,
     *         variant_label: string|null,
     *         quantity: string,
     *         unit_price_minor: int,
     *         line_total_minor: int,
     *         currency_code: string,
     *         allergens: list<array{allergen_code: string, containment: string}>,
     *         pack_summary: array<string, mixed>|null,
     *         options: list<array<string, string|null>>,
     *         note: string|null
     *     }>,
     *     created_at: string|null
     * }
     */
    public function customer(Order $order, iterable $lines, ?array $run = null): array
    {
        $presented = [];

        foreach ($lines as $line) {
            $presented[] = $this->customerLine($line);
        }

        return [
            'id' => (string) $order->getKey(),
            'order_number' => $order->order_number,
            'status' => $order->status->value,
            'currency_code' => $order->currency_code,
            'subtotal_minor' => $order->subtotal_minor,
            'delivery_fee_minor' => $order->delivery_fee_minor,
            'total_minor' => $order->total_minor,
            'payment_method' => $order->payment_method->value,
            // How their food reaches them is the customer's own fact — they
            // chose it, and a receipt that did not say whether it was being
            // delivered, collected or handed over at a counter would leave the
            // empty delivery block below unexplained.
            'fulfilment_type' => $order->fulfilment_type->value,
            'delivery' => [
                'label' => $order->delivery_label,
                'line_one' => $order->delivery_line_one,
                'line_two' => $order->delivery_line_two,
                'city' => $order->delivery_city,
                'area_name_en' => $order->delivery_area_name_en,
                'area_name_ar' => $order->delivery_area_name_ar,
                'area_id' => $order->delivery_area_id,
                // The rest of their own address, as it stood at placement. A
                // customer reading a receipt for a delivery that went to the
                // wrong floor needs to see which floor the order actually
                // carried, not which one their address book holds today.
                'building' => $order->delivery_building,
                'floor' => $order->delivery_floor,
                'apartment' => $order->delivery_apartment,
                'directions' => $order->delivery_directions,
                'contact_point_id' => $order->delivery_contact_point_id,
                'window_code' => $order->delivery_window_code,
                // The kitchen's own name for it, as checkout showed it (HA-22).
                'window_name_en' => $this->windows->for($order->organisation_id, $order->delivery_window_code)['en'] ?? null,
                'window_name_ar' => $this->windows->for($order->organisation_id, $order->delivery_window_code)['ar'] ?? null,
                'requested_date' => $order->requested_delivery_date?->toDateString(),
            ],
            'placed_at' => $order->placed_at->toIso8601String(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'preparing_at' => $order->preparing_at?->toIso8601String(),
            'ready_at' => $order->ready_at?->toIso8601String(),
            'fulfilled_at' => $order->fulfilled_at?->toIso8601String(),
            // The two moments of the drive that are the customer's to know
            // (HA-19): when the driver collected the food and when they handed
            // it over. Times only — who drove it is an employee's name, which
            // this shape never carries (see `placed_on_behalf_by` above). A
            // failed run has come back, so it is no longer out for delivery.
            'out_for_delivery_at' => ($run['status'] ?? null) === 'failed' ? null : ($run['picked_up_at'] ?? null),
            'delivered_at' => $run['delivered_at'] ?? null,
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $order->cancellation_reason?->value,
            'line_count' => count($presented),
            'lines' => $presented,
            'created_at' => $order->created_at?->toIso8601String(),
        ];
    }

    /**
     * A ticket as the line reads it: the same shape, no money and no street
     * address. Zeros and nulls rather than absent keys, so one contract serves
     * both audiences; the wall draws none of these fields. Every answer a cook
     * can reach goes through this: the wall, and the Start and Ready presses.
     *
     * @param  array<string, mixed>  $ticket
     * @return array<string, mixed>
     */
    public function forTheLine(array $ticket): array
    {
        /** @var array<string, mixed> $delivery */
        $delivery = $ticket['delivery'];

        /** @var list<array<string, mixed>> $lines */
        $lines = $ticket['lines'];

        return [
            ...$ticket,
            'subtotal_minor' => 0,
            'delivery_fee_minor' => 0,
            'total_minor' => 0,
            'delivery' => [
                ...$delivery,
                'line_one' => null,
                'line_two' => null,
                'building' => null,
                'floor' => null,
                'apartment' => null,
                'directions' => null,
                'contact_point_id' => null,
            ],
            'lines' => array_map(static fn (array $line): array => [
                ...$line,
                'unit_price_minor' => 0,
                'line_total_minor' => 0,
                'price_list_id' => null,
                'price_list_item_id' => null,
            ], $lines),
        ];
    }

    /**
     * The kitchen's book.
     *
     * `lock_version` is here because this is the audience that *writes*: the
     * confirm, fulfil and cancel actions all demand `If-Match`, and a screen
     * that could not read the validator could not send it.
     *
     * The delivery snapshot is served whole, including the street. It is
     * `Confidential` and it is also the address the food has to reach, so
     * withholding it from the kitchen would be privacy theatre performed on the
     * one party that needs the data to do the job.
     *
     * `amendable` is `OrderAmendability`'s answer: whether the Order Desk may
     * still edit this order. A list passes it in, worked out for the whole page
     * at once; a single order leaves it null and it is asked here.
     *
     * `allergy` is served to anyone who may open the order, because the cook is
     * the audience it was written for. It is `SpecialCategory`, so `allergy()`
     * records the read.
     *
     * @param  iterable<int, OrderLine>  $lines
     * @param  array{status: string, tracking_status: string, driver_name: string|null, assigned_at: string|null, picked_up_at: string|null, delivered_at: string|null, failed_at: string|null, failure_reason: string|null, failure_note: string|null, courier_name: string|null}|null  $run  the order's delivery run, from `OrderDeliveryRuns`
     * @return array{
     *     id: string,
     *     order_number: string,
     *     organisation_id: string,
     *     customer_account_id: string|null,
     *     sales_channel_id: string,
     *     branch_id: string|null,
     *     status: string,
     *     currency_code: string,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     payment_method: string,
     *     fulfilment_type: string,
     *     delivery: array{
     *         label: string|null,
     *         line_one: string|null,
     *         line_two: string|null,
     *         city: string|null,
     *         area_name_en: string|null,
     *         area_name_ar: string|null,
     *         area_id: string|null,
     *         zone_id: string|null,
     *         zone_name_en: string|null,
     *         zone_name_ar: string|null,
     *         building: string|null,
     *         floor: string|null,
     *         apartment: string|null,
     *         directions: string|null,
     *         contact_point_id: string|null,
     *         window_code: string|null,
     *         window_name_en: string|null,
     *         window_name_ar: string|null,
     *         requested_date: string|null,
     *         picked_up_at: string|null
     *     },
     *     placed_at: string,
     *     confirmed_at: string|null,
     *     preparing_at: string|null,
     *     ready_at: string|null,
     *     fulfilled_at: string|null,
     *     cancelled_at: string|null,
     *     cancellation_reason: string|null,
     *     cancellation_disposition: string|null,
     *     cancelled_by_name: string|null,
     *     remake_of: array{id: string, number: string}|null,
     *     delivery_run: array{status: string, tracking_status: string, driver_name: string|null, assigned_at: string|null, picked_up_at: string|null, delivered_at: string|null, failed_at: string|null, failure_reason: string|null, failure_note: string|null, courier_name: string|null}|null,
     *     created_by: string|null,
     *     placed_on_behalf_by: string|null,
     *     lock_version: int,
     *     amendable: bool,
     *     allergy: array{severe: bool, items: list<array{allergen_code: string, severity: string, notes: string|null, conflicts_with_line: list<string>}>, note: string|null, acknowledged_at: string|null}|null,
     *     line_count: int,
     *     lines: list<array{
     *         id: string,
     *         catalogue_item_id: string,
     *         catalogue_item_variant_id: string|null,
     *         name_en: string,
     *         name_ar: string,
     *         variant_label: string|null,
     *         quantity: string,
     *         unit_price_minor: int,
     *         line_total_minor: int,
     *         currency_code: string,
     *         allergens: list<array{allergen_code: string, containment: string}>,
     *         pack_summary: array<string, mixed>|null,
     *         options: list<array<string, string|null>>,
     *         note: string|null,
     *         price_list_id: string|null,
     *         price_list_item_id: string|null
     *     }>,
     *     plan_day: array{plan_line_id: string|null, meals: list<array{slot: string, sequence: int, catalogue_item_id: string, line_id: string|null, source: string}>}|null,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function kitchen(Order $order, iterable $lines, ?array $run = null, ?bool $amendable = null): array
    {
        $presented = [];
        $held = [];

        foreach ($lines as $line) {
            $held[] = $line;
            $presented[] = $this->kitchenLine($line);
        }

        $amendable ??= $this->amendability->reason($order, $held) === null;

        return [
            'id' => (string) $order->getKey(),
            'order_number' => $order->order_number,
            'organisation_id' => $order->organisation_id,
            'customer_account_id' => $order->customer_account_id,
            'sales_channel_id' => $order->sales_channel_id,
            'branch_id' => $order->branch_id,
            'status' => $order->status->value,
            'currency_code' => $order->currency_code,
            'subtotal_minor' => $order->subtotal_minor,
            'delivery_fee_minor' => $order->delivery_fee_minor,
            'total_minor' => $order->total_minor,
            'payment_method' => $order->payment_method->value,
            // The field that says what the whole delivery block below means. On
            // a pickup or a counter row the address is null by constraint, not
            // by omission, and a kitchen screen cannot tell "no address" from
            // "address not loaded" without being told which kind of order it is
            // reading.
            'fulfilment_type' => $order->fulfilment_type->value,
            'delivery' => [
                'label' => $order->delivery_label,
                'line_one' => $order->delivery_line_one,
                'line_two' => $order->delivery_line_two,
                'city' => $order->delivery_city,
                'area_name_en' => $order->delivery_area_name_en,
                'area_name_ar' => $order->delivery_area_name_ar,
                'area_id' => $order->delivery_area_id,
                'zone_id' => $order->delivery_zone_id,
                // Its name, so the kitchen reads "Inner city" rather than a code (HA-21).
                'zone_name_en' => $order->delivery_zone_id === null ? null : $order->deliveryZone?->name_en,
                'zone_name_ar' => $order->delivery_zone_id === null ? null : $order->deliveryZone?->name_ar,
                // The half of the snapshot a courier actually navigates by. The
                // street gets somebody to the building; the building, the
                // floor, the flat and the customer's own directions get them to
                // the door, and the contact point is the number to ring when
                // they still cannot find it.
                'building' => $order->delivery_building,
                'floor' => $order->delivery_floor,
                'apartment' => $order->delivery_apartment,
                'directions' => $order->delivery_directions,
                'contact_point_id' => $order->delivery_contact_point_id,
                'window_code' => $order->delivery_window_code,
                // The kitchen's own name for it, as checkout showed it (HA-22).
                'window_name_en' => $this->windows->for($order->organisation_id, $order->delivery_window_code)['en'] ?? null,
                'window_name_ar' => $this->windows->for($order->organisation_id, $order->delivery_window_code)['ar'] ?? null,
                'requested_date' => $order->requested_delivery_date?->toDateString(),
                // When a driver or a courier took it. Set means nobody can cancel
                // it any more, and every reader that decides that reads it here.
                'picked_up_at' => $run['picked_up_at'] ?? null,
            ],
            'placed_at' => $order->placed_at->toIso8601String(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'preparing_at' => $order->preparing_at?->toIso8601String(),
            'ready_at' => $order->ready_at?->toIso8601String(),
            'fulfilled_at' => $order->fulfilled_at?->toIso8601String(),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $order->cancellation_reason?->value,
            'cancellation_disposition' => $order->cancellation_disposition?->value,
            // Who pressed Cancel, by name; null for a system cancel.
            'cancelled_by_name' => $this->remakeFacts($order)['cancelled_by_name'],
            // The order a complaint's remake replaces, so the record links back to it.
            'remake_of' => $this->remakeFacts($order)['remake_of'],
            // The delivery run, when there is one (HA-19): who drove it and when
            // they were given it, collected it and handed it over. Null for a
            // pickup or counter order, and for a delivery order not yet
            // confirmed — a run is projected on confirm.
            'delivery_run' => $run,
            'created_by' => $order->created_by,
            // Provenance, and the kitchen's own record of its own shift. Null
            // on every self-service order, which is what makes it readable as
            // "a person at a desk took this" — `created_by` is written on every
            // path and answers a different question.
            'placed_on_behalf_by' => $order->placed_on_behalf_by,
            'lock_version' => $order->lock_version,
            // Whether the Order Desk may still edit it. The server decides, so
            // the button and the edit it leads to cannot disagree.
            'amendable' => $amendable,
            'allergy' => $this->allergy($order),
            'line_count' => count($presented),
            'lines' => $presented,
            'plan_day' => $this->planDay((string) $order->getKey(), $held),
            'created_at' => $order->created_at?->toIso8601String(),
            'updated_at' => $order->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{remake_of: array{id: string, number: string}|null, cancelled_by_name: string|null}
     */
    private function remakeFacts(Order $order): array
    {
        $orderId = (string) $order->getKey();

        if (! array_key_exists($orderId, $this->remakes)) {
            $this->preloadRemakes([$orderId]);
        }

        return $this->remakes[$orderId];
    }

    /**
     * What the kitchen must know about who is eating, or null when nothing was
     * declared and nothing noted.
     *
     * Health data read by staff: `requiresPurposeOfUse()` asks for an access event
     * stating why, and it is daily rather than per read because this shape is what
     * the kitchen display polls.
     *
     * @return array{severe: bool, items: list<array{allergen_code: string, severity: string, notes: string|null, conflicts_with_line: list<string>}>, note: string|null, acknowledged_at: string|null}|null
     */
    private function allergy(Order $order): ?array
    {
        if ($order->allergy_snapshot === null && $order->allergy_note === null) {
            return null;
        }

        $this->audit->recordAccessDaily(
            'order.allergy_read',
            PurposeOfUse::OrderFulfilment,
            DataClassification::SpecialCategory,
            $this->context->userId(),
            'order',
            (string) $order->getKey(),
        );

        return [
            'severe' => $order->hasSevereAllergy(),
            'items' => $order->allergy_snapshot ?? [],
            'note' => $order->allergy_note,
            'acknowledged_at' => $order->allergy_acknowledged_at?->toIso8601String(),
        ];
    }

    /**
     * Which meal of a subscription day went in which sitting — or null when the
     * order is not a plan day.
     *
     * Each meal points at the order's own line for that dish, so the name the
     * kitchen reads is the snapshot the order took. A dish chosen for two
     * sittings is one line of two, and both sittings point at it.
     *
     * @param  list<OrderLine>  $lines
     * @return array{plan_line_id: string|null, meals: list<array{slot: string, sequence: int, catalogue_item_id: string, line_id: string|null, source: string}>}|null
     */
    private function planDay(string $orderId, array $lines): ?array
    {
        if (! array_key_exists($orderId, $this->planDays)) {
            $this->preloadPlanDays([$orderId]);
        }

        $planLine = null;
        $mealLines = [];

        foreach ($lines as $line) {
            if ($line->price_source === PriceOverride::SUBSCRIPTION_CAPTURE) {
                $planLine = $line;
            } elseif ($line->price_source === PriceOverride::SUBSCRIPTION_INCLUDED) {
                $mealLines[$line->catalogue_item_id] = (string) $line->getKey();
            }
        }

        if (! $planLine instanceof OrderLine) {
            return null;
        }

        return [
            'plan_line_id' => (string) $planLine->getKey(),
            'meals' => array_map(static fn (array $meal): array => [
                ...$meal,
                'line_id' => $mealLines[$meal['catalogue_item_id']] ?? null,
            ], $this->planDays[$orderId] ?? []),
        ];
    }

    /**
     * One statement that money arrived.
     *
     * `method` is the receipt's own, which is **how the money turned up** and
     * deliberately not the order's `payment_method`, which is what was intended
     * at placement. An order taken for cash at the counter and settled by WISH
     * is a real evening; serving one of the two figures under the other's name
     * would make it unreadable.
     *
     * `confirmed_by` is served — the whole control on a WISH receipt is that a
     * named person asserted it, and a receipt whose asserter the reader cannot
     * see is an anonymous claim. It names a member of the kitchen's own staff to
     * the kitchen's own staff, which is the audience `OrderPresenter::kitchen()`
     * already shows `created_by` to.
     *
     * No `organisation_id`: a receipt is reachable only through an order that
     * `OrderQuery::forSeller()` has already scoped, so the field would restate
     * the caller's own organisation to itself.
     *
     * @return array{
     *     id: string,
     *     order_id: string,
     *     method: string,
     *     amount_minor: int,
     *     currency_code: string,
     *     reference: string|null,
     *     confirmed_by: string,
     *     confirmed_at: string,
     *     notes: string|null,
     *     created_at: string|null
     * }
     */
    public function paymentReceipt(OrderPaymentReceipt $receipt): array
    {
        return [
            'id' => (string) $receipt->getKey(),
            'order_id' => $receipt->order_id,
            'method' => $receipt->method->value,
            'amount_minor' => $receipt->amount_minor,
            'currency_code' => $receipt->currency_code,
            'reference' => $receipt->reference,
            'confirmed_by' => $receipt->confirmed_by,
            'confirmed_at' => $receipt->confirmed_at->toIso8601String(),
            'notes' => $receipt->notes,
            'created_at' => $receipt->created_at?->toIso8601String(),
        ];
    }

    /**
     * Where an order stands on being paid, in three fields.
     *
     * `$receivedMinor` is summed over the order's receipts by the caller and
     * handed in, never queried here: the desk queue derives it for a whole page
     * in one grouped statement, and a presenter that fetched its own would turn
     * two hundred rows into two hundred round trips.
     *
     * **`method` is the order's *intended* method**, not any receipt's. A queue
     * row is read before the money arrives — it is how the desk knows what to
     * ask the customer for — so the useful fact there is what the order was
     * taken on. What actually arrived is on the receipts, and the pair is only
     * legible while each one is served under its own name.
     *
     * **`receipted` rather than `paid`.** The word is doing real work: this
     * platform holds no proof that money exists, only that somebody at a desk
     * wrote down that it arrived. `>=` and not `==` because over-payment is
     * ordinary — a customer hands over a round note and takes change from the
     * till, which is not a row in this table — and a part payment leaves it
     * false until the balance lands.
     *
     * @return array{method: string, received_minor: int, receipted: bool}
     */
    public function paymentSummary(Order $order, int $receivedMinor): array
    {
        return [
            'method' => $order->payment_method->value,
            'received_minor' => $receivedMinor,
            'receipted' => $receivedMinor >= $order->total_minor,
        ];
    }

    /**
     * An order's refund ledger and where it stands. A name is null for a person
     * with no profile yet.
     *
     * @param  array{received_minor: int, refunded_minor: int, corrected_minor: int, pending_minor: int, refundable_minor: int, window_closes_at: CarbonImmutable|null}  $position
     * @param  EloquentCollection<int, OrderRefund>  $entries
     * @return array<string, mixed>
     */
    public function refundLedger(array $position, EloquentCollection $entries): array
    {
        $names = DB::table('user_profiles')
            ->whereIn('user_id', $entries->pluck('requested_by')->merge($entries->pluck('decided_by'))->filter()->unique()->values())
            ->selectRaw("user_id, nullif(trim(coalesce(given_name, '') || ' ' || coalesce(family_name, '')), '') as name")
            ->pluck('name', 'user_id');

        return [
            ...$position,
            'window_closes_at' => $position['window_closes_at']?->toIso8601String(),
            'entries' => $entries->map(fn (OrderRefund $entry): array => [
                'id' => (string) $entry->getKey(),
                'kind' => $entry->kind->value,
                'status' => $entry->status->value,
                'method' => $entry->method->value,
                'amount_minor' => $entry->amount_minor,
                'currency_code' => $entry->currency_code,
                'reason' => $entry->reason,
                'requested_by_name' => $names[$entry->requested_by] ?? null,
                'requested_at' => $entry->requested_at->toIso8601String(),
                'decided_by_name' => $entry->decided_by === null ? null : ($names[$entry->decided_by] ?? null),
                'decided_at' => $entry->decided_at?->toIso8601String(),
            ])->values()->all(),
        ];
    }

    /**
     * `quantity` is the decimal **string** the column holds, never coerced to a
     * number: it is the figure the line total was computed from, and a receipt
     * that rendered 0.35 kg as 0.34999999 would not reconcile against the
     * amount beside it.
     *
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     name_en: string,
     *     name_ar: string,
     *     variant_label: string|null,
     *     quantity: string,
     *     unit_price_minor: int,
     *     line_total_minor: int,
     *     currency_code: string,
     *     allergens: list<array{allergen_code: string, containment: string}>,
     *     pack_summary: array<string, mixed>|null,
     *     options: list<array<string, string|null>>,
     *     note: string|null
     * }
     */
    private function customerLine(OrderLine $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_id' => $line->catalogue_item_id,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'name_en' => $line->name_en,
            'name_ar' => $line->name_ar,
            'variant_label' => $line->variant_label,
            'quantity' => (string) $line->quantity,
            'unit_price_minor' => $line->unit_price_minor,
            'line_total_minor' => $line->line_total_minor,
            'currency_code' => $line->currency_code,
            'allergens' => $line->allergens,
            'pack_summary' => $line->pack_summary,
            'options' => $line->selected_options ?? [],
            'note' => $line->note,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     name_en: string,
     *     name_ar: string,
     *     variant_label: string|null,
     *     quantity: string,
     *     unit_price_minor: int,
     *     line_total_minor: int,
     *     currency_code: string,
     *     allergens: list<array{allergen_code: string, containment: string}>,
     *     pack_summary: array<string, mixed>|null,
     *     options: list<array<string, string|null>>,
     *     note: string|null,
     *     price_list_id: string|null,
     *     price_list_item_id: string|null
     * }
     */
    private function kitchenLine(OrderLine $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_id' => $line->catalogue_item_id,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'name_en' => $line->name_en,
            'name_ar' => $line->name_ar,
            'variant_label' => $line->variant_label,
            'quantity' => (string) $line->quantity,
            'unit_price_minor' => $line->unit_price_minor,
            'line_total_minor' => $line->line_total_minor,
            'currency_code' => $line->currency_code,
            'allergens' => $line->allergens,
            'pack_summary' => $line->pack_summary,
            'options' => $line->selected_options ?? [],
            'note' => $line->note,
            'price_list_id' => $line->price_list_id,
            'price_list_item_id' => $line->price_list_item_id,
        ];
    }
}
