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
        Schema::create('user_profiles', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->string('given_name');
            $table->string('family_name');
            $table->string('preferred_language_code', 2);
            $table->string('country_code', 2)->nullable();
            $table->string('timezone')->default('UTC');
            $table->string('numbering_system', 4)->default('latn')->comment('default per OQ-001');
            $table->date('date_of_birth')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('preferred_language_code')->references('code')->on('languages');
            $table->foreign('country_code')->references('code')->on('countries');
        });

        DB::statement("ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_numbering_system_check CHECK (numbering_system IN ('latn', 'arab'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('user_profiles');
    }
};
