<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A kitchen's storefront copy: a tagline, a description and the cuisines it
 * cooks, each in English and Arabic.
 *
 * On `organisations` rather than `kitchen_service_settings` because the
 * anonymous marketplace reads them, and that table is closed to it by RLS while
 * this row is the one the marketplace already loads for a kitchen. All
 * nullable: an unset field renders as nothing, never as invented copy.
 * Cuisines are free text, a JSON list of strings.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organisations', function (Blueprint $table): void {
            $table->string('tagline_en', 160)->nullable();
            $table->string('tagline_ar', 160)->nullable();
            $table->text('description_en')->nullable();
            $table->text('description_ar')->nullable();
            $table->jsonb('cuisines_en')->nullable();
            $table->jsonb('cuisines_ar')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('organisations', function (Blueprint $table): void {
            $table->dropColumn(['tagline_en', 'tagline_ar', 'description_en', 'description_ar', 'cuisines_en', 'cuisines_ar']);
        });
    }
};
