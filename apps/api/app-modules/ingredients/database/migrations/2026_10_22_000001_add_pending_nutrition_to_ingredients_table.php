<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A food row added from the recipe editor without a cook confirming its nutrition reference.
 *
 * Non-null means "this row still owes a confirmed reference": the recipe publish gate refuses a
 * formulation built on it, and saving a confirmed reference clears it. `suggestion` is the USDA
 * candidate the assistant picked, re-fetched by the server, or null when there was none.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->jsonb('pending_nutrition')->nullable()->comment('{suggestion: USDA candidate|null} while a confirmed nutrition reference is owed');
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', fn (Blueprint $table) => $table->dropColumn('pending_nutrition'));
    }
};
