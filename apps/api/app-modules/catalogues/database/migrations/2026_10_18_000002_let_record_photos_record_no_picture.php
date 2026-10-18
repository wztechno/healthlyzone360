<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A `record_photos` row may now say "no picture" — the file columns are null.
 *
 * An ingredient whose slug names a bundled stock picture showed it on every list, with no way to
 * take it off: removing the kitchen's own photo only fell back to that stock picture. A fork of the
 * platform's Peach renamed to something else kept Peach's slug, and so Peach's picture. Removing
 * the photo now leaves this row behind with no file, which hides the stock picture too.
 *
 * Either all five file columns are set (a photo) or none is (no picture); the check holds that.
 */
return new class extends Migration
{
    private const FILE_COLUMNS = ['disk', 'path', 'mime_type', 'byte_size', 'sha256'];

    public function up(): void
    {
        Schema::table('record_photos', function (Blueprint $table): void {
            $table->string('disk', 32)->nullable()->change();
            $table->string('path', 255)->nullable()->change();
            $table->string('mime_type', 64)->nullable()->change();
            $table->unsignedInteger('byte_size')->nullable()->change();
            $table->string('sha256', 64)->nullable()->change();
        });

        $set = implode(' AND ', array_map(static fn (string $column): string => $column.' IS NOT NULL', self::FILE_COLUMNS));
        $unset = implode(' AND ', array_map(static fn (string $column): string => $column.' IS NULL', self::FILE_COLUMNS));

        DB::statement("ALTER TABLE record_photos ADD CONSTRAINT record_photos_file_all_or_none_check CHECK (({$set}) OR ({$unset}))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE record_photos DROP CONSTRAINT IF EXISTS record_photos_file_all_or_none_check');
        DB::table('record_photos')->whereNull('path')->delete();

        Schema::table('record_photos', function (Blueprint $table): void {
            $table->string('disk', 32)->nullable(false)->change();
            $table->string('path', 255)->nullable(false)->change();
            $table->string('mime_type', 64)->nullable(false)->change();
            $table->unsignedInteger('byte_size')->nullable(false)->change();
            $table->string('sha256', 64)->nullable(false)->change();
        });
    }
};
