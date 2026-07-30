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
        Schema::create('consent_grants', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->index()->constrained('users');
            $table->foreignUuid('consent_definition_id')->index()->constrained('consent_definitions');
            $table->foreignUuid('organisation_id')->nullable()->index()->comment('null = platform-level consent')->constrained('organisations');
            $table->string('status', 20)->default('granted');
            $table->timestamp('granted_at');
            $table->timestamp('withdrawn_at')->nullable();
            $table->string('channel', 10);
            $table->timestamp('created_at')->nullable();
        });

        DB::statement("ALTER TABLE consent_grants ADD CONSTRAINT consent_grants_status_check CHECK (status IN ('granted', 'withdrawn'))");
        DB::statement("ALTER TABLE consent_grants ADD CONSTRAINT consent_grants_channel_check CHECK (channel IN ('web', 'ios', 'android'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('consent_grants');
    }
};
