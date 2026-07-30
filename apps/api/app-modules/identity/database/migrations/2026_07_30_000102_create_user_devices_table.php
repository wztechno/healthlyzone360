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
        Schema::create('user_devices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->index()->constrained('users')->cascadeOnDelete();
            $table->string('device_name');
            $table->string('platform', 10);
            $table->string('app_version')->nullable();
            $table->string('token_reference')->comment('Sanctum token id; no raw tokens');
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        DB::statement("ALTER TABLE user_devices ADD CONSTRAINT user_devices_platform_check CHECK (platform IN ('ios', 'android', 'web'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('user_devices');
    }
};
