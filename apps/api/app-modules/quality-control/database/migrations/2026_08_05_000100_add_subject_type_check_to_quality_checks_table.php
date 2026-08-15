<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Locks `subject_type` to the two subjects a hold can actually bite on (O3):
 * a goods receipt or a production order. Application-level validation
 * refuses anything else on write; this is the defence-in-depth match every
 * other lifecycle-ish column in the kitchen programme already carries.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE quality_checks ADD CONSTRAINT quality_checks_subject_type_check CHECK (subject_type IN ('goods_receipt', 'production_order'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE quality_checks DROP CONSTRAINT quality_checks_subject_type_check');
    }
};
