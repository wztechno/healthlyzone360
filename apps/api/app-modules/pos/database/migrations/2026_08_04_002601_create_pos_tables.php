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
        Schema::create('pos_registers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->string('code', 64);
            $table->string('name_en', 120);
            $table->timestamps();
            $table->unique(['branch_id', 'code']);
        });

        Schema::create('pos_shifts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('pos_register_id')->constrained('pos_registers')->cascadeOnDelete();
            $table->foreignUuid('opened_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();
        });

        Schema::create('pos_transactions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('pos_shift_id')->constrained('pos_shifts')->cascadeOnDelete();
            $table->string('currency_code', 3);
            $table->unsignedBigInteger('total_minor');
            $table->string('payment_method_kind', 24);
            $table->string('status', 16)->default('completed');
            $table->timestamps();
            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        Schema::create('pos_transaction_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('pos_transaction_id')->constrained('pos_transactions')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->decimal('quantity', 12, 4);
            $table->unsignedBigInteger('line_total_minor');
            $table->timestamps();
        });

        DB::statement("ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_payment_method_kind_check CHECK (payment_method_kind IN ('cash_on_delivery', 'card', 'invoice'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_transaction_lines');
        Schema::dropIfExists('pos_transactions');
        Schema::dropIfExists('pos_shifts');
        Schema::dropIfExists('pos_registers');
    }
};
