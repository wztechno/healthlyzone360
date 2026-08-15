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
        Schema::create('production_orders', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->restrictOnDelete();
            $table->string('status', 16)->default('planned');
            $table->decimal('planned_yield', 14, 4)->nullable();
            $table->timestamps();
        });

        DB::statement("ALTER TABLE production_orders ADD CONSTRAINT production_orders_status_check CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled'))");

        Schema::create('production_tasks', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('production_order_id')->constrained('production_orders')->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('status', 16)->default('open');
            $table->timestamps();
        });

        DB::statement("ALTER TABLE production_tasks ADD CONSTRAINT production_tasks_status_check CHECK (status IN ('open', 'done'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('production_tasks');
        Schema::dropIfExists('production_orders');
    }
};
