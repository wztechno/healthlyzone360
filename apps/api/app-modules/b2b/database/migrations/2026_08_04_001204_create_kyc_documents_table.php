<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Every identity, registration and licensing document the platform holds, for
 * anybody who holds one.
 *
 * **One table, three owners** (appendix D-bis #2). The customers design had a
 * separate `customer_documents`; merging it here was the right call, because
 * the handling rules — private disk, sniffed type, hashed bytes, reviewed by a
 * human, purged on a schedule, never served from a public URL — are identical
 * whether the document proves a person is who they say or proves a company
 * exists. Two tables would have meant two implementations of the same
 * carefulness, and the second one would have been the sloppy one.
 *
 * **Exactly one owner, as real foreign keys** (master plan v2 §4.9, reviewer
 * point 10). `user_id | b2b_application_id | organisation_id`, with
 * `num_nonnulls(...) = 1` and a *named* constraint so a later phase widens it
 * additively rather than rewriting it. No `owner_type`/`owner_id` pair: this
 * is the most sensitive table in the schema, and a polymorphic owner is a
 * foreign key the database cannot check.
 *
 * ## What makes this table safe
 *
 * **The path is never serialised.** `disk` and `path` locate an object in an
 * S3-compatible private bucket, and they are on the §4.8 public denylist. The
 * only supported way to hand a document to a caller is
 * `KycDocumentService::temporaryUrl()`, which mints a short-lived signed URL
 * and audits the access. There is no `url` column, no public disk, and the
 * `private` disk in `config/filesystems.php` deliberately declares no URL at
 * all so that `->url()` cannot be reached for by accident.
 *
 * **`mime_type` is what the bytes are, not what the upload claimed.**
 * `KycDocumentService` sniffs the leading bytes and stores the result here;
 * `declared_mime_type` keeps what the client said, unchanged, because a
 * mismatch between the two is evidence rather than noise. A `.pdf` whose first
 * bytes are `MZ` is refused at the service, and the pair of columns is what
 * lets an investigator see that it was.
 *
 * **`sha256` is the bytes' identity.** It deduplicates re-uploads of the same
 * file against one owner, it lets an agreement's click-wrap evidence name
 * exactly which document was signed, and it survives the object being purged.
 *
 * **`byte_size` is bounded in the schema**, not only in the request. Ten
 * megabytes, checked by the database, because the limit exists to bound what a
 * bucket and a reviewer's browser have to cope with and a limit enforced only
 * by a validator is a limit that ends the day something writes around the
 * validator.
 *
 * **`purge_after` is not nullable.** Every document arrives with an end date.
 * A retention period nobody set is a retention period of forever, and forever
 * is the wrong answer for a passport scan. The window is configuration
 * (`b2b.kyc.retention_days`) and is a *placeholder pending the retention
 * decision*, not a settled legal period — the same honesty J1 applies to
 * provisional accounts (OQ-029).
 *
 * **No malware scanning yet, and that is a stated gate** (master plan v2 Phase
 * B1, INT-008). Sniffing the type is not scanning the content. `scan_status`
 * exists so the gap is visible in the data rather than only in a document, and
 * every row in B1 carries `not_scanned`. Nothing in this phase claims a
 * document is safe to open; the reviewer surface must say so.
 *
 * Isolation strategy: **`platform-only`** — reviewers are platform operators,
 * and a PostgreSQL organisation policy would make review impossible for the
 * two owner kinds that have no organisation at all. The organisation-owned
 * rows are reachable only through the service, which checks the actor. Stated
 * rather than assumed: `RlsTest` pins the protected set, so this table's
 * absence from it is a decision on the record.
 */
return new class extends Migration
{
    /** Ten megabytes, in bytes. */
    private const int MAX_BYTES = 10485760;

    public function up(): void
    {
        Schema::create('kyc_documents', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            // Exactly one of these three. See the class comment.
            $table->foreignUuid('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('b2b_application_id')->nullable()->constrained('b2b_applications')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->nullable()->constrained('organisations')->cascadeOnDelete();

            $table->string('document_kind', 40);

            $table->string('disk', 20)->default('private')->comment('NEVER serialised — §4.8 denylist');
            $table->string('path', 255)->comment('NEVER serialised — the only route to the bytes is a temporary signed URL');
            $table->string('original_filename', 255)->comment('what the uploader called it; shown, never used to build a path');
            $table->string('mime_type', 120)->comment('sniffed from the leading bytes — what the file IS');
            $table->string('declared_mime_type', 120)->nullable()->comment('what the upload CLAIMED; a mismatch is evidence, so it is kept');
            $table->integer('byte_size');
            $table->char('sha256', 64)->comment('identity of the bytes; survives the object being purged');

            $table->string('scan_status', 20)->default('not_scanned')
                ->comment('not_scanned | clean | infected — every B1 row is not_scanned; malware scanning is gated (INT-008)');

            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('uploaded_at');

            $table->string('review_status', 20)->default('pending');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->string('rejection_reason', 40)->nullable();
            $table->text('review_note')->nullable()->comment('internal — reviewer commentary is on the public denylist');

            $table->date('expires_on')->nullable()->comment("the document's own expiry — a trade licence runs out");
            $table->timestamp('purge_after')->comment('retention; the weekly job deletes the object and the row past this. Placeholder period, not a legal one');

            $table->timestamps();

            $table->index(['b2b_application_id', 'document_kind']);
            $table->index(['organisation_id', 'document_kind']);
            $table->index(['user_id', 'document_kind']);
            $table->index(['review_status', 'uploaded_at']);
            $table->index('purge_after');

            // Two rows must never name the same object: purging one would
            // delete the other's bytes out from under it.
            $table->unique(['disk', 'path']);
        });

        DB::statement('ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_owner_check CHECK (num_nonnulls(user_id, b2b_application_id, organisation_id) = 1)');

        DB::statement("ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_kind_check CHECK (document_kind IN ('commercial_registration', 'tax_certificate', 'trade_licence', 'signatory_identification', 'authorisation_letter', 'proof_of_address', 'food_safety_certificate', 'insurance_certificate', 'signed_agreement', 'other'))");
        DB::statement("ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_review_status_check CHECK (review_status IN ('pending', 'accepted', 'rejected', 'superseded'))");
        DB::statement("ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_scan_status_check CHECK (scan_status IN ('not_scanned', 'clean', 'infected'))");
        DB::statement("ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_rejection_reason_check CHECK (rejection_reason IS NULL OR rejection_reason IN ('unreadable', 'wrong_document', 'expired', 'incomplete', 'mismatch', 'other'))");

        // The size limit is the schema's, not only the validator's.
        DB::statement('ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_byte_size_check CHECK (byte_size > 0 AND byte_size <= '.self::MAX_BYTES.')');

        // A review that cannot say when it happened is not a review, and a
        // rejection that cannot say why is not a reason.
        DB::statement("ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_reviewed_check CHECK (review_status = 'pending' OR reviewed_at IS NOT NULL)");
        DB::statement("ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_rejected_check CHECK (review_status <> 'rejected' OR rejection_reason IS NOT NULL)");

        // The same bytes uploaded twice against one owner is one document.
        // Three partial indexes rather than one over a coalesced expression,
        // so each reads as the rule it is.
        DB::statement('CREATE UNIQUE INDEX kyc_documents_application_sha256_unique ON kyc_documents (b2b_application_id, sha256) WHERE b2b_application_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX kyc_documents_organisation_sha256_unique ON kyc_documents (organisation_id, sha256) WHERE organisation_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX kyc_documents_user_sha256_unique ON kyc_documents (user_id, sha256) WHERE user_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('kyc_documents');
    }
};
