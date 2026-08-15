<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Database\Seeders;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\ReferenceData\Database\Seeders\SeedDataFile;
use Illuminate\Database\Seeder;

/**
 * The fourteen canonical allergen classes — EU-14 as the master list, with US
 * Big-9 membership and the two US-specific rules (coconut as a tree nut,
 * sulphites declarable above 10 ppm) carried as data.
 *
 * Production-safe and committed: this is platform reference data, mechanism
 * (a) of the three (data register, D-046). Nothing confidential is here, and
 * the codes match the frontend `AllergenCode` union one-for-one.
 *
 * `updateOrCreate` on the code, so a re-run converges. The seeder never
 * reactivates a class a platform operator deactivated deliberately, and never
 * changes a code — those are the two things about this table that must not
 * move under an operator's feet.
 */
class AllergenSeeder extends Seeder
{
    public function run(): void
    {
        $pendingReview = [];

        foreach (SeedDataFile::rowsIn(dirname(__DIR__).'/data', 'allergens') as $row) {
            $code = SeedDataFile::string($row, 'code');

            $existing = Allergen::query()->whereKey($code)->first();

            $allergen = $existing ?? new Allergen;
            $allergen->code = $code;
            $allergen->name_en = SeedDataFile::string($row, 'name_en');
            $allergen->name_ar = SeedDataFile::stringOr($row, 'name_ar', 'name_en');
            $allergen->description_en = SeedDataFile::nullableString($row, 'description_en');
            $allergen->description_ar = SeedDataFile::nullableString($row, 'description_ar');
            $allergen->regulatory_ref = SeedDataFile::string($row, 'regulatory_ref');
            $allergen->is_eu_14 = SeedDataFile::boolean($row, 'is_eu_14');
            $allergen->is_us_big_9 = SeedDataFile::boolean($row, 'is_us_big_9');
            $allergen->us_declaration_required = SeedDataFile::boolean($row, 'us_declaration_required');
            $allergen->us_threshold_ppm = SeedDataFile::nullableInteger($row, 'us_threshold_ppm');
            $allergen->display_order = SeedDataFile::integer($row, 'display_order');

            // A class an operator has withdrawn stays withdrawn: re-running a
            // seeder is not a decision to publish something again.
            if ($existing === null) {
                $allergen->is_active = true;
            }

            $allergen->save();

            if (SeedDataFile::nullableString($row, 'translation_status') === 'pending_review') {
                $pendingReview[] = $code;
            }
        }

        if ($pendingReview !== []) {
            $this->command->warn(sprintf(
                'Allergen classes: %d Arabic names/descriptions are awaiting formal review (OQ-033): %s. '
                .'They are standard food-allergen terminology, not a reviewed translation, and legal or '
                .'regulatory wording is never machine-translated.',
                count($pendingReview),
                implode(', ', $pendingReview),
            ));
        }
    }
}
