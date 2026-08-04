<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The commercial terms of one subscription plan: how it is sold, how a price
 * is quoted, and what a subscriber may do to a delivery once it is scheduled.
 *
 * **The catalogue item's identifier is the primary key.** A plan *is* a
 * catalogue item seen from the commercial side, so one-to-one is the fact and
 * one-to-one is the constraint — the argument `catalogue_item_pack_variants`
 * makes one level down. Split from `catalogue_items` rather than eight more
 * nullable columns on it, because none of these mean anything for a product or
 * a meal.
 *
 * **`change_cutoff_hours` defaults to 24, and that number is evidence.** Both
 * source systems state the same rule from opposite directions — the workbook
 * operating rule "changes up to 24 hours before delivery" and legacy source B's
 * `Subscription_Plan_Orders` 24-hour amendment window — so the merge preserves
 * *both* by keeping one column with that default rather than inventing a
 * second. It is a column and not a constant because it is a kitchen's
 * commercial decision: a kitchen that preps at dawn may want 36.
 * `CHECK (>= 0)` and not `> 0`: zero means "change it right up to the van
 * leaving", which is a policy somebody may genuinely have.
 *
 * `plan_type` (`both | subscription | limited_time`) is the source workbook's
 * own PLN vocabulary, kept verbatim rather than normalised into two booleans:
 * "sold both ways" is a third answer a kitchen gives, not the conjunction of
 * the other two, and a pair of flags would let it say neither.
 *
 * `pricing_basis` says what the number on a price row *means* for this plan —
 * per day, per week, or the whole run. It lives here rather than on the price
 * because it is a fact about the plan's commercial shape, not about any one
 * tariff, and two lists quoting the same plan on two different bases would be
 * two answers to "what does a week cost".
 *
 * `allows_free_selection`, `skip_allowed` and `pause_allowed` are the
 * subscriber's rights, stored rather than assumed. C1 and S1 read them; nothing
 * in K1.6 enforces them, and the honest statement of that is here rather than
 * in a comment claiming otherwise.
 *
 * Isolation strategy: `join-rls-parent` — reachable only through an item,
 * cascade-deleted with it, `organisation_id` denormalised so a future policy
 * needs no join.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_plan_profiles', function (Blueprint $table): void {
            $table->foreignUuid('catalogue_item_id')->primary()->constrained('catalogue_items')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('plan_type', 20)->default('both')->comment('both | subscription | limited_time — the source PLN vocabulary, kept verbatim');
            $table->string('pricing_basis', 20)->default('per_day')->comment('per_day | per_week | total — what a price row means for this plan');
            $table->boolean('allows_free_selection')->default(false)->comment('may a subscriber choose the dishes, or does the kitchen decide');
            $table->boolean('skip_allowed')->default(true);
            $table->boolean('pause_allowed')->default(true);
            $table->integer('change_cutoff_hours')->default(24)->comment('the 24 h rule — Healthy360 operating rule and legacy source B both, preserved as one column');
            $table->text('summary_en')->nullable();
            $table->text('summary_ar')->nullable();
            $table->timestamps();
        });

        DB::statement("ALTER TABLE subscription_plan_profiles ADD CONSTRAINT subscription_plan_profiles_plan_type_check CHECK (plan_type IN ('both', 'subscription', 'limited_time'))");
        DB::statement("ALTER TABLE subscription_plan_profiles ADD CONSTRAINT subscription_plan_profiles_pricing_basis_check CHECK (pricing_basis IN ('per_day', 'per_week', 'total'))");
        DB::statement('ALTER TABLE subscription_plan_profiles ADD CONSTRAINT subscription_plan_profiles_change_cutoff_hours_check CHECK (change_cutoff_hours >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_plan_profiles');
    }
};
