<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockReservation;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Claims on stock: opening them, ending them, and answering how much of a shelf
 * is still free (PROD1).
 *
 * ## Availability is on-hand minus what is claimed
 *
 * `stock_levels.quantity` answers "what is here", which stops being the useful
 * question the moment a batch has been committed to. A kitchen that confirms
 * Thursday's dressing still has the oil on the shelf on Wednesday, and a customer
 * order that eats it leaves Thursday short with nothing visibly wrong anywhere.
 *
 * ## Opening is locked, ordered, and checked inside the lock
 *
 * {@see open()} takes `lockForUpdate()` on every shelf it is about to claim,
 * **ordered by stock item id**, and only then recomputes availability. Both halves
 * matter: checking outside the lock lets two confirms each see the same free oil
 * and both claim it, and locking in arrival order lets two orders that share two
 * shelves take them in opposite orders and deadlock. The same ordering discipline
 * the completion path uses.
 *
 * Lock order across tables is `stock_levels` → `ingredient_stock_costs`, matching
 * `GoodsReceiptService::post()`, which records its movement before settling its
 * cost. A path that took them the other way round would deadlock against a
 * concurrent delivery.
 *
 * ## Ending a claim is not deleting it
 *
 * `released` and `consumed` are different facts — the batch never took it, or the
 * batch took it — and a production manager reading a cancelled order needs to see
 * the first rather than infer it from an absence.
 */
final readonly class ReservationService
{
    private const int SCALE = 6;

    /**
     * How much of one shelf is free: on-hand minus every open claim, optionally
     * ignoring the claims one holder already has.
     *
     * The exclusion is what lets a batch consume what it reserved. Without it a
     * completion would be refused by its own claim, which is the one thing that
     * must never block it.
     *
     * @return numeric-string
     */
    public function availableQuantity(
        string $branchId,
        string $stockItemId,
        ?string $holderType = null,
        ?string $holderId = null,
    ): string {
        return bcsub(
            $this->onHandQuantity($branchId, $stockItemId),
            $this->reservedQuantity($branchId, $stockItemId, $holderType, $holderId),
            self::SCALE,
        );
    }

    /**
     * What is physically on one shelf, before any claim.
     *
     * A shelf with no level row reads as zero rather than as unknown: the row is
     * created by the first movement, so its absence is a shelf nothing has ever
     * been received onto.
     *
     * @return numeric-string
     */
    public function onHandQuantity(string $branchId, string $stockItemId): string
    {
        $onHand = StockLevel::withoutTenancy()
            ->where('branch_id', $branchId)
            ->where('stock_item_id', $stockItemId)
            ->value('quantity');

        return $this->numeric((string) ($onHand ?? '0'));
    }

    /**
     * The open claims on one shelf, optionally excluding one holder's.
     *
     * @return numeric-string
     */
    public function reservedQuantity(
        string $branchId,
        string $stockItemId,
        ?string $exceptHolderType = null,
        ?string $exceptHolderId = null,
    ): string {
        $query = StockReservation::withoutTenancy()
            ->where('branch_id', $branchId)
            ->where('stock_item_id', $stockItemId)
            ->where('status', ReservationStatus::Open->value);

        if ($exceptHolderType !== null && $exceptHolderId !== null) {
            $query->where(function ($inner) use ($exceptHolderType, $exceptHolderId): void {
                $inner->where('holder_type', '!=', $exceptHolderType)
                    ->orWhere('holder_id', '!=', $exceptHolderId);
            });
        }

        /** @var list<string> $quantities */
        $quantities = $query->pluck('quantity')->map(static fn (mixed $q): string => (string) $q)->all();

        $total = bcadd('0', '0', self::SCALE);

        foreach ($quantities as $quantity) {
            $total = bcadd($total, $this->numeric($quantity), self::SCALE);
        }

        return $total;
    }

    /**
     * The open claims on many shelves at one branch, keyed by stock item.
     *
     * One query rather than one per shelf, because the buy list asks this for
     * every stock item a whole week needs and a per-row read would turn a forecast
     * into a hundred round trips. Shelves with no open claim are **absent** rather
     * than zero — a caller reads them with `?? '0'`, which is the same answer and
     * does not pretend the table holds a row it does not.
     *
     * @param  list<string>  $stockItemIds
     * @return array<string, numeric-string>
     */
    public function openTotals(string $branchId, array $stockItemIds): array
    {
        if ($stockItemIds === []) {
            return [];
        }

        $rows = StockReservation::withoutTenancy()
            ->where('branch_id', $branchId)
            ->whereIn('stock_item_id', $stockItemIds)
            ->where('status', ReservationStatus::Open->value)
            ->get(['stock_item_id', 'quantity']);

        $totals = [];

        foreach ($rows as $row) {
            $stockItemId = (string) $row->stock_item_id;
            $totals[$stockItemId] = bcadd(
                $totals[$stockItemId] ?? '0',
                $this->numeric((string) $row->quantity),
                self::SCALE,
            );
        }

        /** @var array<string, numeric-string> $totals */
        return $totals;
    }

    /**
     * Claim stock for one holder.
     *
     * All or nothing: a batch half-reserved is a batch nobody can plan around, so
     * the first shelf that cannot cover its line refuses the whole call and the
     * transaction takes the rest back with it.
     *
     * @param  array<string, numeric-string>  $quantities  stock item id => quantity, in that item's own unit
     * @return list<StockReservation>
     *
     * @throws InsufficientStock when a shelf cannot cover its line after other holders' claims
     */
    public function open(
        string $organisationId,
        string $branchId,
        string $holderType,
        string $holderId,
        array $quantities,
    ): array {
        if ($quantities === []) {
            return [];
        }

        // Deterministic lock order. Two orders sharing two shelves, locking them
        // in whatever order their lines happen to be written in, is a deadlock
        // that appears only under load and only sometimes.
        ksort($quantities);

        return DB::transaction(function () use ($organisationId, $branchId, $holderType, $holderId, $quantities): array {
            $opened = [];

            foreach ($quantities as $stockItemId => $quantity) {
                $quantity = $this->numeric((string) $quantity);

                if (bccomp($quantity, '0', self::SCALE) <= 0) {
                    continue;
                }

                // Establish the row and lock it before reading availability: a
                // check outside the lock lets two confirms both see the same free
                // oil and both claim it.
                StockLevel::withoutTenancy()->firstOrCreate(
                    ['branch_id' => $branchId, 'stock_item_id' => (string) $stockItemId],
                    ['organisation_id' => $organisationId, 'quantity' => '0'],
                );

                StockLevel::withoutTenancy()
                    ->where('branch_id', $branchId)
                    ->where('stock_item_id', (string) $stockItemId)
                    ->lockForUpdate()
                    ->firstOrFail();

                $onHand = $this->onHandQuantity($branchId, (string) $stockItemId);
                $reserved = $this->reservedQuantity($branchId, (string) $stockItemId, $holderType, $holderId);
                $available = bcsub($onHand, $reserved, self::SCALE);

                if (bccomp($available, $quantity, self::SCALE) < 0) {
                    throw new InsufficientStock($branchId, (string) $stockItemId, $available, $quantity, $reserved);
                }

                $reservation = new StockReservation;
                $reservation->organisation_id = $organisationId;
                $reservation->branch_id = $branchId;
                $reservation->stock_item_id = (string) $stockItemId;
                $reservation->quantity = $quantity;
                $reservation->holder_type = $holderType;
                $reservation->holder_id = $holderId;
                $reservation->status = ReservationStatus::Open;
                $reservation->save();

                $opened[] = $reservation;
            }

            return $opened;
        });
    }

    /**
     * End one holder's open claims.
     *
     * Idempotent: a release that runs twice ends nothing the second time, which is
     * what makes a retried cancellation safe. Returns how many rows it actually
     * changed, so a caller can tell "released" from "there was nothing to
     * release" — the two look identical from the outside and mean different
     * things after a crash.
     */
    public function close(string $holderType, string $holderId, ReservationStatus $status): int
    {
        if ($status === ReservationStatus::Open) {
            throw new RuntimeException('A reservation cannot be closed as open.');
        }

        return StockReservation::withoutTenancy()
            ->where('holder_type', $holderType)
            ->where('holder_id', $holderId)
            ->where('status', ReservationStatus::Open->value)
            ->update([
                'status' => $status->value,
                'released_at' => CarbonImmutable::now(),
                'updated_at' => CarbonImmutable::now(),
            ]);
    }

    /**
     * One holder's open claims, keyed by stock item.
     *
     * @return array<string, numeric-string>
     */
    public function openFor(string $holderType, string $holderId): array
    {
        /** @var array<string, numeric-string> $claims */
        $claims = StockReservation::withoutTenancy()
            ->where('holder_type', $holderType)
            ->where('holder_id', $holderId)
            ->where('status', ReservationStatus::Open->value)
            ->get(['stock_item_id', 'quantity'])
            ->mapWithKeys(static fn (StockReservation $row): array => [
                (string) $row->stock_item_id => (string) $row->quantity,
            ])
            ->all();

        return $claims;
    }

    /**
     * Whether a shelf is over-claimed: more is spoken for than is actually there.
     *
     * Computed rather than stored, and it is a real state rather than a fault to
     * prevent. `waste` and `adjust` stay permitted below the reserved total — a
     * stock count that comes up short is a fact, and refusing to record it would
     * hide the discrepancy rather than surface it — so a physical correction can
     * legitimately leave a confirmed batch short. Saying so is the point.
     */
    public function isShort(string $branchId, string $stockItemId): bool
    {
        return bccomp($this->availableQuantity($branchId, $stockItemId), '0', self::SCALE) < 0;
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Reservation arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
