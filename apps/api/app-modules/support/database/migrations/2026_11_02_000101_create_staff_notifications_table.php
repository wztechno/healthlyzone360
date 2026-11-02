<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What the kitchen's own staff have been told: one row per recipient per alert.
 *
 * Laravel's `notifications` table would have done the job if it could carry the
 * tenant policy, and it cannot: it has no organisation column.
 *
 * **The unique index is the idempotency.** `(user_id, type, subject_id)` is what
 * lets a job that runs every minute repeat itself without alerting anybody
 * twice, so `subject_id` is required: every alert is about something.
 *
 * `subject_type` and `subject_id` are a plain pair, not a foreign key, because
 * the subject lives in another module and an alert outlives nothing it needs to
 * be cascaded with. There is no `updated_at`: a row changes by being read, which
 * `read_at` records, or by coming back as new, which `created_at` does.
 *
 * Isolation strategy: `org-rls`. RLS is enabled, not forced, so the migrator
 * keeps working; a database with neither runtime role still ends up fail-closed,
 * with RLS on and no policy.
 */
return new class extends Migration
{
    private const string TABLE = 'staff_notifications';

    /**
     * The schema owner is absent on purpose: it bypasses RLS by ownership.
     *
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('type');
            $table->string('subject_type');
            $table->uuid('subject_id');
            $table->jsonb('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['user_id', 'type', 'subject_id']);
            $table->index(['organisation_id', 'user_id', 'created_at']);
        });

        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        DB::statement(
            'CREATE POLICY rls_organisation_scope ON '.self::TABLE.' FOR ALL TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list.
     */
    private function roles(): ?string
    {
        /** @var list<string> $existing */
        $existing = DB::connection()
            ->table('pg_roles')
            ->whereIn('rolname', self::RUNTIME_ROLES)
            ->orderBy('rolname')
            ->pluck('rolname')
            ->all();

        if ($existing === []) {
            return null;
        }

        return implode(', ', array_map(static fn (string $role): string => '"'.$role.'"', $existing));
    }
};
