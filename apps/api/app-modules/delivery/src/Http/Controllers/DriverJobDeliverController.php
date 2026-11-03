<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Contracts\DeliveredOrderHandover;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/driver/jobs/{job}/deliver — the driver handed the food over.
 *
 * Closes the order too, as the driver (BUG-10): the customer sees it delivered
 * at once, and the cash the driver says they took is receipted to them. Omitted
 * or ignored on a WISH order; `DeliveredOrderHandover` holds the rules.
 *
 * **A double press writes one receipt.** The job update is conditional on the run
 * still being open, so of two presses only one can win, and the receipt is
 * written only by the one that did. The second is a `409`, and it is safe for a
 * phone on a bad connection: the screen re-reads and the run has gone.
 */
final class DriverJobDeliverController
{
    /**
     * @var list<string>
     */
    private const array CLOSED_STATUSES = ['delivered', 'cancelled', 'failed'];

    public function __construct(private readonly DeliveredOrderHandover $handover) {}

    public function __invoke(Request $request, string $job): JsonResponse
    {
        $record = DeliveryJob::query()->whereKey($job)->where('driver_user_id', auth()->id())->first();
        if ($record === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        // The kitchen may have closed it by hand (HA-29); a stale sheet must not
        // re-stamp a run that has already ended.
        if (in_array($record->status, self::CLOSED_STATUSES, true)) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This run is already closed.');
        }

        /** @var array{collected_minor?: int|null, note?: string|null} $validated */
        $validated = $request->validate([
            // Required on a cash order; `DeliveredOrderHandover` knows which it is.
            'collected_minor' => ['nullable', 'integer', 'min:0'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $note = $validated['note'] ?? null;

        // One transaction: a job marked delivered over an order left open is
        // exactly the split this fixes.
        DB::transaction(function () use ($record, $validated, $note): void {
            $deliveredAt = CarbonImmutable::now();

            $won = DeliveryJob::query()
                ->whereKey($record->getKey())
                ->whereNotIn('status', self::CLOSED_STATUSES)
                ->update([
                    'status' => 'delivered',
                    'tracking_status' => 'delivered',
                    'delivered_at' => $deliveredAt,
                    'proof_of_delivery_notes' => $note,
                    'lock_version' => DB::raw('lock_version + 1'),
                    'updated_at' => $deliveredAt,
                ]);

            if ($won === 0) {
                throw new ApiException(ErrorCode::ResourceConflict, 'This run is already closed.');
            }

            $this->handover->delivered($record->order_id, (string) $record->driver_user_id, $validated['collected_minor'] ?? null, $note);
        });

        $record->refresh();

        return ApiResponse::data(['job' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
