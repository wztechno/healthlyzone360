<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Delivery\Enums\DeliveryFailureReason;
use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\FailedDelivery;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Enum;

/**
 * POST /api/v1/catalogue/orders/{order}/delivery/{courier,fail,redeliver,close-failed}.
 *
 * What the kitchen does about a run from the order's side. One controller, as
 * `ProductionOrderTransitionController` is one, because the four differ only in
 * what they ask for and every one answers the order.
 *
 * `courier` and `fail` take `order.manage_organisation` and no `If-Match`: they
 * write the run and leave the order alone, and the state of the run is the guard.
 * `redeliver` and `close-failed` are a manager's decision, take
 * `order.supervise_organisation`, and change the order, so they take the order's
 * validator.
 */
final class KitchenOrderDeliveryController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly FailedDelivery $deliveries,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
    ) {}

    /**
     * @throws ApiException
     */
    public function courier(Request $request, string $order): JsonResponse
    {
        /** @var array{name: string, reference?: string|null, fee_minor?: int|null} $validated */
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'reference' => ['nullable', 'string', 'max:120'],
            'fee_minor' => ['nullable', 'integer', 'min:0'],
        ]);

        $record = $this->locator->sellerOrder($order);

        $this->deliveries->handToCourier($record, $validated['name'], $validated['reference'] ?? null, $validated['fee_minor'] ?? null);

        return $this->respond($record);
    }

    /**
     * @throws ApiException
     */
    public function fail(Request $request, string $order): JsonResponse
    {
        /** @var array{reason: string, note?: string|null} $validated */
        $validated = $request->validate([
            'reason' => ['required', new Enum(DeliveryFailureReason::class)],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $record = $this->locator->sellerOrder($order);

        $this->deliveries->fail($record, DeliveryFailureReason::from($validated['reason']), $validated['note'] ?? null);

        return $this->respond($record);
    }

    /**
     * @throws ApiException
     */
    public function redeliver(Request $request, string $order): JsonResponse
    {
        /** @var array{date?: string|null, window?: string|null} $validated */
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d'],
            'window' => ['nullable', 'string', 'max:64'],
        ]);

        $date = $validated['date'] ?? null;

        return $this->respond($this->deliveries->redeliver(
            $this->locator->sellerOrder($order),
            $date === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $date)?->startOfDay(),
            $validated['window'] ?? null,
            $this->requiredLockVersion($request),
        ));
    }

    /**
     * @throws ApiException
     */
    public function closeFailed(Request $request, string $order): JsonResponse
    {
        /** @var array{disposition: string} $validated */
        $validated = $request->validate([
            'disposition' => ['required', new Enum(CancellationDisposition::class)],
        ]);

        return $this->respond($this->deliveries->closeFailed(
            $this->locator->sellerOrder($order),
            CancellationDisposition::from($validated['disposition']),
            $this->requiredLockVersion($request),
        ));
    }

    private function respond(Order $order): JsonResponse
    {
        $lines = $order->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($order, $lines, $this->runs->forOrder((string) $order->getKey()))])
            ->withHeaders(['ETag' => '"'.$order->lock_version.'"']);
    }
}
