<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dish margins become one row per item × pack × place (plan S7).
 *
 * A margin is now a pack's price on a place's public tariff against what that
 * pack costs, so the row names the pack. `channel` keeps its name and holds the
 * place: `home` or `business` — the counter charges the Home shop price and has
 * no rows. The pack is null only on the one row a dish with no pack, or no
 * published recipe, keeps to say so; `NULLS NOT DISTINCT` makes that one row,
 * not an unlimited supply. `pack_label` is the pack's name as of the run, for
 * display; `contents_amount` is what the fill costs, stated even while the
 * packaging is unknown.
 *
 * A read model, rebuilt by `RefreshDishMargins`: the old rows are deleted rather
 * than translated, both ways. A variant deleted takes its rows with it.
 */
return new class extends Migration
{
    private const string OLD_UNIQUE = 'dish_margins_catalogue_item_id_channel_unique';

    private const string NEW_UNIQUE = 'dish_margins_one_row_per_pack_and_place';

    public function up(): void
    {
        DB::table('dish_margins')->delete();

        DB::statement('ALTER TABLE dish_margins DROP CONSTRAINT dish_margins_channel_check');

        Schema::table('dish_margins', function (Blueprint $table): void {
            $table->dropUnique(self::OLD_UNIQUE);
            $table->foreignUuid('catalogue_item_variant_id')->nullable()
                ->constrained('catalogue_item_variants')->cascadeOnDelete();
            $table->string('pack_label', 160)->nullable();
            $table->decimal('contents_amount', 18, 6)->nullable();
        });

        DB::statement("ALTER TABLE dish_margins ADD CONSTRAINT dish_margins_channel_check CHECK (channel IN ('home', 'business'))");
        DB::statement('CREATE UNIQUE INDEX '.self::NEW_UNIQUE.' ON dish_margins (catalogue_item_id, catalogue_item_variant_id, channel) NULLS NOT DISTINCT');
    }

    public function down(): void
    {
        DB::table('dish_margins')->delete();

        DB::statement('DROP INDEX '.self::NEW_UNIQUE);
        DB::statement('ALTER TABLE dish_margins DROP CONSTRAINT dish_margins_channel_check');

        Schema::table('dish_margins', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('catalogue_item_variant_id');
            $table->dropColumn(['pack_label', 'contents_amount']);
            $table->unique(['catalogue_item_id', 'channel']);
        });

        DB::statement("ALTER TABLE dish_margins ADD CONSTRAINT dish_margins_channel_check CHECK (channel IN ('b2c', 'b2b'))");
    }
};
