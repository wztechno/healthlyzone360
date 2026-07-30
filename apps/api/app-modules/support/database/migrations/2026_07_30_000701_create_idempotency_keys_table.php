<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('key')->comment('client-supplied Idempotency-Key');
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->nullable()->index()->constrained('organisations');
            $table->string('endpoint')->comment('scoped per endpoint');
            $table->string('request_fingerprint')->comment('hash; no request bodies stored');
            $table->string('response_status', 10)->nullable();
            $table->jsonb('response_snapshot')->nullable()->comment('envelope only, redacted');
            $table->timestamp('expires_at');
            $table->timestamp('created_at')->nullable();

            $table->unique(['key', 'user_id', 'endpoint']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
