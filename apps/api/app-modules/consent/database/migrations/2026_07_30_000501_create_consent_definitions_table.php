<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consent_definitions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('code')->comment('e.g. consent.terms, consent.privacy');
            $table->unsignedInteger('version')->comment('versioned text');
            $table->string('purpose');
            $table->text('body_en');
            $table->text('body_ar');
            $table->boolean('is_active')->default(true);
            $table->timestamp('created_at')->nullable();

            $table->unique(['code', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consent_definitions');
    }
};
