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
        Schema::create('organisation_subscriptions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->index()->constrained('organisations')->cascadeOnDelete();
            $table->string('package_code')->comment('billing detail deferred');
            $table->string('status', 20)->default('trial');
            $table->timestamp('starts_at');
            $table->timestamp('ends_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();
        });

        DB::statement("ALTER TABLE organisation_subscriptions ADD CONSTRAINT organisation_subscriptions_status_check CHECK (status IN ('trial', 'active', 'lapsed', 'cancelled'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('organisation_subscriptions');
    }
};
