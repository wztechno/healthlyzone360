<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a fixed-menu plan actually serves, on which day of its cycle.
 *
 * ## ⚠ Publishing a menu is the stock cut-over. Read this before the columns.
 *
 * **Today a confirmed fixed-menu subscription order deducts exactly nothing.**
 * Two facts stack to make that true, and both are deliberate:
 *
 *  * `GenerationService` writes **one** order line — the plan itself — for a
 *    plan whose subscribers have made no meal choices. `safeMealsFor()` returns
 *    zero meals for a choiceless day and never invents one, so no meal line is
 *    generated at all.
 *  * `OrderConsumptionService::resolveLine()` matches
 *    `CatalogueItemType::SubscriptionPlan => null` — "the zero-food plan-day
 *    line consumes nothing: the real meal and product lines generated alongside
 *    it do the consuming". When there are no meal lines alongside it, nothing
 *    does the consuming.
 *
 * A kitchen on a fixed menu therefore ships food every day while its shelves,
 * as this platform records them, never move.
 *
 * **The moment a menu is published for a plan, that stops — for that plan, and
 * for no other.** Generation fills each day's slots from the menu, those meal
 * lines are real `order_lines`, and `confirm()` explodes each one through its
 * published recipe and deducts. Which is the point. What comes with it, and
 * must be said before anybody is surprised by it in production:
 *
 *  * every meal on the menu without a published recipe version starts raising
 *    `no_recipe_version` consumption exceptions, one per confirmed order per
 *    day, from the first generated delivery;
 *  * every meal whose recipe version has no `yield_piece_count` starts raising
 *    `no_yield_piece_count` the same way;
 *  * both are **blocking** reasons — they hold the exception open until a
 *    person settles them — so a kitchen that publishes a menu over an
 *    un-recipe'd catalogue buys itself a queue of exceptions, not a silent
 *    failure.
 *
 * **The opt-in is per plan and the opt-in is this table.** There is no feature
 * flag, no organisation switch and no migration that flips a kitchen over. A
 * plan with no entries here behaves exactly as it does today; a plan with
 * entries starts deducting. That granularity is the whole reason the cut-over
 * is safe to ship: a kitchen recipes one plan, publishes its menu, watches the
 * exceptions, and then does the next one. Anything coarser would make the first
 * publish a kitchen-wide event.
 *
 * ## The plan and the dish are both catalogue items, and they delete differently
 *
 * `catalogue_item_id` is **the plan** — `cascadeOnDelete`, because a menu is
 * part of the plan and a plan that is gone has no menu to keep.
 * `meal_catalogue_item_id` is **the dish** — `restrictOnDelete`, the rule
 * `subscription_meal_choices` and `order_lines` already state one table over: a
 * meal somebody is scheduled to receive is not one to delete. Two foreign keys
 * to one table, meaning two different things, so both are named for what they
 * are rather than one of them inheriting the bare column name.
 *
 * ## `slot` is a vocabulary word, not a foreign key — the same argument again
 *
 * `breakfast | lunch | dinner | snack`, exactly `subscription_meal_choices`'s
 * four values, and for exactly the reason that table's own migration gives:
 *
 *   > It is not a reference to that table because a choice belongs to a *day of
 *   > a subscription*, and the combination can be re-pointed by the kitchen
 *   > without that meaning last Tuesday's lunch was really a dinner.
 *
 * A menu entry is the same shape of fact one level up — a day of a *cycle* —
 * and a menu that silently re-labelled itself when a kitchen edited its
 * `meal_combination_options` row would be worse here than there, because a menu
 * is what the production run is planned from. The two tables must agree on the
 * vocabulary because generation copies a menu entry's slot straight onto a
 * choice row; they agree by sharing a CHECK, which is the strongest agreement
 * available without the coupling neither wants.
 *
 * `sequence` is `subscription_meal_choices`'s column verbatim, for its case:
 * the kitchen that sells "lunch, twice", which `meal_combination_options` keeps
 * representable with `meals_per_day` and a slot alone would collapse.
 *
 * ## The unique index is the menu's coordinate system
 *
 * `UNIQUE (catalogue_item_id, cycle_day, slot, sequence)` — one dish per slot
 * per sitting per day of the cycle. No `NULLS NOT DISTINCT` clause is needed
 * because none of the four columns is nullable: unlike the variant matrix,
 * every coordinate of a menu is stated. Two rows at one address is how a
 * subscriber receives two lunches, which is the mistake this index exists to
 * make impossible for an importer and a console session as well as for the
 * service.
 *
 * ## The cycle lives on the profile, and only one service writes it
 *
 * `menu_cycle_days` and `menu_cycle_anchor_date` go on
 * `subscription_plan_profiles` rather than here, because they are facts about
 * the plan, not about any one entry — a cycle length repeated on forty rows is
 * forty chances to disagree. They are nullable together: null means "no menu",
 * which is what every plan means today and what the un-migrated behaviour above
 * keys off.
 *
 * **`PlanProfileService` must never touch them.** That service is a whole-
 * document PUT — every field is `$attributes[…] ?? default` — so adding these
 * two to its field list would make any unrelated profile save silently reset a
 * kitchen's menu cycle to null the first time a client sent a body written
 * before the columns existed. They ride in `PUT /catalogue/plans/{item}/menu`
 * instead, and `PlanMenuService` is their only writer.
 *
 * The anchor is a date and not a timestamp: a cycle turns over at the kitchen's
 * midnight, and a timestamp would invite a timezone question that "which day of
 * the cycle is Thursday" does not have.
 *
 * Isolation strategy: `join-rls-parent` — reachable only through an item,
 * cascade-deleted with it, `organisation_id` denormalised so a future policy
 * needs no join.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_menu_entries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();

            // The plan. Cascade: a menu is part of the plan.
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();

            $table->smallInteger('cycle_day')->comment('1-based day of the plan cycle — day 1 is the anchor date itself');
            $table->string('slot', 20)->comment('breakfast | lunch | dinner | snack — subscription_meal_choices vocabulary, shared by CHECK rather than by FK');
            $table->smallInteger('sequence')->default(1)->comment('the kitchen that sells "lunch, twice" — a slot alone would collapse it');

            // The dish. Restrict: a meal somebody is scheduled to receive is not
            // one to delete, exactly as `order_lines` and
            // `subscription_meal_choices` say.
            $table->foreignUuid('meal_catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'cycle_day', 'slot', 'sequence'], 'plan_menu_entries_one_per_slot');
            $table->index(['organisation_id', 'catalogue_item_id']);
        });

        DB::statement('ALTER TABLE plan_menu_entries ADD CONSTRAINT plan_menu_entries_cycle_day_check CHECK (cycle_day > 0)');
        DB::statement("ALTER TABLE plan_menu_entries ADD CONSTRAINT plan_menu_entries_slot_check CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack'))");
        DB::statement('ALTER TABLE plan_menu_entries ADD CONSTRAINT plan_menu_entries_sequence_check CHECK (sequence > 0)');

        Schema::table('subscription_plan_profiles', function (Blueprint $table): void {
            $table->smallInteger('menu_cycle_days')->nullable()->comment('null = no menu published; the un-migrated behaviour, and the per-plan opt-in switch');
            $table->date('menu_cycle_anchor_date')->nullable()->comment('the date cycle day 1 falls on — a date, not a timestamp: a cycle turns over at the kitchen\'s midnight');
        });

        DB::statement('ALTER TABLE subscription_plan_profiles ADD CONSTRAINT subscription_plan_profiles_menu_cycle_days_check CHECK (menu_cycle_days IS NULL OR menu_cycle_days > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_menu_entries');

        DB::statement('ALTER TABLE subscription_plan_profiles DROP CONSTRAINT IF EXISTS subscription_plan_profiles_menu_cycle_days_check');

        Schema::table('subscription_plan_profiles', function (Blueprint $table): void {
            $table->dropColumn(['menu_cycle_days', 'menu_cycle_anchor_date']);
        });
    }
};
