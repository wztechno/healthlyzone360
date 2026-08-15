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
        Schema::create('stock_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 64);
            $table->string('name_en', 160);
            $table->string('unit_code', 16)->default('kg');
            $table->foreignUuid('ingredient_id')->nullable()->constrained('ingredients')->nullOnDelete();
            $table->timestamps();
            $table->unique(['organisation_id', 'code']);
        });

        Schema::create('stock_levels', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->foreignUuid('stock_item_id')->constrained('stock_items')->cascadeOnDelete();
            $table->decimal('quantity', 14, 4)->default(0);
            $table->timestamps();
            $table->unique(['branch_id', 'stock_item_id']);
        });

        Schema::create('stock_movements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->foreignUuid('stock_item_id')->constrained('stock_items')->cascadeOnDelete();
            $table->decimal('quantity_delta', 14, 4);
            $table->string('reason', 24);
            $table->string('reference_type', 48)->nullable();
            $table->uuid('reference_id')->nullable();
            $table->string('notes', 255)->nullable();
            $table->timestamps();
            $table->index(['branch_id', 'stock_item_id', 'created_at']);
        });

        DB::statement("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check CHECK (reason IN ('adjust', 'waste', 'receipt', 'consume', 'yield'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('stock_levels');
        Schema::dropIfExists('stock_items');
    }
};
