<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feature_entitlements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('feature_definition_id')->index()->constrained('feature_definitions');
            $table->string('status', 20)->default('enabled');
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'feature_definition_id']);
        });

        DB::statement("ALTER TABLE feature_entitlements ADD CONSTRAINT feature_entitlements_status_check CHECK (status IN ('enabled', 'disabled', 'trial'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('feature_entitlements');
    }
};
