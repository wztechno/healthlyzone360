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
        Schema::create('payment_method_records', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->constrained('customer_accounts')->nullOnDelete();
            $table->string('kind', 24)->comment('cash_on_delivery | card | invoice');
            $table->string('label', 120)->nullable();
            $table->string('provider_ref', 120)->nullable()->comment('external token or mandate id — never PAN');
            $table->timestamps();

            $table->index(['organisation_id', 'kind']);
        });

        DB::statement("ALTER TABLE payment_method_records ADD CONSTRAINT payment_method_records_kind_check CHECK (kind IN ('cash_on_delivery', 'card', 'invoice'))");

        Schema::create('payment_intents', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('payment_method_record_id')->nullable()->constrained('payment_method_records')->nullOnDelete();
            $table->string('status', 16)->default('pending');
            $table->string('method_kind', 24);
            $table->string('currency_code', 3);
            $table->unsignedBigInteger('amount_minor');
            $table->string('provider', 48)->nullable();
            $table->string('provider_ref', 120)->nullable();
            $table->timestamp('authorized_at')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('failure_reason', 255)->nullable();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique('order_id');
            $table->index(['organisation_id', 'status']);
            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_status_check CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'cancelled'))");
        DB::statement("ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_method_kind_check CHECK (method_kind IN ('cash_on_delivery', 'card', 'invoice'))");

        Schema::create('refunds', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('payment_intent_id')->constrained('payment_intents')->cascadeOnDelete();
            $table->unsignedBigInteger('amount_minor');
            $table->string('currency_code', 3);
            $table->string('status', 16)->default('pending');
            $table->string('provider_ref', 120)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('pending', 'completed', 'failed'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('refunds');
        Schema::dropIfExists('payment_intents');
        Schema::dropIfExists('payment_method_records');
    }
};
