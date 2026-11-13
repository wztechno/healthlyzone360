<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderComplaint;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Models\OrderRefund;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Recording what went wrong with an order, and putting it right.
 *
 * **A remake is an order.** It goes through
 * {@see OrderPlacementService::placeComposed()}, the desk's own path, with every
 * line at {@see PriceOverride::REMAKE}, so it reaches the kitchen, the display and
 * the stock like any other and its food is accounted for. It is settled at the
 * complaint rather than at the till: the day and slot are not asked about again
 * (`enforceWindowOffer: false`, as subscription generation does), and the delivery
 * fee is waived because the customer has already paid to have it brought once.
 *
 * It keeps the original's options and notes, so a dish with no onions is remade
 * with no onions, and the original's allergy note. The conflict was told to the
 * customer on the first order, so it is acknowledged here.
 */
final readonly class OrderComplaints
{
    public function __construct(
        private OrderPlacementService $placement,
        private OrderLifecycle $lifecycle,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{cause: string, description?: string|null, cost_minor?: int|null}  $details
     */
    public function record(Order $order, array $details, string $actorId): OrderComplaint
    {
        $complaint = new OrderComplaint;
        $complaint->organisation_id = (string) $order->organisation_id;
        $complaint->order_id = (string) $order->getKey();
        $complaint->cause = $details['cause'];
        $complaint->description = $details['description'] ?? null;
        $complaint->cost_minor = $details['cost_minor'] ?? 0;
        $complaint->currency_code = $order->currency_code;
        $complaint->created_by = $actorId;
        $complaint->save();

        $this->audit->record('order.complaint_recorded', $actorId, 'order_complaint', (string) $complaint->getKey(), [
            'order_id' => (string) $order->getKey(),
            'cause' => $complaint->cause,
        ]);

        return $complaint;
    }

    /**
     * Change what is known about a complaint, and close it by giving an outcome.
     *
     * @param  array{cause?: string, description?: string|null, cost_minor?: int, outcome?: string|null, order_refund_id?: string|null}  $changes
     *
     * @throws ApiException when the refund named is not this order's
     */
    public function update(OrderComplaint $complaint, array $changes, string $actorId): OrderComplaint
    {
        if (isset($changes['order_refund_id'])) {
            $belongs = OrderRefund::query()
                ->whereKey($changes['order_refund_id'])
                ->where('order_id', $complaint->order_id)
                ->exists();

            if (! $belongs) {
                throw new ApiException(ErrorCode::ValidationFailed, 'That refund is not on this order.', ['parameter' => 'order_refund_id']);
            }
        }

        $complaint->fill(array_intersect_key($changes, array_flip(['cause', 'description', 'cost_minor', 'order_refund_id'])));

        if (array_key_exists('outcome', $changes)) {
            $complaint->outcome = $changes['outcome'];
            $complaint->closed_at = $changes['outcome'] === null ? null : CarbonImmutable::now();
            $complaint->closed_by = $changes['outcome'] === null ? null : $actorId;
        }

        $complaint->save();

        $this->audit->record('order.complaint_updated', $actorId, 'order_complaint', (string) $complaint->getKey(), [
            'outcome' => $complaint->outcome,
            'cost_minor' => $complaint->cost_minor,
        ]);

        return $complaint;
    }

    /**
     * Place the zero-priced order that puts it right, once, and close the complaint.
     *
     * @throws ApiException when it has been remade already, or a delivery has no address left to go to
     */
    public function remake(OrderComplaint $complaint, string $actorId): OrderComplaint
    {
        return DB::transaction(function () use ($complaint, $actorId): OrderComplaint {
            /** @var OrderComplaint $locked */
            $locked = OrderComplaint::query()->whereKey($complaint->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->remake_order_id !== null) {
                throw new ApiException(ErrorCode::ResourceConflict, 'This complaint has already been remade.');
            }

            /** @var Order $original */
            $original = Order::query()->whereKey($locked->order_id)->firstOrFail();

            $account = $original->customer_account_id === null
                ? null
                : CustomerAccount::query()->whereKey($original->customer_account_id)->first();

            $result = $this->placement->placeComposed(new ComposedPlacement(
                account: $account,
                address: $this->addressFor($original, $account),
                organisationId: (string) $original->organisation_id,
                salesChannelId: (string) $original->sales_channel_id,
                branchId: $original->branch_id,
                currencyCode: $original->currency_code,
                lines: array_values($original->lines()->get()->map(
                    static fn (OrderLine $line): ComposedLine => new ComposedLine(
                        catalogueItemId: $line->catalogue_item_id,
                        catalogueItemVariantId: $line->catalogue_item_variant_id,
                        quantity: (string) $line->quantity,
                        price: new PriceOverride(0, $line->currency_code, PriceOverride::REMAKE),
                        optionIds: array_column($line->selected_options ?? [], 'id'),
                        note: $line->note,
                    ),
                )->all()),
                deliveryWindowCode: $original->delivery_window_code,
                requestedDate: CarbonImmutable::now(),
                fulfilmentType: $original->fulfilment_type,
                placedOnBehalfBy: $actorId,
                paymentMethod: $original->fulfilment_type === FulfilmentType::Delivery ? PaymentMethod::CashOnDelivery : $original->payment_method,
                enforceWindowOffer: false,
                allergyNote: $original->allergy_note,
                allergenConflictsAcknowledged: true,
                waivesDeliveryFee: true,
            ));

            $remade = $this->lifecycle->confirm($result->order, $result->order->lock_version);

            $locked->remake_order_id = (string) $remade->getKey();
            $locked->outcome = 'remade';
            $locked->closed_at = CarbonImmutable::now();
            $locked->closed_by = $actorId;
            $locked->save();

            $this->audit->record('order.complaint_remade', $actorId, 'order_complaint', (string) $locked->getKey(), [
                'order_id' => (string) $original->getKey(),
                'remake_order_id' => (string) $remade->getKey(),
            ]);

            return $locked;
        });
    }

    /**
     * The saved address the original went to: the snapshot's row if it is still
     * there, or the customer's latest. The order keeps a copy of the address and
     * no link to it.
     *
     * @throws ApiException when a delivery has nowhere left to go
     */
    private function addressFor(Order $original, ?CustomerAccount $account): ?CustomerAddress
    {
        if ($original->fulfilment_type !== FulfilmentType::Delivery) {
            return null;
        }

        $saved = CustomerAddress::query()
            ->where('customer_account_id', $original->customer_account_id)
            ->where('address_type', CustomerAddressType::Delivery->value)
            ->orderByRaw('line_one = ? desc', [$original->delivery_line_one])
            ->orderByDesc('updated_at')
            ->first();

        if (! $saved instanceof CustomerAddress || ! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceConflict, 'The customer has no delivery address left to send the remake to. Place it from the order desk instead.');
        }

        return $saved;
    }
}
