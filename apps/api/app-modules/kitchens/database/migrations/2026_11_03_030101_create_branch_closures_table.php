<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dates a branch is shut whatever its week says: a holiday, a refit. A range
 * rather than a row a day, because Eid is three days and one decision.
 *
 * Isolation: `org-rls` for writes. Reads stay open, as they do for
 * `branch_opening_hours`: a closure is a customer-facing fact about a place, and
 * the schedule is read from carts and subscription quotes with no organisation
 * declared to the database, where a read policy would silently hide the closure.
 */
return new class extends Migration
{
    private const string TABLE = 'branch_closures';

    /** @var list<string> */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->date('closed_from');
            $table->date('closed_to')->comment('inclusive');
            $table->string('note', 160)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['branch_id', 'closed_to']);
        });

        DB::statement('ALTER TABLE '.self::TABLE.' ADD CONSTRAINT branch_closures_range_check CHECK (closed_to >= closed_from)');
        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $existing = DB::table('pg_roles')->whereIn('rolname', self::RUNTIME_ROLES)->orderBy('rolname')->pluck('rolname')->all();

        if ($existing === []) {
            return;
        }

        $roles = implode(', ', array_map(static fn (string $role): string => '"'.$role.'"', $existing));

        DB::statement('CREATE POLICY rls_branch_closure_read ON '.self::TABLE.' FOR SELECT TO '.$roles.' USING (true)');
        DB::statement('CREATE POLICY rls_branch_closure_insert ON '.self::TABLE.' FOR INSERT TO '.$roles.' WITH CHECK ('.self::ORGANISATION_MATCH.')');
        DB::statement('CREATE POLICY rls_branch_closure_delete ON '.self::TABLE.' FOR DELETE TO '.$roles.' USING ('.self::ORGANISATION_MATCH.')');
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }
};
