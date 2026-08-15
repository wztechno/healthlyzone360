<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The facts attached to one catalogue item's stated serving.
 *
 * This deliberately holds the complete public facts payload, including its
 * source and calculation notes.  A value can therefore be replaced by a
 * kitchen-verified analysis without changing the marketplace response shape.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->jsonb('nutrition_facts')
                ->nullable()
                ->comment('Per-serving public nutrition facts with provenance; null until a source is recorded.');
        });
    }

    public function down(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropColumn('nutrition_facts');
        });
    }
};
