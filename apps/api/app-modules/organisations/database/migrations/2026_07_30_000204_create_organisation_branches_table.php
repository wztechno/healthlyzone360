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
        Schema::create('organisation_branches', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->index()->constrained('organisations')->cascadeOnDelete();
            $table->string('name');
            $table->string('country_code', 2);
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->string('timezone');
            $table->string('status', 20)->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('country_code')->references('code')->on('countries');
        });

        DB::statement("ALTER TABLE organisation_branches ADD CONSTRAINT organisation_branches_status_check CHECK (status IN ('active', 'closed'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('organisation_branches');
    }
};
