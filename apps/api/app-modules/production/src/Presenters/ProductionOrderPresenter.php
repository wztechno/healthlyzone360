<?php

declare(strict_types=1);

namespace Healthy360\Production\Presenters;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Production\Services\BatchPlan;
use Healthy360\Production\Services\BatchPlanLine;
use Healthy360\Production\Services\StockItemLabels;

/**
 * A batch on the wire (PROD1).
 *
 * ## Money is redacted inside the payload, not refused at the door
 *
 * A chef holds `production.view_organisation` and `production.manage_organisation`
 * and not `production.view_costs_organisation`: they run the batch and do not see
 * what it cost. So `$withCosts` drops the money **fields** rather than the
 * response — a 403 would blank the whole desk for a person entitled to read every
 * quantity on it, which is the `ItemLatestPurchaseIndexController` argument
 * applied one surface over.
 *
 * Absent and null mean different things and both occur. A cost key that is absent
 * is one this reader may not see; a cost key present and null is one nobody could
 * compute. The surface renders the first as nothing at all and the second as an
 * em dash, and collapsing them would tell a kitchen manager that a batch was free.
 *
 * ## Derived figures are computed here rather than stored
 *
 * `usable_yield_quantity` and `yield_variance_quantity` are `produced − rejected`
 * and `produced − planned`. Both are pure functions of columns on the row, and the
 * model computes them; this only spells them on the wire, so a client never has
 * to know which of "38 made, one rejected" is the number on the shelf.
 */
final class ProductionOrderPresenter
{
    public function __construct(private readonly StockItemLabels $labels) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(ProductionOrder $order, bool $withCosts): array
    {
        $payload = [
            'id' => (string) $order->getKey(),
            'reference' => $order->reference,
            'branch_id' => (string) $order->branch_id,
            'recipe_version_id' => (string) $order->recipe_version_id,
            'production_item_ingredient_id' => $order->production_item_ingredient_id,
            // The name beside the id, because a desk showing a uuid where a name
            // belongs is a desk nobody can work from. Eager-loaded by the
            // controllers; null here means the ingredient is gone, which is a
            // different answer from "not loaded" and reads as an em dash.
            'production_item_name_en' => $order->productionItem?->name_en,
            'planned_yield_unit_code' => $order->plannedYieldUnit?->code,
            'status' => $order->status->value,
            'batch_factor' => $order->batch_factor === null ? null : (string) $order->batch_factor,
            'planned_yield' => $order->planned_yield === null ? null : (string) $order->planned_yield,
            'planned_yield_unit_id' => $order->planned_yield_unit_id,
            'produced_quantity' => $order->produced_quantity === null ? null : (string) $order->produced_quantity,
            'rejected_quantity' => $order->rejected_quantity === null ? null : (string) $order->rejected_quantity,
            'usable_yield_quantity' => $order->usableYieldQuantity(),
            'yield_variance_quantity' => $order->yieldVariance(),
            'production_date' => $order->production_date?->toDateString(),
            'batch_reference' => $order->batch_reference,
            'storage_location' => $order->storage_location,
            'expiry_date' => $order->expiry_date?->toDateString(),
            'is_expired' => $order->isExpired(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'started_at' => $order->started_at?->toIso8601String(),
            'completed_at' => $order->completed_at?->toIso8601String(),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'abandoned_at' => $order->abandoned_at?->toIso8601String(),
            'abandon_reason' => $order->abandon_reason,
            'lock_version' => $order->lock_version,
            'notes' => $order->notes,
        ];

        if (! $withCosts) {
            return $payload;
        }

        return $payload + [
            'estimated_cost_amount' => $order->estimated_cost_amount === null ? null : (string) $order->estimated_cost_amount,
            'estimated_cost_currency_code' => $order->estimated_cost_currency_code,
            'weekly_price_publication_id' => $order->weekly_price_publication_id,
            'actual_cost_amount' => $order->actual_cost_amount === null ? null : (string) $order->actual_cost_amount,
            'actual_cost_currency_code' => $order->actual_cost_currency_code,
            'actual_unit_cost_amount' => $order->actual_unit_cost_amount === null ? null : (string) $order->actual_unit_cost_amount,
            'actual_cost_status' => $order->actual_cost_status,
            'valuation_note' => $order->valuation_note,
        ];
    }

    /**
     * @param  list<ProductionOrderLine>  $lines
     * @return list<array<string, mixed>>
     */
    public function lines(array $lines, bool $withCosts): array
    {
        $this->labels->prime(
            array_values(array_map(static fn (ProductionOrderLine $line): string => (string) $line->stock_item_id, $lines)),
            array_values(array_map(static fn (ProductionOrderLine $line): string => (string) $line->unit_id, $lines)),
        );

        return array_values(array_map(fn (ProductionOrderLine $line): array => $this->line($line, $withCosts), $lines));
    }

    /**
     * @return array<string, mixed>
     */
    public function line(ProductionOrderLine $line, bool $withCosts): array
    {
        $payload = [
            'id' => (string) $line->getKey(),
            'stock_item_id' => (string) $line->stock_item_id,
            'ingredient_id' => (string) $line->ingredient_id,
            'line_kind' => $line->line_kind,
            'unit_id' => (string) $line->unit_id,
            // The shelf's own words, not the ingredient's: a line is a claim on a
            // shelf, and the cook walks to the shelf. Null is "nobody can tell
            // you" — a deleted row or one outside this tenant — and reads as an
            // em dash rather than as an unnamed shelf.
            'stock_item_code' => $this->labels->code((string) $line->stock_item_id),
            'stock_item_name_en' => $this->labels->name((string) $line->stock_item_id),
            'unit_code' => $this->labels->unitCode((string) $line->unit_id),
            'required_quantity' => (string) $line->required_quantity,
            'reserved_quantity' => $line->reserved_quantity === null ? null : (string) $line->reserved_quantity,
            'consumed_quantity' => $line->consumed_quantity === null ? null : (string) $line->consumed_quantity,
            'waste_quantity' => $line->waste_quantity === null ? null : (string) $line->waste_quantity,
            'source_recipe_version_id' => $line->source_recipe_version_id,
            'display_order' => $line->display_order,
        ];

        if (! $withCosts) {
            return $payload;
        }

        return $payload + [
            'estimated_unit_cost_amount' => $line->estimated_unit_cost_amount === null ? null : (string) $line->estimated_unit_cost_amount,
            'cost_source' => $line->cost_source,
            'fallback_unit_cost_amount' => $line->fallback_unit_cost_amount === null ? null : (string) $line->fallback_unit_cost_amount,
            'actual_unit_cost_amount' => $line->actual_unit_cost_amount === null ? null : (string) $line->actual_unit_cost_amount,
            'cost_currency_code' => $line->cost_currency_code,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function plan(BatchPlan $plan, bool $withCosts): array
    {
        $all = [...$plan->ingredients, ...$plan->packaging];

        $this->labels->prime(
            array_values(array_map(static fn (BatchPlanLine $line): string => $line->stockItemId, $all)),
            array_values(array_map(static fn (BatchPlanLine $line): string => $line->unitId, $all)),
        );

        $payload = [
            'batch_factor' => $plan->batchFactor,
            'ingredients' => $this->planLines($plan->ingredients, $withCosts),
            'packaging' => $this->planLines($plan->packaging, $withCosts),
            // Never folded into the lines as a zero. "Need nothing for that" and
            // "we could not work out what this needs" are opposite statements.
            'not_computable' => array_values(array_map(static fn (array $failure): array => [
                'reason_code' => $failure['reason_code'],
                'detail' => $failure['detail'],
            ], $plan->failures)),
            'short_line_count' => $plan->shortLineCount(),
            'is_confirmable' => $plan->isConfirmable(),
        ];

        if (! $withCosts) {
            return $payload;
        }

        return $payload + [
            'estimated_cost_amount' => $plan->estimatedCostAmount,
            'currency_code' => $plan->currencyCode,
            'uncosted_line_count' => count($plan->uncostedLines),
            'currency_conflict' => $plan->currencyConflict,
            'weekly_price_publication_id' => $plan->weeklyPricePublicationId,
        ];
    }

    /**
     * The batch's technical sheet, read **only** from what confirm snapshotted
     * (PROD1).
     *
     * ## Why this is not the recipe's technical sheet
     *
     * The recipe sheet answers "what does this cost today", live, and moves when
     * a price is published or a formulation is edited. This answers "what did
     * *that batch* stand on", and must not move at all — a publication id alone
     * does not freeze a fallback price, a produced component's chosen version or
     * the version's nutrition, so the order stores each of those and this reads
     * them back. Two questions, two answers, never one number pretending to be
     * both.
     *
     * ## Nutrition is presented, not recomputed
     *
     * `nutrition_facts` is the version's own block, copied at confirm. It is
     * expressed per 100 g by construction, so the only arithmetic here is the
     * yield figures beside it — and where the version withheld a nutrient
     * because an ingredient's data was incomplete, it stays withheld rather than
     * being summed into a total that looks whole.
     *
     * @param  list<ProductionOrderLine>  $lines
     * @return array<string, mixed>
     */
    public function technicalSheet(ProductionOrder $order, array $lines, bool $withCosts): array
    {
        return [
            'production_order' => $this->summary($order, $withCosts),
            'lines' => $this->lines($lines, $withCosts),
            'yield' => [
                'planned_quantity' => $order->planned_yield === null ? null : (string) $order->planned_yield,
                'produced_quantity' => $order->produced_quantity === null ? null : (string) $order->produced_quantity,
                'rejected_quantity' => $order->rejected_quantity === null ? null : (string) $order->rejected_quantity,
                'usable_quantity' => $order->usableYieldQuantity(),
                'variance_quantity' => $order->yieldVariance(),
                'unit_id' => $order->planned_yield_unit_id,
            ],
            // Null when the version carried none, which is a recipe nobody has
            // derived rather than a meal with no nutrition.
            'nutrition_facts' => $order->nutrition_facts,
            'basis' => [
                'recipe_version_id' => (string) $order->recipe_version_id,
                'confirmed_at' => $order->confirmed_at?->toIso8601String(),
                // Stated even without the costs code: *which* week priced a batch
                // is not itself a price, and a reader who cannot see the money
                // can still see that the estimate is anchored.
                'weekly_price_publication_id' => $order->weekly_price_publication_id,
            ],
        ];
    }

    /**
     * @param  list<BatchPlanLine>  $lines
     * @return list<array<string, mixed>>
     */
    private function planLines(array $lines, bool $withCosts): array
    {
        return array_values(array_map(function (BatchPlanLine $line) use ($withCosts): array {
            $payload = [
                'stock_item_id' => $line->stockItemId,
                'ingredient_id' => $line->ingredientId,
                'line_kind' => $line->kind,
                'unit_id' => $line->unitId,
                'stock_item_code' => $this->labels->code($line->stockItemId),
                'stock_item_name_en' => $this->labels->name($line->stockItemId),
                'unit_code' => $this->labels->unitCode($line->unitId),
                'required' => $line->required,
                'on_hand' => $line->onHand,
                'reserved' => $line->reserved,
                'available' => $line->available,
                'missing' => $line->missing,
            ];

            if (! $withCosts) {
                return $payload;
            }

            return $payload + [
                'estimated_unit_cost_amount' => $line->estimatedUnitCost,
                'estimated_line_cost_amount' => $line->estimatedLineCost,
                'currency_code' => $line->currencyCode,
                'cost_source' => $line->costSource,
                'effective_from' => $line->effectiveFrom,
            ];
        }, $lines));
    }
}
