<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Inventory\Jobs\RetryOpenConsumptionExceptions;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Models\StockReservation;
use Illuminate\Support\Facades\DB;

/**
 * What a quality hold does to the shelf: the stock a held delivery or batch
 * brought in is set aside until somebody releases it.
 *
 * **A claim, because a claim already stops everything.** A hold opens a
 * {@see StockReservation} for the quantity the subject put on the shelf, so the
 * availability rule in {@see InventoryService::recordMovement()} and
 * {@see ReservationService::open()} refuses to consume it, the batch planner stops
 * counting it and the buy list stops relying on it, none of them changed.
 *
 * **Quantity grain, not lot grain.** Stock is one number per shelf, so "which
 * kilos are the held ones" is unknowable. What the data can say is how much of
 * this shelf is spoken for: a bad delivery of oil sets aside that delivery and
 * leaves last week's oil usable, rather than stopping every dish with oil in it.
 * The kitchen still has to move the food physically. Lot-level stock is the fix
 * and is not built.
 *
 * **The quantity is read from the ledger.** The movements a subject wrote are in
 * the shelf's own unit and name the branch, which a receipt line's or a batch's
 * figures do not. A subject that has put nothing on a shelf yet has nothing to set
 * aside: {@see settleYield()} comes back for a batch held before it was finished.
 *
 * **A hold is never refused.** It writes its row past {@see ReservationService::open()},
 * which refuses a shelf it cannot cover: a confirmed batch's claim on the same
 * shelf is no reason to leave suspect food usable. The shelf reads short instead,
 * which {@see ReservationService::isShort()} already reports.
 *
 * **One claim per subject.** The holder is the subject rather than the check, so a
 * second check on a held delivery cannot set the same kilos aside twice, and
 * releasing one of two leaves the claim standing until the last is decided.
 */
final readonly class StockQuarantine
{
    private const int SCALE = 6;

    /** What put the subject's stock on the shelf, by the ledger's own reference. */
    private const array INCOMING = ['goods_receipt' => 'receipt', 'production_order' => 'yield'];

    public function __construct(private ReservationService $reservations) {}

    /**
     * Set aside what the subject brought in, capped at what is on the shelf now.
     * Safe to repeat: a shelf already set aside for this subject is left alone.
     */
    public function hold(string $organisationId, string $subjectType, string $subjectId): void
    {
        DB::transaction(function () use ($organisationId, $subjectType, $subjectId): void {
            $claimed = $this->reservations->openFor(StockReservation::HOLDER_QUALITY_HOLD, $subjectId);

            foreach ($this->broughtIn($organisationId, $subjectType, $subjectId) as $shelf) {
                if (isset($claimed[$shelf['stock_item_id']])) {
                    continue;
                }

                $onHand = StockLevel::withoutTenancy()
                    ->where('branch_id', $shelf['branch_id'])
                    ->where('stock_item_id', $shelf['stock_item_id'])
                    ->lockForUpdate()
                    ->value('quantity');

                $onHand = (string) ($onHand ?? '0');
                $quantity = bccomp($onHand, $shelf['quantity'], self::SCALE) < 0 ? $onHand : $shelf['quantity'];

                if (bccomp($quantity, '0', self::SCALE) <= 0) {
                    continue;
                }

                $reservation = new StockReservation;
                $reservation->organisation_id = $organisationId;
                $reservation->branch_id = $shelf['branch_id'];
                $reservation->stock_item_id = $shelf['stock_item_id'];
                $reservation->quantity = $quantity;
                $reservation->holder_type = StockReservation::HOLDER_QUALITY_HOLD;
                $reservation->holder_id = $subjectId;
                $reservation->status = ReservationStatus::Open;
                $reservation->save();
            }
        });
    }

    /**
     * Give the stock back, unless another check still holds the subject, and
     * retry the order lines the hold blocked: stock rising would, and this is the
     * same news.
     */
    public function release(string $organisationId, string $subjectId): void
    {
        $stillHeld = DB::table('quality_checks')
            ->where('organisation_id', $organisationId)
            ->where('subject_id', $subjectId)
            ->where('status', 'hold')
            ->exists();

        if ($stillHeld) {
            return;
        }

        $this->reservations->close(StockReservation::HOLDER_QUALITY_HOLD, $subjectId, ReservationStatus::Released);

        DB::afterCommit(static function () use ($organisationId): void {
            RetryOpenConsumptionExceptions::queueFor($organisationId);
        });
    }

    /**
     * A batch held before it finished brought nothing in then. Called once its
     * yield is on the shelf, so the hold bites on what it made.
     */
    public function settleYield(string $organisationId, string $batchId): void
    {
        $held = DB::table('quality_checks')
            ->where('organisation_id', $organisationId)
            ->where('subject_type', 'production_order')
            ->where('subject_id', $batchId)
            ->where('status', 'hold')
            ->exists();

        if ($held) {
            $this->hold($organisationId, 'production_order', $batchId);
        }
    }

    public function isHolding(string $branchId, string $stockItemId): bool
    {
        return StockReservation::withoutTenancy()
            ->where('branch_id', $branchId)
            ->where('stock_item_id', $stockItemId)
            ->where('holder_type', StockReservation::HOLDER_QUALITY_HOLD)
            ->where('status', ReservationStatus::Open->value)
            ->exists();
    }

    public function anyHeld(string $organisationId): bool
    {
        return StockReservation::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('holder_type', StockReservation::HOLDER_QUALITY_HOLD)
            ->where('status', ReservationStatus::Open->value)
            ->exists();
    }

    /**
     * Whether a sale of `$required` from this shelf could only come out of held
     * stock. Only a quality hold refuses a sale. The owner's rule of 13 October,
     * "warn, never refuse", stands for every other shortage, so three things that
     * read as short answer no here:
     *
     *  - a shelf with nothing set aside;
     *  - an empty or negative shelf, which is a counting problem;
     *  - a shelf short of `$required` with free stock left, which was short before
     *    any hold and meets its warning at the deduction.
     *
     * Production's claims are ignored on purpose: a batch spoken for tomorrow is
     * ordinary shortage, not suspect food. `$free` is what the hold leaves.
     *
     * Summed across branches, because a sale often names none. A kitchen whose
     * other branch has free stock passes here and meets the hold at the deduction.
     *
     * @param  numeric-string  $required
     */
    public function coversOnlyHeld(string $organisationId, string $stockItemId, string $required): bool
    {
        [$held, $onHand, $free] = $this->shelf($organisationId, $stockItemId);

        if (bccomp($held, '0', self::SCALE) <= 0 || bccomp($onHand, '0', self::SCALE) <= 0) {
            return false;
        }

        return bccomp($free, '0', self::SCALE) <= 0
            || (bccomp($onHand, $required, self::SCALE) >= 0 && bccomp($free, $required, self::SCALE) < 0);
    }

    /**
     * Whether a sale of `$required` is more than the free stock on a shelf that
     * has something held: held stock never counts as free (owner, 3 Nov 2026).
     * The warning's question, not the refusal's: {@see coversOnlyHeld()} still
     * decides which of these refuse, and every other one is warned, never refused.
     *
     * @param  numeric-string  $required
     */
    public function shortOfFree(string $organisationId, string $stockItemId, string $required): bool
    {
        [$held, , $free] = $this->shelf($organisationId, $stockItemId);

        return bccomp($held, '0', self::SCALE) > 0 && bccomp($free, $required, self::SCALE) < 0;
    }

    /**
     * Held, on hand and free (on hand less held), summed across branches.
     *
     * @return array{0: string, 1: string, 2: string}
     */
    private function shelf(string $organisationId, string $stockItemId): array
    {
        $held = number_format((float) StockReservation::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('stock_item_id', $stockItemId)
            ->where('holder_type', StockReservation::HOLDER_QUALITY_HOLD)
            ->where('status', ReservationStatus::Open->value)
            ->sum('quantity'), self::SCALE, '.', '');

        $onHand = number_format((float) StockLevel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('stock_item_id', $stockItemId)
            ->sum('quantity'), self::SCALE, '.', '');

        return [$held, $onHand, bcsub($onHand, $held, self::SCALE)];
    }

    /**
     * What the subject put on each shelf and did not take straight back off: a
     * batch's rejected units go out as `waste` under its own reference.
     *
     * @return list<array{branch_id: string, stock_item_id: string, quantity: numeric-string}>
     */
    private function broughtIn(string $organisationId, string $subjectType, string $subjectId): array
    {
        $incoming = self::INCOMING[$subjectType] ?? null;

        if ($incoming === null) {
            return [];
        }

        $movements = StockMovement::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('reference_type', $subjectType)
            ->where('reference_id', $subjectId)
            ->whereIn('reason', [$incoming, 'waste'])
            ->get(['branch_id', 'stock_item_id', 'reason', 'quantity_delta']);

        $shelves = [];

        foreach ($movements->where('reason', $incoming) as $movement) {
            $key = $movement->branch_id.'|'.$movement->stock_item_id;
            $shelves[$key] ??= ['branch_id' => (string) $movement->branch_id, 'stock_item_id' => (string) $movement->stock_item_id, 'quantity' => '0'];
            $shelves[$key]['quantity'] = bcadd($shelves[$key]['quantity'], (string) $movement->quantity_delta, self::SCALE);
        }

        // Only the shelves it brought stock to: a batch's input waste is on its
        // inputs' shelves, which are not what it holds.
        foreach ($movements->where('reason', 'waste') as $movement) {
            $key = $movement->branch_id.'|'.$movement->stock_item_id;

            if (isset($shelves[$key])) {
                $shelves[$key]['quantity'] = bcadd($shelves[$key]['quantity'], (string) $movement->quantity_delta, self::SCALE);
            }
        }

        return array_values($shelves);
    }
}
