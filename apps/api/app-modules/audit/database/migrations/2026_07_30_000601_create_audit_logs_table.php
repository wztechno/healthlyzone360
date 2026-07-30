<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('actor_user_id')->nullable()->index()->comment('null for system events')->constrained('users')->nullOnDelete();
            $table->foreignUuid('organisation_id')->nullable()->constrained('organisations');
            $table->foreignUuid('branch_id')->nullable()->constrained('organisation_branches');
            $table->string('action')->comment('safe audit-event contract');
            $table->string('subject_type');
            $table->uuid('subject_id')->nullable();
            $table->string('purpose_of_use')->nullable()->comment('required for sensitive accesses');
            $table->string('correlation_id')->nullable()->comment('matches X-Correlation-Id');
            $table->jsonb('metadata')->nullable()->comment('redacted; never secrets, bodies or medical content');
            $table->timestamp('occurred_at');
            $table->timestamp('created_at')->nullable();

            $table->index(['organisation_id', 'occurred_at']);
            $table->index(['subject_type', 'subject_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
