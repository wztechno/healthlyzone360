<?php

declare(strict_types=1);

namespace Healthy360\Orders\Jobs;

use Carbon\CarbonImmutable;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Orders\Services\UnacceptedOrderClock;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Chase the orders nobody has accepted: the managers first, then the owner.
 *
 * The clock is {@see UnacceptedOrderClock}, the same one that turns a ticket red
 * on the wall, so it counts only while a kitchen is open and an order placed at
 * 02:00 wakes nobody. The limits are the kitchen's own settings.
 *
 * **Every minute, and safe to repeat.** A recipient's row is unique on the order
 * and the alert ({@see StaffAlerts}), so a run that finds the same late order
 * again writes nothing and mails nobody.
 *
 * **Which kitchens is read without a tenant, on purpose.** Neither `orders` nor
 * `organisations` carries a row-level security policy, so this one question works
 * with no context. Everything else does not: run as the application role with no
 * context a policy returns zero rows without complaint, so each kitchen is worked
 * inside its own `during()`, as `RetryOpenConsumptionExceptions` does.
 *
 * **One kitchen's failure is reported and goes no further.** Throwing would stop
 * the alarm for every kitchen after it, every minute, until somebody noticed.
 */
final class EscalateUnacceptedOrders implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(
        DatabaseTenantContext $database,
        TenantContext $context,
        OrderQuery $orders,
        UnacceptedOrderClock $clock,
        KitchenServiceSettingsLookup $settings,
        StaffAlerts $alerts,
    ): void {
        $ambient = $context->toArray();
        $now = CarbonImmutable::now();

        try {
            foreach ($this->tradingKitchensWithPlacedOrders() as $organisationId) {
                try {
                    $database->during(null, $organisationId, null, function () use ($context, $orders, $clock, $settings, $alerts, $organisationId, $now): void {
                        $context->restore(['user_id' => null, 'organisation_id' => $organisationId, 'branch_id' => null]);

                        $placed = $orders->forSeller($organisationId)
                            ->where('status', OrderStatus::Placed->value)
                            ->with('deliveryZone')
                            ->get();

                        $openMinutes = $clock->openMinutes($organisationId, $placed, $now);
                        $limits = $settings->for($organisationId);

                        foreach ($placed as $order) {
                            $minutes = $openMinutes[(string) $order->getKey()];

                            if ($minutes >= $limits->manager_alert_after_minutes) {
                                $alerts->send(StaffAlertType::UnacceptedManager, $organisationId, (string) $order->getKey(), $this->alertData($order));
                            }

                            if ($minutes >= $limits->owner_alert_after_minutes) {
                                $alerts->send(StaffAlertType::UnacceptedOwner, $organisationId, (string) $order->getKey(), $this->alertData($order));
                            }
                        }
                    });
                } catch (Throwable $e) {
                    report($e);
                }
            }
        } finally {
            $context->restore($ambient);
        }
    }

    /**
     * @return list<string>
     */
    private function tradingKitchensWithPlacedOrders(): array
    {
        return Organisation::query()
            ->whereIn('id', Order::query()->where('status', OrderStatus::Placed->value)->select('organisation_id'))
            ->orderBy('id')
            ->get(['id', 'status'])
            ->filter(static fn (Organisation $organisation): bool => $organisation->status->isTrading())
            ->map(static fn (Organisation $organisation): string => (string) $organisation->getKey())
            ->values()
            ->all();
    }

    /**
     * @return array{order_number: string, total_minor: int, currency_code: string, severe: bool}
     */
    private function alertData(Order $order): array
    {
        return [
            'order_number' => $order->order_number,
            'total_minor' => $order->total_minor,
            'currency_code' => $order->currency_code,
            'severe' => $order->hasSevereAllergy(),
        ];
    }
}
