<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The physical detail of a pack: how much is in it, in what unit, in how many
 * pieces, in what sort of container.
 *
 * **The variant identifier is the primary key.** A surrogate key here would
 * permit two pack rows for one variant, which is not a state with a meaning —
 * a pack *is* the variant, seen from the warehouse. One-to-one is the fact,
 * so one-to-one is the constraint, and `catalogue_item_variant_id` as the PK
 * says it without a unique index nobody would think to add.
 *
 * Split from `catalogue_item_variants` rather than nullable columns on it,
 * because a plan configuration has no `pack_quantity` and never will. Six
 * columns that are meaningless for half the rows is how a table stops
 * describing anything.
 *
 * `pack_unit_id` is `restrictOnDelete`: a pack whose unit vanished is a pack
 * whose size is unknown, and silently nulling that is worse than refusing to
 * remove a seeded reference unit.
 *
 * `pack_format` names the container — the bottle/bag/can/gallon/bunch/loose
 * vocabulary the source data uses. It is CHECK-constrained but nullable:
 * plenty of packs have no container worth naming, and `loose` is a real
 * answer rather than a missing one, so the two are kept distinct.
 *
 * `net_weight_grams` is an integer and is nullable. It exists because a
 * customer comparing a 400 g can with a 500 g jar needs one comparable
 * number, and it is nullable because fabricating one for a bunch of parsley
 * is exactly the kind of invented figure this programme refuses to make
 * (master plan §2.4). Never derived from `pack_quantity` — that conversion
 * needs a density this system does not hold.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_item_pack_variants', function (Blueprint $table): void {
            $table->foreignUuid('catalogue_item_variant_id')->primary()->constrained('catalogue_item_variants')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->decimal('pack_quantity', 12, 4);
            $table->foreignUuid('pack_unit_id')->constrained('measurement_units')->restrictOnDelete();
            $table->integer('pack_piece_count')->nullable()->comment('units inside the pack — a tray of twelve is 12');
            $table->string('pack_format', 30)->nullable()->comment('bottle | bag | can | gallon | bunch | loose');
            $table->integer('net_weight_grams')->nullable()->comment('never derived from pack_quantity: that needs a density this system does not hold');
            $table->timestamps();
        });

        DB::statement("ALTER TABLE catalogue_item_pack_variants ADD CONSTRAINT catalogue_item_pack_variants_pack_format_check CHECK (pack_format IS NULL OR pack_format IN ('bottle', 'bag', 'can', 'gallon', 'bunch', 'loose'))");
        DB::statement('ALTER TABLE catalogue_item_pack_variants ADD CONSTRAINT catalogue_item_pack_variants_pack_quantity_check CHECK (pack_quantity > 0)');
        DB::statement('ALTER TABLE catalogue_item_pack_variants ADD CONSTRAINT catalogue_item_pack_variants_pack_piece_count_check CHECK (pack_piece_count IS NULL OR pack_piece_count > 0)');
        DB::statement('ALTER TABLE catalogue_item_pack_variants ADD CONSTRAINT catalogue_item_pack_variants_net_weight_grams_check CHECK (net_weight_grams IS NULL OR net_weight_grams > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_item_pack_variants');
    }
};
