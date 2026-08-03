<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * B2 completes the record-export shell (master plan v2 Phase B2).
 *
 * B1 built the storage columns as an exact copy of `kyc_documents` — private
 * disk, `disk` + `path` never serialised, `sha256` so the recipient can verify
 * what they downloaded, an expiry — and said the builder was B2's. Four things
 * were missing once the builder existed.
 *
 * **`manifest`.** `row_counts` says how many rows of each kind are in the
 * bundle; the manifest says what each *file* is and what its digest is, plus
 * the notes that make an incomplete export legible — which modules did not
 * exist, which data was deliberately described rather than included. It is
 * stored on the row as well as inside the ZIP so the platform can answer "what
 * did we hand over" after the object has expired and been deleted.
 *
 * **`download_count` and `last_downloaded_by`.** B1's `downloaded_at` records
 * that a download happened, once. An export is the most concentrated
 * collection of one company's data the platform ever produces, so the question
 * that matters is not whether it was fetched but how often and by whom. The
 * audit trail holds the full record; these two are what a list view can show
 * without joining to it.
 *
 * **`purged_at`.** `expired` is a status the purge writes, and this is when.
 * Keeping the row after the bytes are gone is deliberate — a deleted export
 * row would erase the evidence that an export was ever made — so the row needs
 * somewhere to say that its own object no longer exists.
 *
 * The status vocabulary is **not** changed. B1 declared
 * `requested|building|ready|delivered|expired|failed`, which already spans the
 * three states B2 needs; adding `pending` as a synonym for `requested` would
 * be two words for one state, which is how a status column starts lying.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('record_exports', function (Blueprint $table): void {
            $table->jsonb('manifest')->nullable()->after('row_counts')
                ->comment('what is in the bundle, file by file, with digests and the notes that make omissions legible');
            $table->integer('download_count')->default(0)->after('downloaded_at');
            $table->foreignUuid('last_downloaded_by')->nullable()->after('download_count')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('purged_at')->nullable()->after('last_downloaded_by')
                ->comment('when the object was deleted; the row survives it');
        });

        DB::statement('ALTER TABLE record_exports ADD CONSTRAINT record_exports_download_count_check CHECK (download_count >= 0)');

        // An expired export has no bytes. The row stays, the object does not,
        // and a status saying otherwise would offer a download that 404s.
        DB::statement("ALTER TABLE record_exports ADD CONSTRAINT record_exports_expired_check CHECK (status <> 'expired' OR purged_at IS NOT NULL)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE record_exports DROP CONSTRAINT IF EXISTS record_exports_expired_check');
        DB::statement('ALTER TABLE record_exports DROP CONSTRAINT IF EXISTS record_exports_download_count_check');

        Schema::table('record_exports', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('last_downloaded_by');
            $table->dropColumn(['manifest', 'download_count', 'purged_at']);
        });
    }
};
