<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How long a kitchen needs before a delivery, and how long an order may wait
 * before somebody is told. One row per organisation.
 *
 * The columns carry no database default. `KitchenServiceSettingsLookup` creates
 * the row on first read, and the defaults live on `KitchenServiceSettings`, so
 * there is one place to read them and no back-fill for existing kitchens.
 *
 * The `organisation_id` unique index is what makes that first read safe when two
 * requests arrive together: the loser's insert fails and it reads the winner's
 * row.
 *
 * Isolation strategy: `org-rls`. RLS is enabled, not forced, so the migrator
 * keeps working; a database with neither runtime role still ends up fail-closed,
 * with RLS on and no policy.
 */
return new class extends Migration
{
    private const string TABLE = 'kitchen_service_settings';

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
            $table->foreignUuid('organisation_id')->unique()->constrained('organisations')->cascadeOnDelete();
            $table->integer('order_lead_minutes')->comment('how long before a window starts an order must be placed');
            $table->integer('alarm_after_minutes')->comment('open minutes before an unaccepted order alarms on the display');
            $table->integer('manager_alert_after_minutes')->comment('open minutes before an unaccepted order alerts managers');
            $table->integer('owner_alert_after_minutes')->comment('open minutes before an unaccepted order alerts the owner');
            $table->timestamps();
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
