<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Models\StockReservation;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Inventory\Services\MealExplosion;
use Healthy360\Inventory\Services\ReservationService;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Healthy360\Procurement\Services\IngredientCostService;
use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\Production\Exceptions\ProductionConsumptionRecorded;
use Healthy360\Production\Exceptions\ProductionPlanRefused;
use Healthy360\Production\Exceptions\ProductionStateInvalid;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * The batch lifecycle: confirm, start, complete, abandon, cancel (PROD1).
 *
 * ## What each edge is for
 *
 * **Confirm** is the commitment. It explodes the recipe at the batch factor,
 * writes the bill of materials, **claims the stock**, and snapshots the estimate,
 * the price basis and the version's nutrition. Everything it writes is frozen:
 * re-deriving any of it later would make the plan, the claims and the estimate
 * disagree with each other on exactly the batches nobody can reconstruct.
 *
 * It refuses a shelf it cannot claim. That is the point of a reservation — the
 * desk shows `missing` before anybody presses the button, so this is never a
 * surprise, and a confirm that "reserved what it could" would be a promise the
 * system knows it cannot keep.
 *
 * **Complete** is the only edge that moves money. One transaction: consume the
 * inputs against the batch's own claim, record input waste as its own movements,
 * post the yield, take the rejected units back off, blend the finished cost, close
 * the claims.
 *
 * **Abandon** runs the *same* transaction with a different ending, because a
 * batch that went wrong after eating four kilos of flour did not un-happen.
 * **Cancel** is for a batch that took nothing, and it proves that against the
 * ledger rather than believing the request.
 *
 * ## Idempotency at two grains
 *
 * The coarse grain is the status: a completed batch completes again as a no-op,
 * because a redelivered request must not deduct twice. The fine grain is a
 * movement-existence check per `(order, stock item, reason)`, which is what makes
 * a *partial* failure recoverable — the `OrderConsumptionService` precedent, and
 * the reason a retry cannot double-deduct the lines that already went through.
 *
 * ## Lock ordering is `stock_levels` → `ingredient_stock_costs`, always
 *
 * `GoodsReceiptService::post()` records its movement and then settles its cost,
 * and this takes the same order. A path that took them the other way round would
 * deadlock against a concurrent delivery — rarely, under load, and only sometimes.
 *
 * ## The three yield facts stay three facts
 *
 * Rejected units are *inside* produced and leave again as waste at the batch unit
 * cost. Input waste is *beside* consumption, as its own movement, and is excluded
 * from the batch cost because it never became product. Process loss gets no
 * movement and no money at all — it never existed as stock, and its cost is
 * already absorbed into the unit cost of what was produced. Any other arrangement
 * counts something twice.
 */
final readonly class ProductionOrderService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /** The scale quantities are compared and stored at — `stock_levels.quantity`'s own. */
    private const int QUANTITY_SCALE = 4;

    public function __construct(
        private ProductionPlanningService $planning,
        private ReservationService $reservations,
        private InventoryService $inventory,
        private IngredientCostService $costs,
        private MealExplosion $explosion,
        private UnitConversionService $conversion,
        private ProductionOrderNumbers $numbers,
        private AuditRecorder $audit,
    ) {}

    /* ── planning ────────────────────────────────────────────────────────── */

    /**
     * What this batch would need, as the desk shows it.
     *
     * A draft reads its plan live, because nothing is committed yet and the
     * shelves move under it. A confirmed batch reads it against its own snapshot
     * instead — see {@see plannedLines()} — and excludes its own claim so it does
     * not appear short of everything it already holds.
     */
    public function plan(ProductionOrder $order): BatchPlan
    {
        $version = $this->versionFor($order);

        return $this->planning->plan(
            (string) $order->organisation_id,
            (string) $order->branch_id,
            $version,
            (string) ($order->batch_factor ?? '0'),
            $order->status->holdsReservations() ? StockReservation::HOLDER_PRODUCTION_ORDER : null,
            $order->status->holdsReservations() ? (string) $order->getKey() : null,
            $order->weekly_price_publication_id,
        );
    }

    /* ── draft ───────────────────────────────────────────────────────────── */

    /**
     * Open a batch nobody has committed to yet.
     *
     * **A draft claims nothing.** That is the whole reason the state exists and
     * is not called `planned`: a kitchen writing next week's runs on a Friday
     * afternoon must not be quietly reserving Monday's flour while it decides.
     *
     * ## How much to make, said either way round
     *
     * A cook thinks in yield — "forty litres of dressing" — and the explosion
     * thinks in batch factor — "two and a half times the recipe". Both are
     * accepted and the other is derived here, on the server, because the
     * conversion needs the version's own yield and a client doing it would be a
     * second place the arithmetic lives.
     *
     * Deriving the factor needs an output to divide by, so the version's single
     * output is resolved now rather than at confirm. That means a multi-output
     * version is refused at the earliest point somebody could be told, instead of
     * after they have filled in a form.
     *
     * @param  string|null  $plannedYield  how much to make, in the output's own unit
     * @param  string|null  $batchFactor  how many times over the recipe is made
     *
     * @throws ProductionPlanRefused when the version states no output, states several, or its output quantity is unusable
     */
    public function draft(
        string $organisationId,
        string $branchId,
        RecipeVersion $version,
        ?string $plannedYield = null,
        ?string $batchFactor = null,
        ?string $actorId = null,
        ?string $notes = null,
    ): ProductionOrder {
        $output = $this->soleOutputOf($version);
        $outputQuantity = $this->numeric((string) $output->output_quantity);

        if (bccomp($outputQuantity, '0', self::QUANTITY_SCALE) <= 0) {
            throw ProductionPlanRefused::noOutput();
        }

        if ($batchFactor === null && $plannedYield === null) {
            throw ProductionPlanRefused::planIncomplete([[
                'catalogue_item_id' => null,
                'reason_code' => 'no_batch_quantity',
                'detail' => 'A batch must say how much to make, either as a yield quantity or as a batch factor.',
            ]]);
        }

        $factor = $batchFactor !== null
            ? $this->numeric($batchFactor)
            : bcdiv($this->numeric((string) $plannedYield), $outputQuantity, self::SCALE);

        $yield = $plannedYield !== null
            ? $this->numeric($plannedYield)
            : $this->roundQuantity(bcmul($outputQuantity, $factor, self::WORKING_SCALE));

        $order = new ProductionOrder;
        $order->organisation_id = $organisationId;
        $order->branch_id = $branchId;
        $order->recipe_version_id = (string) $version->getKey();
        $order->status = ProductionOrderStatus::Draft;
        $order->production_item_ingredient_id = (string) $output->ingredient_id;
        $order->planned_yield = $yield;
        $order->planned_yield_unit_id = (string) $output->unit_id;
        $order->batch_factor = $factor;
        $order->created_by = $actorId;
        $order->notes = $notes;
        $order->save();

        $this->audit->record('production.order.drafted', $actorId, 'production_order', (string) $order->getKey(), [
            'recipe_version_id' => (string) $version->getKey(),
            'batch_factor' => $factor,
        ]);

        return $order;
    }

    /* ── confirm ─────────────────────────────────────────────────────────── */

    /**
     * Commit to the batch: freeze the plan, claim the stock, snapshot the estimate.
     *
     * @throws ProductionStateInvalid when the batch is not a draft
     * @throws ProductionPlanRefused when the version states no output, states several, or cannot be exploded
     * @throws InsufficientStock when a shelf cannot cover its line
     */
    public function confirm(ProductionOrder $order, ?string $actorId = null): ProductionOrder
    {
        $this->assertCanMoveTo($order, ProductionOrderStatus::Confirmed, 'confirmed');

        $version = $this->versionFor($order);
        $output = $this->soleOutputOf($version);

        $publicationId = $order->weekly_price_publication_id
            ?? $this->standingPublicationId((string) $order->organisation_id);

        $plan = $this->planning->plan(
            (string) $order->organisation_id,
            (string) $order->branch_id,
            $version,
            (string) ($order->batch_factor ?? '0'),
            StockReservation::HOLDER_PRODUCTION_ORDER,
            (string) $order->getKey(),
            $publicationId,
        );

        if ($plan->failures !== []) {
            throw ProductionPlanRefused::planIncomplete($plan->failures);
        }

        return DB::transaction(function () use ($order, $version, $output, $plan, $publicationId, $actorId): ProductionOrder {
            $locked = $this->lockOrder($order);

            // Re-read under the lock: two people on the same desk, and the one
            // who pressed second gets told rather than double-claiming.
            $this->assertCanMoveTo($locked, ProductionOrderStatus::Confirmed, 'confirmed');

            $this->writeLines($locked, $plan);

            // All-or-nothing, ordered by stock item, checked inside the lock.
            // A shelf that cannot cover its line refuses the whole confirm and
            // the transaction takes the rest of the claims back with it.
            $this->reservations->open(
                (string) $locked->organisation_id,
                (string) $locked->branch_id,
                StockReservation::HOLDER_PRODUCTION_ORDER,
                (string) $locked->getKey(),
                $this->claimsFrom($plan),
            );

            $this->recordReservedQuantities($locked);

            $locked->reference ??= $this->numbers->next((string) $locked->organisation_id);
            $locked->production_item_ingredient_id = (string) $output->ingredient_id;
            $locked->planned_yield_unit_id = (string) $output->unit_id;
            $locked->planned_yield = $this->roundQuantity(bcmul(
                $this->numeric((string) $output->output_quantity),
                $this->numeric((string) ($locked->batch_factor ?? '0')),
                self::WORKING_SCALE,
            ));
            $locked->estimated_cost_amount = $plan->estimatedCostAmount;
            $locked->estimated_cost_currency_code = $plan->estimatedCostAmount === null ? null : $plan->currencyCode;
            $locked->weekly_price_publication_id = $publicationId;
            $locked->nutrition_facts = $version->nutrition_facts;
            $locked->status = ProductionOrderStatus::Confirmed;
            $locked->confirmed_at = CarbonImmutable::now();
            $locked->lock_version = $locked->lock_version + 1;
            $locked->save();

            $this->audit->record(
                'production.order.confirmed',
                $actorId,
                'production_order',
                (string) $locked->getKey(),
                [
                    'reference' => $locked->reference,
                    'batch_factor' => (string) $locked->batch_factor,
                    'line_count' => count($plan->lines()),
                    'estimate_withheld' => $plan->estimatedCostAmount === null,
                ],
            );

            return $locked;
        });
    }

    /* ── start ───────────────────────────────────────────────────────────── */

    /**
     * Somebody is cooking. Nothing moves; this is the point after which something
     * may.
     *
     * @throws ProductionStateInvalid
     */
    public function start(ProductionOrder $order, ?string $actorId = null): ProductionOrder
    {
        $this->assertCanMoveTo($order, ProductionOrderStatus::InProduction, 'started');

        return DB::transaction(function () use ($order, $actorId): ProductionOrder {
            $locked = $this->lockOrder($order);
            $this->assertCanMoveTo($locked, ProductionOrderStatus::InProduction, 'started');

            $locked->status = ProductionOrderStatus::InProduction;
            $locked->started_at = CarbonImmutable::now();
            $locked->lock_version = $locked->lock_version + 1;
            $locked->save();

            $this->audit->record('production.order.started', $actorId, 'production_order', (string) $locked->getKey());

            return $locked;
        });
    }

    /* ── complete and abandon ────────────────────────────────────────────── */

    /**
     * Finish the batch: consume, waste, yield, value, release — and, once usable
     * units reach a shelf, date it and give it a lot ({@see batchDates()}).
     *
     * @throws ApiException when the production or expiry date is refused
     * @throws ProductionStateInvalid
     */
    public function complete(ProductionOrder $order, BatchReport $report, ?string $actorId = null): ProductionOrder
    {
        return $this->settle($order, $report, ProductionOrderStatus::Completed, null, $actorId);
    }

    /**
     * Give up on a batch that has already taken something.
     *
     * The same transaction as {@see complete()}, deliberately: what was used was
     * used, whatever came out came out, and recording it any other way would
     * leave stock missing from a shelf with nothing to explain it. The difference
     * is the status and the reason — which is the entire distinction between
     * abandoning and cancelling.
     *
     * @throws ApiException when the production or expiry date is refused
     * @throws ProductionStateInvalid
     */
    public function abandon(ProductionOrder $order, BatchReport $report, string $reason, ?string $actorId = null): ProductionOrder
    {
        return $this->settle($order, $report, ProductionOrderStatus::Abandoned, $reason, $actorId);
    }

    /* ── cancel ──────────────────────────────────────────────────────────── */

    /**
     * Call off a batch that has taken nothing.
     *
     * Proven against the ledger rather than believed: a request may say nothing
     * was used, and the movement ledger is what actually knows. Where movements
     * exist, the refusal names `abandon` rather than leaving the caller to guess.
     *
     * @throws ProductionStateInvalid
     * @throws ProductionConsumptionRecorded when stock has already moved against this batch
     */
    public function cancel(ProductionOrder $order, ?string $actorId = null): ProductionOrder
    {
        $this->assertCanMoveTo($order, ProductionOrderStatus::Cancelled, 'cancelled');

        return DB::transaction(function () use ($order, $actorId): ProductionOrder {
            $locked = $this->lockOrder($order);
            $this->assertCanMoveTo($locked, ProductionOrderStatus::Cancelled, 'cancelled');

            $movements = $this->movementCountFor($locked);

            if ($movements > 0) {
                throw new ProductionConsumptionRecorded((string) $locked->getKey(), $movements);
            }

            // Released, never consumed: the batch did not take the oil, and a
            // manager reading this order must be able to see that rather than
            // infer it from an absence.
            $this->reservations->close(
                StockReservation::HOLDER_PRODUCTION_ORDER,
                (string) $locked->getKey(),
                ReservationStatus::Released,
            );

            $locked->status = ProductionOrderStatus::Cancelled;
            $locked->cancelled_at = CarbonImmutable::now();
            $locked->lock_version = $locked->lock_version + 1;
            $locked->save();

            $this->audit->record('production.order.cancelled', $actorId, 'production_order', (string) $locked->getKey());

            return $locked;
        });
    }

    /* ── the settlement transaction ──────────────────────────────────────── */

    /**
     * @throws ApiException when the production or expiry date is refused
     * @throws ProductionStateInvalid
     */
    private function settle(
        ProductionOrder $order,
        BatchReport $report,
        ProductionOrderStatus $ending,
        ?string $abandonReason,
        ?string $actorId,
    ): ProductionOrder {
        // The coarse idempotency grain. A redelivered complete on a batch that is
        // already finished is a no-op rather than a second deduction.
        if ($order->status === $ending) {
            return $order;
        }

        $this->assertCanMoveTo($order, $ending, $ending === ProductionOrderStatus::Completed ? 'completed' : 'abandoned');

        // Outside the transaction: a refused date is the caller's mistake, and
        // finding it out should not cost a row lock and a rollback.
        [$productionDate, $expiryDate] = $this->batchDates($order, $report);

        return DB::transaction(function () use ($order, $report, $ending, $abandonReason, $actorId, $productionDate, $expiryDate): ProductionOrder {
            $locked = $this->lockOrder($order);

            if ($locked->status === $ending) {
                return $locked;
            }

            $this->assertCanMoveTo($locked, $ending, $ending === ProductionOrderStatus::Completed ? 'completed' : 'abandoned');

            /** @var list<ProductionOrderLine> $lines */
            $lines = $locked->lines()->orderBy('stock_item_id')->get()->all();

            $settlement = $this->settleInputs($locked, $lines, $report);

            $unitCost = $this->unitCostFor($locked, $report, $settlement);

            $this->settleYield($locked, $report, $settlement, $unitCost);

            $this->reservations->close(
                StockReservation::HOLDER_PRODUCTION_ORDER,
                (string) $locked->getKey(),
                ReservationStatus::Consumed,
            );

            $this->writeOutcome($locked, $report, $settlement, $unitCost, $ending, $abandonReason, $productionDate, $expiryDate);

            $this->audit->record(
                $ending === ProductionOrderStatus::Completed ? 'production.order.completed' : 'production.order.abandoned',
                $actorId,
                'production_order',
                (string) $locked->getKey(),
                [
                    'produced_quantity' => $report->producedQuantity,
                    'rejected_quantity' => $report->rejectedQuantity,
                    'cost_status' => $locked->actual_cost_status,
                    'reason' => $abandonReason,
                    // Never a key containing "code": AuditRecorder blanks those.
                    'lot_number' => $locked->lot_number,
                ],
            );

            return $locked;
        });
    }

    /**
     * Take the inputs off the shelves and total what they were worth.
     *
     * @param  list<ProductionOrderLine>  $lines  ordered by stock item id — the deterministic lock order the claims were opened in
     */
    private function settleInputs(ProductionOrder $order, array $lines, BatchReport $report): BatchSettlement
    {
        $settlement = new BatchSettlement;
        $producedNothing = $report->producedNothing();

        foreach ($lines as $line) {
            $stockItemId = (string) $line->stock_item_id;

            // Absent means "as planned" — a cook who followed the recipe should
            // not have to retype it. Absent waste means none, because waste
            // nobody mentioned did not happen.
            $consumed = $report->consumed[$stockItemId] ?? $this->numeric((string) $line->required_quantity);
            $waste = $report->waste[$stockItemId] ?? '0';

            $valuation = $this->valueInput($order, $line);

            /*
             * A batch that produced nothing transformed nothing, so its inputs
             * are loss rather than cost of goods. Posting them as `consume`
             * would put the whole amount into the COGS row of the monthly
             * report, where it would read as the price of food that was sold.
             * `waste` is where a reader actually looks for it.
             *
             * The two quantities then become **one** movement rather than two.
             * The fine idempotency grain is `(order, shelf, reason)`, so a second
             * `waste` row for the same shelf would be skipped as a duplicate and
             * the discarded part would silently never leave the shelf. One
             * movement for everything that went is also the truer record: on a
             * batch that made nothing, what went into the pot and what went on
             * the floor had the same ending.
             */
            if ($producedNothing) {
                $this->moveInput(
                    $order,
                    $line,
                    'waste',
                    bcadd($consumed, $waste, self::QUANTITY_SCALE),
                    $valuation,
                    'Batch produced nothing; the whole input is loss.',
                );
            } else {
                $this->moveInput($order, $line, 'consume', $consumed, $valuation, 'Batch consumption.');
                $this->moveInput($order, $line, 'waste', $waste, $valuation, 'Input discarded during the batch.');
            }

            $line->consumed_quantity = $this->roundQuantity($consumed);
            $line->waste_quantity = $this->roundQuantity($waste);
            $line->actual_unit_cost_amount = $valuation?->unitCostAmount;
            $line->cost_currency_code = $valuation === null ? $line->cost_currency_code : $valuation->currencyCode;
            $line->valued_at = $valuation === null ? null : CarbonImmutable::now();
            $line->save();

            $settlement->add($line, $consumed, $waste, $valuation, $producedNothing);
        }

        return $settlement;
    }

    /**
     * One input movement, valued, and never posted twice.
     *
     * The fine idempotency grain: a `(order, stock item, reason)` movement that
     * already exists is a line a previous attempt got through, and re-posting it
     * would deduct the flour again. Checked rather than assumed, because the
     * whole reason a retry is safe is that this check is here.
     */
    private function moveInput(
        ProductionOrder $order,
        ProductionOrderLine $line,
        string $reason,
        string $quantity,
        ?InputValuation $valuation,
        string $note,
    ): void {
        $quantity = $this->numeric($quantity);

        if (bccomp($quantity, '0', self::QUANTITY_SCALE) <= 0) {
            return;
        }

        if ($this->hasMovement($order, (string) $line->stock_item_id, $reason)) {
            return;
        }

        $this->inventory->recordMovement(
            (string) $order->organisation_id,
            (string) $order->branch_id,
            (string) $line->stock_item_id,
            $reason,
            '-'.$quantity,
            ProductionOrder::MOVEMENT_REFERENCE,
            (string) $order->getKey(),
            notes: $note,
            unitCostAmount: $valuation?->unitCostAmount,
            costAmount: $valuation === null ? null : $this->roundMoney(bcmul($quantity, $valuation->unitCostAmount, self::WORKING_SCALE)),
            costCurrencyCode: $valuation?->currencyCode,
            // The batch consumes against its own claim, so it is checked against
            // everyone else's. Without this it would be refused by the very
            // reservation it opened.
            holderType: StockReservation::HOLDER_PRODUCTION_ORDER,
            holderId: (string) $order->getKey(),
        );
    }

    /**
     * What one unit of this line is worth, in the line's own unit.
     *
     * Null when there is no usable figure — no cost row, no average, or a unit
     * that will not convert. The quantity still moves; the money is recorded as
     * missing rather than as zero, which is what makes the batch `partial`
     * instead of quietly cheap.
     */
    private function valueInput(ProductionOrder $order, ProductionOrderLine $line): ?InputValuation
    {
        $cost = IngredientStockCost::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('ingredient_id', $line->ingredient_id)
            ->lockForUpdate()
            ->first();

        if (! $cost instanceof IngredientStockCost) {
            return null;
        }

        if ($cost->moving_average_cost_amount === null || $cost->currency_code === null) {
            return null;
        }

        $costUnit = MeasurementUnit::query()->find($cost->unit_id);
        $lineUnit = MeasurementUnit::query()->find($line->unit_id);

        if (! $costUnit instanceof MeasurementUnit || ! $lineUnit instanceof MeasurementUnit) {
            return null;
        }

        try {
            // A price per unit moves inversely to a quantity, so one unit of the
            // line's unit costs what `pricePerUnit` says rather than what a
            // quantity conversion would say.
            $perLineUnit = $this->conversion->convert('1', $lineUnit, $costUnit);
        } catch (UnitConversionUnsupported) {
            return null;
        }

        return new InputValuation(
            $this->roundMoney(bcmul($perLineUnit, (string) $cost->moving_average_cost_amount, self::WORKING_SCALE)),
            (string) $cost->currency_code,
        );
    }

    /**
     * The batch's cost per unit produced, or null when it cannot honestly be one.
     *
     * `(Σ consumed input cost) ÷ produced`. Input waste is **not** in the
     * numerator: it never became product, and it is reported as production waste
     * instead. Process loss needs no term at all — a batch that planned 40 litres
     * and made 38 divides the same money over 38, which is precisely how the loss
     * raises the unit cost of what was produced.
     *
     * Withheld unless the cost is `complete`, because a partial total reads
     * exactly like a complete one and is smaller.
     *
     * @return numeric-string|null
     */
    private function unitCostFor(ProductionOrder $order, BatchReport $report, BatchSettlement $settlement): ?string
    {
        if ($report->producedNothing()) {
            return null;
        }

        if ($settlement->status() !== ProductionOrder::COST_COMPLETE) {
            return null;
        }

        return $this->roundMoney(bcdiv($settlement->consumedCost, $report->producedQuantity, self::WORKING_SCALE));
    }

    /**
     * Put the batch on the shelf, take the rejected part back off, and blend the
     * finished cost.
     */
    private function settleYield(
        ProductionOrder $order,
        BatchReport $report,
        BatchSettlement $settlement,
        ?string $unitCost,
    ): void {
        $unitCost = $unitCost === null ? null : $this->numeric($unitCost);

        if ($report->producedNothing()) {
            // Nothing to divide, nothing to post, nothing to value. The inputs
            // have already gone out as waste.
            return;
        }

        $ingredientId = $order->production_item_ingredient_id;

        if ($ingredientId === null) {
            $settlement->note('The batch does not say what it produces, so nothing was added to a shelf.');

            return;
        }

        $stockItem = $this->explosion->resolveStockItem(
            (string) $order->organisation_id,
            (string) $ingredientId,
            (string) $order->branch_id,
        );

        if (! $stockItem instanceof StockItem) {
            $settlement->note('The produced ingredient has no stock item at this branch, so the yield was not added to a shelf.');

            return;
        }

        $currency = $settlement->currencyCode;
        $costAmount = $unitCost === null ? null : $this->roundMoney(bcmul($report->producedQuantity, $unitCost, self::WORKING_SCALE));

        if (! $this->hasMovement($order, (string) $stockItem->getKey(), 'yield')) {
            $this->inventory->recordMovement(
                (string) $order->organisation_id,
                (string) $order->branch_id,
                (string) $stockItem->getKey(),
                'yield',
                $report->producedQuantity,
                ProductionOrder::MOVEMENT_REFERENCE,
                (string) $order->getKey(),
                notes: 'Batch yield.',
                unitCostAmount: $unitCost,
                costAmount: $costAmount,
                costCurrencyCode: $unitCost === null ? null : $currency,
            );
        }

        // Rejected units were produced and then thrown away: the whole batch goes
        // on the shelf and the rejected part leaves again at the batch's own unit
        // cost, so the shelf nets to what is usable and the money follows the
        // unit rather than vanishing.
        if (bccomp($report->rejectedQuantity, '0') > 0
            && ! $this->hasMovement($order, (string) $stockItem->getKey(), 'waste')) {
            $this->inventory->recordMovement(
                (string) $order->organisation_id,
                (string) $order->branch_id,
                (string) $stockItem->getKey(),
                'waste',
                '-'.$report->rejectedQuantity,
                ProductionOrder::MOVEMENT_REFERENCE,
                (string) $order->getKey(),
                notes: 'Produced and rejected.',
                unitCostAmount: $unitCost,
                costAmount: $unitCost === null ? null : $this->roundMoney(bcmul($report->rejectedQuantity, $unitCost, self::WORKING_SCALE)),
                costCurrencyCode: $unitCost === null ? null : $currency,
            );
        }

        $this->blendFinishedCost($order, $report, $unitCost, $currency, $settlement);
    }

    /**
     * Blend the batch into the produced ingredient's moving average — but only
     * when the cost is complete.
     *
     * Blending a partial total would corrupt the basis every later sale values
     * against, and raising `quantity_on_hand` at zero cost would silently dilute
     * the average. So the shelf rises, the valuation basis does not, and the
     * divergence is said out loud rather than absorbed.
     */
    private function blendFinishedCost(
        ProductionOrder $order,
        BatchReport $report,
        ?string $unitCost,
        ?string $currency,
        BatchSettlement $settlement,
    ): void {
        $unitCost = $unitCost === null ? null : $this->numeric($unitCost);

        if ($unitCost === null || $currency === null) {
            $settlement->note('The batch cost is not complete, so the produced ingredient\'s average cost was left where it was.');

            return;
        }

        $ingredient = Ingredient::withoutTenancy()->find($order->production_item_ingredient_id);
        $yieldUnit = MeasurementUnit::query()->find($order->planned_yield_unit_id);

        if (! $ingredient instanceof Ingredient || ! $yieldUnit instanceof MeasurementUnit) {
            $settlement->note('The produced ingredient or its yield unit could not be resolved, so no cost was blended.');

            return;
        }

        try {
            $this->costs->recordProducedBatch(
                (string) $order->organisation_id,
                $ingredient,
                $report->producedQuantity,
                $yieldUnit,
                $unitCost,
                $currency,
            );
        } catch (Throwable $exception) {
            // A currency clash or a stranded unit on the *finished* side is a
            // valuation problem, not a reason to lose a batch a kitchen has
            // physically cooked. The stock stands; the basis says why it did not
            // move.
            $settlement->degrade(ProductionOrder::COST_PARTIAL);
            $settlement->note('The yield could not be blended into the produced ingredient\'s cost: '.$exception->getMessage());
        }
    }

    /**
     * The day the batch was made and the day it must be used by (D-144).
     *
     * **The production date is the branch's day**, not the server's: a kitchen
     * in Dubai finishing a batch at 01:00 made it today, which UTC still calls
     * yesterday. Omitted, it is today at the branch; a day that has not arrived
     * there yet is refused, the rule `GoodsReceiptService::dates()` applies to a
     * delivery — a batch that has not been made cannot have been made.
     *
     * **The expiry comes from the recipe when the recipe says.** A recipe with a
     * shelf life dates every batch as production date plus that many days, and a
     * date typed by hand as well is a 422 rather than silently overruled — the
     * cook would otherwise print a label the system disagrees with. Only a batch
     * that put usable units on a shelf is dated: one that made nothing has no
     * food to expire. A recipe with no shelf life keeps the old behaviour, the
     * cook's date or none, and a use-by before the day it was made is refused
     * as the typing slip it always is.
     *
     * Read from the unlocked order before the settlement transaction. The branch
     * and the version never change under a batch, and a shelf life edited in the
     * same instant is a race nobody could observe.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable|null}
     *
     * @throws ApiException
     */
    private function batchDates(ProductionOrder $order, BatchReport $report): array
    {
        $timezone = OrganisationBranch::withoutTenancy()->whereKey($order->branch_id)->value('timezone');
        $today = CarbonImmutable::now(is_string($timezone) ? $timezone : 'UTC')->toDateString();

        $madeOn = $report->productionDate === null
            ? $today
            : CarbonImmutable::parse($report->productionDate)->toDateString();

        if ($madeOn > $today) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A batch cannot be made on a date that has not arrived at this branch yet.',
                ['parameter' => 'production_date'],
            );
        }

        // Parsed without a zone so the stored date is the branch's day itself,
        // not that day's midnight shifted into UTC.
        $productionDate = CarbonImmutable::parse($madeOn)->startOfDay();

        $shelfLifeDays = Recipe::withoutTenancy()
            ->whereIn('id', RecipeVersion::withoutTenancy()->select('recipe_id')->whereKey($order->recipe_version_id))
            ->value('shelf_life_days');

        if (is_numeric($shelfLifeDays)) {
            if ($report->expiryDate !== null) {
                throw new ApiException(
                    ErrorCode::ValidationFailed,
                    'This recipe sets the use-by date from its shelf life, so it cannot also be entered by hand.',
                    ['parameter' => 'expiry_date'],
                );
            }

            return [$productionDate, $report->hasUsableOutput() ? $productionDate->addDays((int) $shelfLifeDays) : null];
        }

        if ($report->expiryDate === null) {
            return [$productionDate, $order->expiry_date];
        }

        $expiryDate = CarbonImmutable::parse($report->expiryDate)->startOfDay();

        if ($expiryDate->lessThan($productionDate)) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A batch cannot be used by a date before the day it was made.',
                ['parameter' => 'expiry_date'],
            );
        }

        return [$productionDate, $expiryDate];
    }

    /**
     * Write what happened onto the order.
     *
     * The lot is minted here, last, and only once: a batch that already carries
     * one keeps it, and a batch with nothing usable never gets one (D-145).
     * {@see ProductionOrderNumbers::lot()} takes its advisory lock at this point,
     * after every stock lock the settlement took, so the two cannot form a cycle.
     */
    private function writeOutcome(
        ProductionOrder $order,
        BatchReport $report,
        BatchSettlement $settlement,
        ?string $unitCost,
        ProductionOrderStatus $ending,
        ?string $abandonReason,
        CarbonImmutable $productionDate,
        ?CarbonImmutable $expiryDate,
    ): void {
        $status = $settlement->status();
        $unitCost = $unitCost === null ? null : $this->numeric($unitCost);

        $order->produced_quantity = $this->roundQuantity($report->producedQuantity);
        $order->rejected_quantity = $this->roundQuantity($report->rejectedQuantity);
        $order->production_date = $productionDate;
        $order->storage_location = $report->storageLocation ?? $order->storage_location;
        $order->expiry_date = $expiryDate;
        $order->notes = $report->notes ?? $order->notes;

        $order->actual_cost_amount = $settlement->currencyCode === null ? null : $this->roundMoney($settlement->consumedCost);
        $order->actual_cost_currency_code = $settlement->currencyCode === null ? null : $settlement->currencyCode;
        $order->actual_cost_status = $status;
        $order->actual_unit_cost_amount = $status === ProductionOrder::COST_COMPLETE ? $unitCost : null;
        $order->valuation_note = $settlement->noteText();

        $order->status = $ending;
        $order->lock_version = $order->lock_version + 1;

        if ($ending === ProductionOrderStatus::Completed) {
            $order->completed_at = CarbonImmutable::now();
        } else {
            $order->abandoned_at = CarbonImmutable::now();
            $order->abandon_reason = $abandonReason;
        }

        if ($order->lot_number === null && $report->hasUsableOutput()) {
            $order->lot_number = $this->numbers->lot((string) $order->organisation_id, $productionDate);
        }

        $order->save();
    }

    /* ── plumbing ────────────────────────────────────────────────────────── */

    /**
     * @throws ProductionStateInvalid
     */
    private function assertCanMoveTo(ProductionOrder $order, ProductionOrderStatus $next, string $verb): void
    {
        if (! $order->status->canTransitionTo($next)) {
            throw new ProductionStateInvalid($order->status, $verb);
        }
    }

    private function lockOrder(ProductionOrder $order): ProductionOrder
    {
        /** @var ProductionOrder $locked */
        $locked = ProductionOrder::withoutTenancy()
            ->whereKey($order->getKey())
            ->lockForUpdate()
            ->firstOrFail();

        return $locked;
    }

    /**
     * @throws ProductionPlanRefused
     */
    private function versionFor(ProductionOrder $order): RecipeVersion
    {
        /** @var RecipeVersion|null $version */
        $version = RecipeVersion::withoutTenancy()->find($order->recipe_version_id);

        if (! $version instanceof RecipeVersion) {
            throw ProductionPlanRefused::planIncomplete([[
                'catalogue_item_id' => null,
                'reason_code' => 'no_recipe_version',
                'detail' => 'This batch names a recipe version that no longer exists.',
            ]]);
        }

        return $version;
    }

    /**
     * The one thing this version makes.
     *
     * @throws ProductionPlanRefused when there is no output, or more than one
     */
    private function soleOutputOf(RecipeVersion $version): RecipeVersionOutput
    {
        /** @var list<RecipeVersionOutput> $outputs */
        $outputs = RecipeVersionOutput::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderByDesc('is_primary')
            ->get()
            ->all();

        if ($outputs === []) {
            throw ProductionPlanRefused::noOutput();
        }

        if (count($outputs) > 1) {
            // Allocating one batch's cost across co-products needs a policy
            // nobody has chosen, and by mass, by value and by a stated ratio give
            // materially different unit costs (OQ-050). A guess here would be a
            // made-up margin on a screen.
            throw ProductionPlanRefused::multipleOutputs(count($outputs));
        }

        return $outputs[0];
    }

    /**
     * The price basis a confirm pins itself to.
     *
     * Read once and stored, so that next Monday's publication cannot move this
     * batch's estimate. Null when nothing has been published yet, which is a
     * kitchen in its first week rather than a fault.
     */
    private function standingPublicationId(string $organisationId): ?string
    {
        $publication = WeeklyPricePublication::query()
            ->withoutGlobalScopes()
            ->where('organisation_id', $organisationId)
            ->orderByDesc('effective_from_date')
            ->orderByDesc('published_at')
            ->orderByDesc('id')
            ->first();

        return $publication === null ? null : (string) $publication->getKey();
    }

    private function writeLines(ProductionOrder $order, BatchPlan $plan): void
    {
        $order->lines()->delete();

        $displayOrder = 0;

        foreach ($plan->lines() as $line) {
            $row = new ProductionOrderLine;
            $row->organisation_id = (string) $order->organisation_id;
            $row->production_order_id = (string) $order->getKey();
            $row->stock_item_id = $line->stockItemId;
            $row->ingredient_id = $line->ingredientId;
            $row->line_kind = $line->kind;
            $row->source_recipe_version_id = $line->sourceRecipeVersionId;
            $row->required_quantity = $this->roundQuantity($line->required);
            $row->unit_id = $line->unitId;
            $row->estimated_unit_cost_amount = $line->estimatedUnitCost;
            $row->cost_source = $line->costSource === 'none' ? null : $line->costSource;
            $row->fallback_unit_cost_amount = $line->costSource === ProductionOrderLine::SOURCE_FALLBACK
                ? $line->estimatedUnitCost
                : null;
            $row->cost_currency_code = $line->currencyCode;
            $row->display_order = $displayOrder++;
            $row->save();
        }
    }

    /**
     * @return array<string, numeric-string>
     */
    private function claimsFrom(BatchPlan $plan): array
    {
        $claims = [];

        foreach ($plan->lines() as $line) {
            $claims[$line->stockItemId] = bcadd(
                $claims[$line->stockItemId] ?? '0',
                $line->required,
                self::QUANTITY_SCALE,
            );
        }

        /** @var array<string, numeric-string> $claims */
        return $claims;
    }

    /**
     * Record what was actually claimed, which is not always what was required.
     *
     * Equal in the ordinary case. They part company after a physical correction
     * leaves a shelf short of its claim, and a line that showed only `required`
     * would hide that from the person about to cook.
     */
    private function recordReservedQuantities(ProductionOrder $order): void
    {
        $claims = $this->reservations->openFor(
            StockReservation::HOLDER_PRODUCTION_ORDER,
            (string) $order->getKey(),
        );

        foreach ($order->lines()->get() as $line) {
            $line->reserved_quantity = $claims[(string) $line->stock_item_id] ?? '0';
            $line->save();
        }
    }

    private function hasMovement(ProductionOrder $order, string $stockItemId, string $reason): bool
    {
        return StockMovement::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('reference_type', ProductionOrder::MOVEMENT_REFERENCE)
            ->where('reference_id', (string) $order->getKey())
            ->where('stock_item_id', $stockItemId)
            ->where('reason', $reason)
            ->exists();
    }

    private function movementCountFor(ProductionOrder $order): int
    {
        return StockMovement::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('reference_type', ProductionOrder::MOVEMENT_REFERENCE)
            ->where('reference_id', (string) $order->getKey())
            ->count();
    }

    /**
     * Round half away from zero to the six places money is stored at.
     *
     * Two rounders rather than one taking a scale, because the half-step has to
     * be a constant for the arithmetic to be checkable — and because a money
     * figure and a shelf quantity are rounded to different places for different
     * reasons, which reads better as two names than as an argument.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function roundMoney(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';

        return bcadd($value, str_starts_with($value, '-') ? '-'.$half : $half, self::SCALE);
    }

    /**
     * Round half away from zero to the four places `stock_levels.quantity` stores.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function roundQuantity(string $value): string
    {
        $half = '0.'.str_repeat('0', self::QUANTITY_SCALE).'5';

        return bcadd($value, str_starts_with($value, '-') ? '-'.$half : $half, self::QUANTITY_SCALE);
    }

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring, which
     * would turn a malformed quantity into a silent no-op movement.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Production settlement received a non-numeric quantity [{$value}].");
        }

        return $value;
    }
}
