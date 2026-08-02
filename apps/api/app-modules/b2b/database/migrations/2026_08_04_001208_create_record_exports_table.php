<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A copy of an organisation's own records, built for it to take away —
 * **shell only** (master plan v2 Phase B2).
 *
 * Table, states and model in B1; the builder in B2. What an export contains is
 * determined by which modules exist, so writing the builder now would produce
 * an export that silently omits orders, invoices and subscriptions and looks
 * complete while doing it.
 *
 * The storage columns copy `kyc_documents` exactly, and deliberately: an export
 * is a bundle of the most sensitive data the platform holds about one company,
 * so it lives on the same private disk, is located by `disk` + `path` that are
 * **never serialised**, is fingerprinted with `sha256` so the recipient can
 * verify what they downloaded, and expires. Anything weaker for an export than
 * for one identity document would be the wrong way round.
 *
 * `row_counts` is the honesty column: an export states how many rows of each
 * kind it contains, so "your data" is checkable rather than asserted. It is
 * also what makes an incomplete export visible — a bundle listing zero orders
 * because the module did not exist reads differently from one that omits the
 * key entirely.
 *
 * Isolation strategy: **`org-rls`**, unimplemented in B1; B2 adds the policy
 * with the read path.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('record_exports', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            // Null = an export requested in the ordinary course, rather than
            // because the relationship is ending.
            $table->foreignUuid('b2b_offboarding_id')->nullable()->constrained('b2b_offboardings')->nullOnDelete();

            $table->string('status', 20)->default('requested');
            $table->string('format', 10)->default('zip');

            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('requested_at');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();

            $table->string('disk', 20)->nullable()->comment('NEVER serialised — same rule as kyc_documents');
            $table->string('path', 255)->nullable()->comment('NEVER serialised; reached only by a temporary signed URL');
            $table->bigInteger('byte_size')->nullable();
            $table->char('sha256', 64)->nullable()->comment('so the recipient can verify what they downloaded');
            $table->jsonb('row_counts')->nullable()->comment('what is in the bundle, per record kind — makes an incomplete export visible');

            $table->timestamp('expires_at')->nullable();
            $table->timestamp('downloaded_at')->nullable();
            $table->text('failure_reason')->nullable();

            $table->timestamps();

            $table->index(['organisation_id', 'status']);
            $table->index('expires_at');
        });

        DB::statement("ALTER TABLE record_exports ADD CONSTRAINT record_exports_status_check CHECK (status IN ('requested', 'building', 'ready', 'delivered', 'expired', 'failed'))");
        DB::statement("ALTER TABLE record_exports ADD CONSTRAINT record_exports_format_check CHECK (format IN ('zip', 'jsonl'))");
        DB::statement('ALTER TABLE record_exports ADD CONSTRAINT record_exports_byte_size_check CHECK (byte_size IS NULL OR byte_size > 0)');

        // A ready export has bytes somewhere and a fingerprint for them.
        DB::statement("ALTER TABLE record_exports ADD CONSTRAINT record_exports_ready_check CHECK (status NOT IN ('ready', 'delivered') OR (disk IS NOT NULL AND path IS NOT NULL AND sha256 IS NOT NULL))");
        DB::statement("ALTER TABLE record_exports ADD CONSTRAINT record_exports_failed_check CHECK (status <> 'failed' OR failure_reason IS NOT NULL)");
    }

    public function down(): void
    {
        Schema::dropIfExists('record_exports');
    }
};
