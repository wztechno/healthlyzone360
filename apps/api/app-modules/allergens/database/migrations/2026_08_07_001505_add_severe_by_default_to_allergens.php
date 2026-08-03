<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The M1 blocker: the consumer contract asks every allergen class whether it
 * is severe by default, and the platform had no column to answer with.
 *
 * The flag is a **presentation default, never a diagnosis**. It says which
 * classes a first-time declaration form should pre-mark as serious, so that
 * somebody typing "peanut" is offered `anaphylaxis` rather than `dislike` and
 * has to actively downgrade it. What a particular person's reaction actually
 * is remains theirs to state, on `customer_allergen_declarations.severity`,
 * and nothing here overrides it.
 *
 * The seven marked classes are the ones whose reactions are most often
 * systemic rather than local — crustaceans, egg, fish, peanut, tree nut,
 * sesame, mollusc — and the set matches the fixture the frontend has been
 * built against, which is the point: a default the two halves disagree about
 * is worse than no default.
 *
 * Gluten, milk, soy, celery, mustard, sulphites and lupin are deliberately
 * **not** marked. Coeliac disease and a milk allergy can both be extremely
 * serious; what they are not is *reliably* so, and a default that cried wolf
 * on seven more classes would train people to clear it without reading.
 */
return new class extends Migration
{
    /**
     * @var list<string>
     */
    private const array SEVERE = ['crustaceans', 'egg', 'fish', 'peanut', 'tree_nut', 'sesame', 'mollusc'];

    public function up(): void
    {
        Schema::table('allergens', function (Blueprint $table): void {
            $table->boolean('severe_by_default')->default(false)->after('us_threshold_ppm')
                ->comment('pre-marks a declaration form as serious; never a diagnosis');
        });

        DB::table('allergens')->whereIn('code', self::SEVERE)->update(['severe_by_default' => true]);
    }

    public function down(): void
    {
        Schema::table('allergens', function (Blueprint $table): void {
            $table->dropColumn('severe_by_default');
        });
    }
};
