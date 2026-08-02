<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The container an organisation's sellable items belong to — one kitchen's
 * range, optionally narrowed to one branch.
 *
 * A thin table on purpose. Everything interesting is on the items; the
 * catalogue exists so a kitchen can hold more than one range at a time (a
 * summer menu drafted beside the live one, a branch-specific list) without
 * that meaning duplicating every item's identity. The alternative — items
 * hanging directly off the organisation — makes "publish the new range" an
 * operation with no subject.
 *
 * `branch_id` is `nullOnDelete`, not `cascade`: closing a branch must not
 * delete the range it was selling. The catalogue falls back to the
 * organisation's, which is the honest outcome, and an order that already
 * points at one of its items still resolves.
 *
 * `status` is `draft | active | archived` — **operational, not the sellable
 * family**. A catalogue is a folder; what a customer sees is the items inside
 * it, and each of those carries its own §4.7 publication state. Giving the
 * folder a publication state too would create two places to ask "is this
 * live" and one of them would eventually be wrong.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.4** —
 * unchanged policy set (appendix D).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogues', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('organisation_branches')->nullOnDelete();
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('status', 20)->default('draft')->comment('draft | active | archived — operational, not the sellable family');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'status']);
        });

        DB::statement("ALTER TABLE catalogues ADD CONSTRAINT catalogues_status_check CHECK (status IN ('draft', 'active', 'archived'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogues');
    }
};
