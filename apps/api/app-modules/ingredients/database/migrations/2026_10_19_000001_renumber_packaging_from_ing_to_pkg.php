<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Packaging a kitchen created before 2026-10-19 was numbered in the ingredient series.
 *
 * `IngredientCatalogueService::create()` always continued `ING-`, whatever the row was filed
 * under, so a box typed in by hand arrived as `ING-338` beside the import's `PKG-001..031`. The
 * create now reads the series off the taxonomy; this moves the rows it already numbered wrongly.
 *
 * Per kitchen, oldest first, each kitchen-owned row under the packaging branch that carries an
 * `ING-` handle takes the next `PKG-` number — counted over the kitchen's own rows and the
 * platform library, which is the scan `nextReferenceFor` makes, so the next create continues
 * after them. The `ING-` numbers they leave are not reissued: the series continues from its
 * highest, and a gap is better than a handle that once meant something else.
 *
 * Platform rows are not touched; the import numbered those correctly. Idempotent — a second run
 * finds no `ING-` packaging left.
 */
return new class extends Migration
{
    public function up(): void
    {
        $packagingCategories = DB::table('ingredient_categories')
            ->where('code', 'like', 'packaging-disposables%')
            ->pluck('id');

        if ($packagingCategories->isEmpty()) {
            return;
        }

        $misnumbered = DB::table('ingredients')
            ->whereNotNull('organisation_id')
            ->whereIn('ingredient_category_id', $packagingCategories)
            ->where('source_ref', '~', '^ING-[0-9]+$')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get(['id', 'organisation_id'])
            ->groupBy('organisation_id');

        foreach ($misnumbered as $organisationId => $rows) {
            $highest = DB::table('ingredients')
                ->where(function ($query) use ($organisationId): void {
                    $query->where('organisation_id', $organisationId)->orWhereNull('organisation_id');
                })
                ->where('source_ref', '~', '^PKG-[0-9]+$')
                ->pluck('source_ref')
                ->map(static fn (string $reference): int => (int) substr($reference, 4))
                ->max() ?? 0;

            foreach ($rows as $row) {
                $highest++;

                DB::table('ingredients')
                    ->where('id', $row->id)
                    ->update(['source_ref' => 'PKG-'.str_pad((string) $highest, 3, '0', STR_PAD_LEFT)]);
            }
        }
    }

    public function down(): void
    {
        // One-way: the `ING-` numbers the rows held are not recorded anywhere to go back to.
    }
};
