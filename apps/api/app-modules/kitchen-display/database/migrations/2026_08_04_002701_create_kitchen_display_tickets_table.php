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
        Schema::create('kitchen_display_tickets', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->string('source_type', 48);
            $table->uuid('source_id');
            $table->string('station', 64)->default('main');
            $table->string('status', 16)->default('new');
            $table->string('label', 160);
            $table->timestamps();
            $table->index(['branch_id', 'status']);
        });

        DB::statement("ALTER TABLE kitchen_display_tickets ADD CONSTRAINT kitchen_display_tickets_status_check CHECK (status IN ('new', 'preparing', 'ready', 'bumped'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('kitchen_display_tickets');
    }
};
