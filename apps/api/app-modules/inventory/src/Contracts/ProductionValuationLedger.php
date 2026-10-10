<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Contracts;

use Healthy360\Inventory\Services\NullProductionValuationLedger;

/**
 * How many batches finished in a month without a valuation the report can trust
 * (PROD1).
 *
 * ## Why this is a port rather than a query
 *
 * The monthly cost report needs the figure and lives in **Procurement**;
 * `production_orders` belongs to **Production**, which now depends on Procurement
 * for the moving-average blend. A direct reference would close that cycle, and a
 * raw `DB::table('production_orders')` would dodge the module registry rather than
 * satisfy it — the coupling would be just as real and no longer visible.
 *
 * So Inventory declares the question. It is upstream of both — Procurement depends
 * on it and so does Production — which is what makes this the one place the
 * contract can live without a new edge, the same placement argument
 * `IngredientWeeklyPriceLookup` makes one module over.
 *
 * {@see NullProductionValuationLedger} is the
 * answer before Production is installed: no batches, therefore nothing unvalued,
 * therefore a report that does not flag a month for something that cannot have
 * happened.
 */
interface ProductionValuationLedger
{
    /**
     * Batches completed or abandoned in each month whose cost is not `complete`.
     *
     * Anchored on when the batch *finished*, not when it was cooked, because what
     * is being flagged is when the figure landed in the report: a batch made on
     * the 31st and completed on the 1st moves the new month's numbers.
     *
     * Abandoned batches count. They consumed real stock, and an unvalued
     * abandonment understates a month exactly as an unvalued completion does.
     *
     * Months with nothing unvalued are **absent** rather than present with a zero,
     * so a caller reading with `?? 0` cannot mistake "no batches" for "a batch we
     * could not price".
     *
     * @param  string|null  $from  inclusive `YYYY-MM` lower bound
     * @param  string|null  $to  inclusive `YYYY-MM` upper bound
     * @return array<string, int> keyed by `YYYY-MM`
     */
    public function unvaluedBatchCountByMonth(string $organisationId, ?string $from = null, ?string $to = null): array;
}
