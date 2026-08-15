<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which runs one plan configuration may be bought for, and what the longer ones
 * take off the price.
 *
 * **`discount_percent` is nullable, and NULL means "nobody has told us"** — it
 * is never coerced to zero on the way in, on the way out, or anywhere in
 * between. The source sheets have cells that are simply empty, and the two
 * possible readings of an empty cell — "no discount applies" and "the discount
 * was not recorded" — are commercially different: the first is a price a
 * kitchen stands behind, the second is a question somebody still has to answer.
 * Writing `0.00` for both would erase the question permanently and quietly, and
 * would be the same class of mistake as `price_list_items` rendering a
 * placeholder as `0` (decision OD-2, risk R9). So NULL survives the round trip,
 * and every consumer has to decide what to do about it.
 *
 * This is **not** where the price lives. `decimal(5,2)` here is a percentage
 * off, applied by whatever quotes the subscription; the amount itself is a
 * `price_list_items` row against the same variant, in the list's currency and
 * in minor units (§4.4). Two numbers in two places because they change at
 * different rates and answer to different people.
 *
 * `is_available` is a real flag rather than the absence of a row, and the
 * asymmetry with the matrix above is deliberate. A cell of the matrix has a
 * price pointing at it, so withdrawing it has to leave the row standing; a
 * duration assignment carries nothing but itself, so "we still run 40 days but
 * not right now" is worth being able to say without deleting the discount
 * somebody negotiated.
 *
 * `plan_duration_id` is `restrictOnDelete` — a duration a plan is sold in is
 * not one to remove; the vocabulary deactivates instead.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_variant_durations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->constrained('catalogue_item_variants')->cascadeOnDelete();
            $table->foreignUuid('plan_duration_id')->constrained('plan_durations')->restrictOnDelete();
            $table->decimal('discount_percent', 5, 2)->nullable()->comment('NULL means nobody has stated one — never coerced to 0');
            $table->boolean('is_available')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['catalogue_item_variant_id', 'plan_duration_id']);
        });

        DB::statement('ALTER TABLE plan_variant_durations ADD CONSTRAINT plan_variant_durations_discount_percent_check CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent < 100))');
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_variant_durations');
    }
};
