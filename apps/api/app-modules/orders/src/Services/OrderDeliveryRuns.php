<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Tenancy\Scopes\OrganisationScope;

/**
 * Where each order's delivery run has got to, for the order's own readers.
 *
 * The order is a commercial record and the run is an operational one (see
 * `delivery_jobs`' house-standard migration); the customer's tracking page and
 * the kitchen's order page each need a little of the second to tell the first
 * honestly (HA-19): when the driver collected the food, when they handed it
 * over, and who drove it.
 *
 * **Read without the organisation scope, by order id, and only by order id.**
 * The customer's `/me/orders` carries no organisation context, and
 * `OrganisationScope` fails closed, so the scoped read would throw. Dropping the
 * scope is safe here because every caller has already proved the orders are the
 * reader's — `OrderLocator::customerOrder()` by ownership, the kitchen routes by
 * `forSeller()` — and a run belongs to exactly one order (`unique(order_id)`).
 *
 * One statement per page: the lists ask for a whole page of orders at once.
 */
final readonly class OrderDeliveryRuns
{
    /**
     * @param  array<int, string>  $orderIds
     * @return array<string, array{status: string, tracking_status: string, driver_name: string|null, assigned_at: string|null, picked_up_at: string|null, delivered_at: string|null}>
     */
    public function forOrders(array $orderIds): array
    {
        $orderIds = array_values(array_unique(array_filter($orderIds, static fn (string $id): bool => $id !== '')));

        if ($orderIds === []) {
            return [];
        }

        // The name a colleague is known by, as the desk's driver picker builds
        // it: "no profile" and a blank pair of names both become null.
        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";

        $rows = DeliveryJob::query()
            ->withoutGlobalScope(OrganisationScope::class)
            ->select('delivery_jobs.*')
            ->selectRaw($name.' as driver_name')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'delivery_jobs.driver_user_id')
            ->whereIn('delivery_jobs.order_id', $orderIds)
            ->get();

        $runs = [];

        foreach ($rows as $row) {
            $driverName = $row->getAttribute('driver_name');

            $runs[(string) $row->order_id] = [
                'status' => $row->status,
                'tracking_status' => $row->tracking_status,
                'driver_name' => is_string($driverName) ? $driverName : null,
                'assigned_at' => $row->assigned_at?->toIso8601String(),
                'picked_up_at' => $row->picked_up_at?->toIso8601String(),
                'delivered_at' => $row->delivered_at?->toIso8601String(),
            ];
        }

        return $runs;
    }

    /**
     * @return array{status: string, tracking_status: string, driver_name: string|null, assigned_at: string|null, picked_up_at: string|null, delivered_at: string|null}|null
     */
    public function forOrder(string $orderId): ?array
    {
        return $this->forOrders([$orderId])[$orderId] ?? null;
    }
}
