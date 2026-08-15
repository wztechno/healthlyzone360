<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What the customer picked for one slot of one day, when the plan lets them
 * pick.
 *
 * **Free Selection is choose-ahead-of-cut-off with a kitchen-default fallback**
 * (approved semantics §7), and this is the table the choosing happens in. A row
 * may exist before the day is generated (the customer chose), may be written
 * *by* generation (the kitchen default filled the slot), and may be rewritten
 * by generation (§6 substitution) — which is why `source` is a column and not
 * an inference. A complaint about what arrived is answered from `source` plus
 * `replaced_catalogue_item_id`, and from nothing else.
 *
 * **`slot` is a plain vocabulary word, not a foreign key.** `breakfast`,
 * `lunch`, `dinner`, `snack` — the four sittings `meal_combination_options`
 * describes with its three booleans plus the snack the service tier adds. It is
 * not a reference to that table because a choice belongs to a *day of a
 * subscription*, and the combination can be re-pointed by the kitchen without
 * that meaning last Tuesday's lunch was really a dinner. `sequence`
 * disambiguates the kitchen that sells "lunch, twice" — the case
 * `meal_combination_options` keeps representable and which a slot alone would
 * collapse.
 *
 * `catalogue_item_id` is `restrictOnDelete`: a meal somebody is scheduled to
 * receive is not one to delete, exactly as `order_lines` and `cart_items` say.
 *
 * **The safety verdict is stored, not recomputed.** `safety_checked_at` and
 * `unsafe_allergen_classes` record what generation concluded at the moment it
 * concluded it. Allergen mappings change; a customer who was sent a meal the
 * platform believed was safe is owed the record of that belief, and recomputing
 * on read would quietly rewrite history in whichever direction today's data
 * points. The column is named `unsafe_allergen_classes` rather than
 * `..._codes` for the audit-redactor reason the codebase states elsewhere: a
 * key containing `code` is blanked, and a redacted allergen list is not a
 * safety record.
 *
 * Isolation strategy: `join-rls-parent` — reachable only through
 * `subscriptions`, cascade-deleted with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_meal_choices', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('subscription_id')->constrained('subscriptions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('subscription_delivery_id')->nullable()->comment('linked once the day exists; a choice may be made before it does')->constrained('subscription_deliveries')->nullOnDelete();

            $table->date('delivery_date');
            $table->string('slot', 20)->comment('breakfast | lunch | dinner | snack');
            $table->integer('sequence')->default(1)->comment('the kitchen that sells "lunch, twice" — a slot alone would collapse it');

            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->nullable()->constrained('catalogue_item_variants')->restrictOnDelete();

            $table->string('source', 20)->default('customer')->comment('customer | kitchen_default | substituted');
            $table->uuid('replaced_catalogue_item_id')->nullable()->comment('what this stands in for; no FK, so the trail outlives a withdrawn dish');

            $table->timestamp('safety_checked_at')->nullable();
            $table->jsonb('unsafe_allergen_classes')->nullable()->comment('what made the replaced meal unsafe, as it stood then — never named *_code, which the audit redactor blanks');

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['subscription_id', 'delivery_date']);
        });

        DB::statement("ALTER TABLE subscription_meal_choices ADD CONSTRAINT subscription_meal_choices_slot_check CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack'))");
        DB::statement("ALTER TABLE subscription_meal_choices ADD CONSTRAINT subscription_meal_choices_source_check CHECK (source IN ('customer', 'kitchen_default', 'substituted'))");
        DB::statement('ALTER TABLE subscription_meal_choices ADD CONSTRAINT subscription_meal_choices_sequence_check CHECK (sequence > 0)');

        // One meal per slot per sitting per day. Changing a choice is an update
        // of this row, not a second one — two rows for one lunch is how a
        // customer receives two lunches.
        DB::statement('CREATE UNIQUE INDEX subscription_meal_choices_one_per_slot ON subscription_meal_choices (subscription_id, delivery_date, slot, sequence)');
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_meal_choices');
    }
};
