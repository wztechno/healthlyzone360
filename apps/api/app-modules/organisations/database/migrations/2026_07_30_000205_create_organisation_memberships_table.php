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
        Schema::create('organisation_memberships', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('user_id')->index()->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->index()->comment('null = organisation-wide')->constrained('organisation_branches');
            $table->string('status', 20)->default('invited');
            $table->timestamp('joined_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'user_id']);
        });

        DB::statement("ALTER TABLE organisation_memberships ADD CONSTRAINT organisation_memberships_status_check CHECK (status IN ('invited', 'active', 'suspended', 'ended'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('organisation_memberships');
    }
};
