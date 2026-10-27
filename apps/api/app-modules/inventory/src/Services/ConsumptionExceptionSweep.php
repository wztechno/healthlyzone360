<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Retries every open stock gap a kitchen has, without anybody pressing Retry.
 *
 * A gap stays open until the deduction it blocked runs again. That used to wait
 * for a person, who had to notice the stock had arrived, the recipe had been
 * published or the branch had been opened, and come back to press Retry. Nothing
 * a person adds by pressing it — {@see OrderConsumptionService::retry()} takes no
 * input but the gap — so the system presses it instead: right after stock rises
 * on any shelf, and on a schedule for every other kind of fix.
 *
 * ## One retry per order line
 *
 * A retry re-runs the whole line and reconciles every gap open on it, so a line
 * with six short ingredients is re-run once, not six times. An order-level gap
 * (`no_branch`, no line) re-runs every line of its order.
 *
 * ## What is left out
 *
 * - **`no_ingredient_cost`.** It records a deduction that already happened at no
 *   cost; a retry cannot re-value an append-only ledger, so it never settles one
 *   and would only rewrite its detail on every pass.
 * - **A cancelled order.** Its stock was put back on cancellation; a retry would
 *   take it off again for food nobody is cooking.
 *
 * Each retry is guarded by the per-(line, stock item) idempotency the manual one
 * relies on, so running this while a person retries the same gap deducts nothing
 * twice. A gap that cannot be retried is logged and the sweep carries on: one bad
 * order must not keep the rest of the kitchen's gaps open.
 */
final readonly class ConsumptionExceptionSweep
{
    public function __construct(
        private OrderConsumptionService $consumption,
        private AuditRecorder $audit,
    ) {}

    /**
     * Retry the organisation's open gaps, oldest first. Must run with the
     * organisation's tenant context restored.
     *
     * @return int how many gaps the sweep closed
     */
    public function retryOpen(string $organisationId): int
    {
        $closed = 0;

        foreach ($this->onePerLine($organisationId) as $exception) {
            try {
                $closed += $this->retry($exception);
            } catch (\Throwable $failure) {
                Log::error('A stock gap could not be retried automatically.', [
                    'organisation_id' => $organisationId,
                    'exception_id' => (string) $exception->getKey(),
                    'error' => $failure->getMessage(),
                ]);
            }
        }

        return $closed;
    }

    /**
     * Every organisation with a gap the sweep would retry.
     *
     * @return list<string>
     */
    public function organisationsWithOpenGaps(): array
    {
        /** @var list<string> $ids */
        $ids = $this->retryable()
            ->distinct()
            ->orderBy('organisation_id')
            ->pluck('organisation_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        return $ids;
    }

    /**
     * How many of the line's gaps this retry closed, counted across the line
     * because a retry settles every gap on it that no longer occurs.
     */
    private function retry(OrderConsumptionException $exception): int
    {
        $openBefore = $this->openOnLine($exception)->pluck('id')->all();

        $this->consumption->retry($exception, null);

        $closed = OrderConsumptionException::withoutTenancy()
            ->whereIn('id', $openBefore)
            ->whereNotNull('resolved_at')
            ->get();

        foreach ($closed as $settled) {
            $this->audit->record(
                'inventory.consumption_exception_auto_retried',
                subjectType: 'order_consumption_exception',
                subjectId: (string) $settled->getKey(),
                metadata: [
                    'order_id' => $settled->order_id,
                    'reason_code' => $settled->reason_code,
                    'resolved' => true,
                ],
            );
        }

        return $closed->count();
    }

    /**
     * @return Collection<int, OrderConsumptionException>
     */
    private function onePerLine(string $organisationId): Collection
    {
        return $this->retryable()
            ->where('organisation_id', $organisationId)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->unique(static fn (OrderConsumptionException $exception): string => $exception->order_id.'|'.($exception->order_line_id ?? ''))
            ->values();
    }

    /**
     * @return Builder<OrderConsumptionException>
     */
    private function openOnLine(OrderConsumptionException $exception): Builder
    {
        $query = OrderConsumptionException::withoutTenancy()
            ->where('organisation_id', $exception->organisation_id)
            ->where('order_id', $exception->order_id)
            ->whereNull('resolved_at');

        // An order-level retry re-runs every line, so every open gap on the order can close.
        return $exception->order_line_id === null
            ? $query
            : $query->where('order_line_id', $exception->order_line_id);
    }

    /**
     * @return Builder<OrderConsumptionException>
     */
    private function retryable(): Builder
    {
        return OrderConsumptionException::withoutTenancy()
            ->whereNull('resolved_at')
            ->where('reason_code', '!=', 'no_ingredient_cost')
            ->whereNotIn('order_id', Order::query()
                ->where('status', OrderStatus::Cancelled->value)
                ->select('id'));
    }
}
