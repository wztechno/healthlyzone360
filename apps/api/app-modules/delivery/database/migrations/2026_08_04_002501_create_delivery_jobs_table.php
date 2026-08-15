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
        Schema::create('delivery_jobs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('organisation_branches')->nullOnDelete();
            $table->foreignUuid('driver_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 24)->default('pending');
            $table->string('tracking_status', 24)->default('awaiting_assignment');
            $table->text('proof_of_delivery_notes')->nullable();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();
            $table->unique('order_id');
        });

        DB::statement("ALTER TABLE delivery_jobs ADD CONSTRAINT delivery_jobs_status_check CHECK (status IN ('pending', 'assigned', 'in_transit', 'delivered', 'failed', 'cancelled'))");
        DB::statement("ALTER TABLE delivery_jobs ADD CONSTRAINT delivery_jobs_tracking_status_check CHECK (tracking_status IN ('awaiting_assignment', 'picked_up', 'en_route', 'arrived', 'delivered'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_jobs');
    }
};
