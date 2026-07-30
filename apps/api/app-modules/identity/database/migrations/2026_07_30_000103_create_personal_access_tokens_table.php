<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sanctum's personal access tokens, owned by the identity module rather than
 * published from the package, because the platform identifier strategy
 * (plan §8) differs from Sanctum's default: a UUIDv7 primary key and a uuid
 * morph column, since users are keyed by UUIDv7.
 *
 * The token column stores a SHA-256 hash — plaintext tokens exist only in the
 * issuing response. user_devices.token_reference points at the id here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('personal_access_tokens', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuidMorphs('tokenable');
            $table->text('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('personal_access_tokens');
    }
};
