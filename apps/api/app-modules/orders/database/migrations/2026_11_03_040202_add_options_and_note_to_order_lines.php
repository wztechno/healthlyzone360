<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What the customer changed about a dish and what they said about it, copied onto
 * the line as `name_en` is, so renaming an option tomorrow does not rewrite an
 * order.
 *
 * `line_key` is why one order can hold the same dish twice, once without onions.
 * It joins `order_lines_one_row_per_article`, and it is the empty string on every
 * line with neither options nor a note, so those stay one row per article, as
 * every existing line already is.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_lines', function (Blueprint $table): void {
            $table->jsonb('selected_options')->nullable()->comment('snapshot: id, kind, group_en, group_ar, name_en, name_ar');
            $table->string('note', 300)->nullable();
            $table->string('line_key', 40)->default('');
        });

        DB::statement('DROP INDEX order_lines_one_row_per_article');
        DB::statement('CREATE UNIQUE INDEX order_lines_one_row_per_article ON order_lines (order_id, catalogue_item_id, catalogue_item_variant_id, line_key) NULLS NOT DISTINCT');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX order_lines_one_row_per_article');
        DB::statement('CREATE UNIQUE INDEX order_lines_one_row_per_article ON order_lines (order_id, catalogue_item_id, catalogue_item_variant_id) NULLS NOT DISTINCT');

        Schema::table('order_lines', function (Blueprint $table): void {
            $table->dropColumn(['selected_options', 'note', 'line_key']);
        });
    }
};
