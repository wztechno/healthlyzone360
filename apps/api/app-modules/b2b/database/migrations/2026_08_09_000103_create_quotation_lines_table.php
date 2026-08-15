<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One article and quantity on a quotation — what the buyer asked for, and,
 * once the kitchen has quoted it, what it costs.
 *
 * **The same two-phase shape `price_list_items` draws, at the row rather than
 * the list.** A buyer drafts `quantity` with no price attached; the kitchen's
 * "quote" action is the one write that ever sets `unit_amount_minor` and
 * `line_total_minor`, together, on a submitted line — never the buyer, and
 * never before submission. `QuotationService` enforces the ordering; the
 * paired-nullability CHECK below enforces the shape.
 *
 * `line_total_minor` is stored rather than computed on read: `quantity *
 * unit_amount_minor` is exact only because both factors are fixed the moment
 * the kitchen quotes, and storing the product is the same call
 * `recipe_version_lines.line_cost_amount` makes for the same reason — a total
 * a buyer was shown must stay reconstructable even if a later line edit ever
 * became legal.
 *
 * Isolation strategy: **`join-rls-parent`** — reachable only through
 * `quotations`, cascade-deleted with it, `organisation_id` denormalised so a
 * future policy on the parent could be evaluated without a join. It carries
 * no policy of its own, for the same app-scope reason the parent does not.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotation_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->comment('the buyer, denormalised from the quotation')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('quotation_id')->constrained('quotations')->cascadeOnDelete();
            $table->integer('line_number');

            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->nullable()->constrained('catalogue_item_variants')->nullOnDelete();

            $table->decimal('quantity', 12, 4);
            $table->bigInteger('unit_amount_minor')->nullable()->comment('set once, by the kitchen quote action, never by the buyer');
            $table->bigInteger('line_total_minor')->nullable()->comment('quantity * unit_amount_minor, stored at the moment it was quoted');

            $table->string('note', 255)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['quotation_id', 'line_number']);
            $table->index('catalogue_item_id');
        });

        DB::statement('ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_line_number_check CHECK (line_number > 0)');
        DB::statement('ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_quantity_check CHECK (quantity > 0)');
        DB::statement('ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_amount_check CHECK (unit_amount_minor IS NULL OR unit_amount_minor >= 0)');
        DB::statement('ALTER TABLE quotation_lines ADD CONSTRAINT quotation_lines_priced_together_check CHECK ((unit_amount_minor IS NULL) = (line_total_minor IS NULL))');
    }

    public function down(): void
    {
        Schema::dropIfExists('quotation_lines');
    }
};
