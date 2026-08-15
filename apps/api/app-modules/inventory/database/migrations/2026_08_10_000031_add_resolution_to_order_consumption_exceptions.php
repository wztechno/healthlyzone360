<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Give a consumption exception a resolution state, so the kitchen has somewhere
 * to mark one handled and the review surface can tell the still-open ones apart
 * from the settled ones (INV1.5 Part A).
 *
 * INV1.2 recorded *what* a confirmed order could not deduct honestly but gave the
 * row no lifecycle: every exception looked equally live forever. Three nullable
 * columns turn it into a work item.
 *
 * - `resolved_at` — the moment it was settled. **An unresolved exception is one
 *   whose `resolved_at` is null**; that single predicate drives the review list's
 *   filter, the hub badge count and the monthly report's data-quality flag, so
 *   there is no separate boolean to keep in step with it.
 * - `resolved_by` — the user who settled it, a real FK to `users` with
 *   `nullOnDelete`: an exception is a record that must outlive whoever closed it,
 *   so a deleted user leaves the resolution standing with its author blanked
 *   rather than deleting the row.
 * - `resolution_note` — the optional reason a person typed, or the sentence the
 *   retry path writes when it auto-resolves a line that now consumes cleanly.
 *
 * All three are nullable and default-null, so every existing row is simply
 * unresolved — which is exactly what it was before this migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_consumption_exceptions', function (Blueprint $table): void {
            $table->timestampTz('resolved_at')->nullable()->after('detail');
            $table->foreignUuid('resolved_by')->nullable()->after('resolved_at')->constrained('users')->nullOnDelete();
            $table->string('resolution_note', 500)->nullable()->after('resolved_by');

            // The list filters and the badge counts on "still open", scoped to the
            // organisation — an index on that pair keeps the unresolved read cheap.
            $table->index(['organisation_id', 'resolved_at']);
        });
    }

    public function down(): void
    {
        Schema::table('order_consumption_exceptions', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'resolved_at']);
            $table->dropConstrainedForeignId('resolved_by');
            $table->dropColumn(['resolved_at', 'resolution_note']);
        });
    }
};
