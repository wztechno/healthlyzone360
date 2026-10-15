<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A kitchen's own photo of an ingredient, a recipe or a catalogue item (BUG-14).
 *
 * One table for the three, keyed by `(subject_type, subject_id)`, because a photo is the same thing
 * whichever record it shows and the three records live in three modules. One photo per record:
 * replacing it overwrites the row and deletes the old file.
 *
 * The bytes live on a disk (`filesystems.record_photos_disk`, `local` by default — the API's persistent
 * storage volume on the droplet); this row only says where and what they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('record_photos', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('subject_type', 24);
            $table->uuid('subject_id');
            $table->string('disk', 32);
            $table->string('path', 255);
            $table->string('mime_type', 64);
            $table->unsignedInteger('byte_size');
            $table->string('sha256', 64);
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['subject_type', 'subject_id']);
            $table->index('organisation_id');
        });

        DB::statement("ALTER TABLE record_photos ADD CONSTRAINT record_photos_subject_type_check CHECK (subject_type IN ('ingredient', 'recipe', 'catalogue_item'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('record_photos');
    }
};
