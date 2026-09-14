<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

/**
 * What one run of {@see IngredientNutritionImporter} did, bucket by bucket.
 *
 * Every row of the document lands in exactly one of the decision buckets —
 * filled, rewritten, left curated, left derived, or untouched because it
 * already said what the file says — and the two density figures and the
 * invalidation fan-out are counted beside them. The seeder prints it, the
 * command prints it and audits it, and the tests assert on it; a returned
 * object rather than console output is what lets all three read the same run.
 */
final readonly class IngredientNutritionImportReport
{
    /**
     * @param  int  $rows  rows in the document, which is every platform food row
     * @param  int  $filled  empty nutrition envelopes the document supplied
     * @param  int  $rewritten  rows still holding exactly what the seeder wrote, whose figures the document has since changed
     * @param  int  $leftCurated  rows somebody has edited since seeding, left exactly as they are
     * @param  int  $leftDerived  rows whose facts a published recipe version owns, skipped entirely
     * @param  int  $skippedUnitMismatch  densities the document states against a unit the row no longer stocks in
     * @param  int  $densitiesFilled  empty `grams_per_unit` figures the document supplied
     * @param  int  $estimated  rows the source flags as estimated rather than measured
     * @param  int  $versionsMarked  published recipe versions marked stale by the writes
     * @param  int  $organisationsReached  the widest single fan-out, not the union — the invalidator counts organisations, never names them
     * @param  list<string>  $rewrittenRefs  the source refs behind `$rewritten`, so a report can name them
     */
    public function __construct(
        public int $rows,
        public int $filled,
        public int $rewritten,
        public int $leftCurated,
        public int $leftDerived,
        public int $skippedUnitMismatch,
        public int $densitiesFilled,
        public int $estimated,
        public int $versionsMarked,
        public int $organisationsReached,
        public array $rewrittenRefs = [],
    ) {}

    /**
     * The buckets under the names the audit metadata and the plan use.
     *
     * Snake case here and camel case on the properties on purpose: the
     * properties follow the language, the keys follow the audit vocabulary,
     * and one translation in one place beats a literal per call site. The
     * rewritten refs are left out — a count is a metric, a list of which
     * reference rows changed is data, and the command prints that.
     *
     * @return array<string, int>
     */
    public function counts(): array
    {
        return [
            'rows' => $this->rows,
            'filled' => $this->filled,
            'rewritten' => $this->rewritten,
            'left_curated' => $this->leftCurated,
            'left_derived' => $this->leftDerived,
            'skipped_unit_mismatch' => $this->skippedUnitMismatch,
            'densities_filled' => $this->densitiesFilled,
            'estimated' => $this->estimated,
            'versions_marked' => $this->versionsMarked,
            'organisations_reached' => $this->organisationsReached,
        ];
    }
}
