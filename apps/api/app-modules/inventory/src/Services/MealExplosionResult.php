<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Models\OrderConsumptionException;

/**
 * What a meal's recipe explodes into: how much of which branch stock item one
 * order of that meal needs, and the reason for every ingredient that could not
 * be answered at all.
 *
 * Rows and failures are disjoint per ingredient by construction. An ingredient
 * either resolves to exactly one quantity or records exactly one reason it
 * could not — every refusal inside {@see MealExplosion} abandons that
 * ingredient — and an ingredient whose computed quantity rounds to zero
 * contributes neither. So `rows` is never a partial answer to a failed
 * ingredient, and a caller may sum it without first checking `failures`.
 *
 * Nothing here has written anything. The result is a *reading* of a recipe
 * against a shelf, which is what lets {@see OrderConsumptionService} deduct
 * from it and a requirement forecast add many of them up, without either
 * learning the other's job.
 *
 * The stock item and its unit come back as ids rather than models on purpose:
 * a forecast sums thousands of these across a date range and wants to group by
 * id without hydrating anything, while the one caller that does need the models
 * is about to write against those two rows anyway.
 *
 * `ConsumptionFailure` is defined here rather than on the service because both
 * halves now speak it — the explosion produces the failures, the service
 * persists them as {@see OrderConsumptionException} rows — and the shape must
 * stay one shape.
 *
 * @phpstan-type ConsumptionFailure array{catalogue_item_id: string|null, reason_code: string, detail: string}
 * @phpstan-type ExplodedIngredient array{stock_item_id: string, stock_unit_id: string, ingredient_id: string, quantity: numeric-string}
 */
final readonly class MealExplosionResult
{
    /**
     * @param  list<ExplodedIngredient>  $rows  one per ingredient that resolved to a quantity above zero
     * @param  list<ConsumptionFailure>  $failures  one per ingredient (or per meal) that could not be answered
     */
    public function __construct(
        public array $rows = [],
        public array $failures = [],
    ) {}
}
