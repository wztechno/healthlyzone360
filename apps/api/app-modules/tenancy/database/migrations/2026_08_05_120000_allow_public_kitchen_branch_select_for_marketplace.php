<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Public marketplace discovery must see which kitchens have an active branch.
 *
 * `MarketplaceKitchens::visible()` uses `WHERE EXISTS (SELECT … FROM
 * organisation_branches …)`. Under the Phase 1B org-scope policy, a connection
 * with no `app.organisation_id` (anonymous browse, or a signed-in consumer
 * without a staff context) sees zero branch rows, so every kitchen disappears
 * from `/marketplace/kitchens`, meals and plans.
 *
 * The marketplace already publishes those branch summaries on purpose
 * (`MarketplaceKitchenPresenter`). This SELECT policy makes that same fact
 * readable at the row store: active branches of active kitchens only. Writes
 * stay on the original FOR ALL organisation-match policy.
 */
return new class extends Migration
{
    private const string POLICY = 'rls_organisation_branches_public_kitchen_select';

    /** @var list<string> */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    public function up(): void
    {
        $roles = $this->roles();
        if ($roles === null) {
            return;
        }

        DB::statement('DROP POLICY IF EXISTS '.self::POLICY.' ON organisation_branches');

        DB::statement(
            'CREATE POLICY '.self::POLICY.' ON organisation_branches FOR SELECT TO '.$roles.'
             USING (
                status = \'active\'
                AND EXISTS (
                    SELECT 1
                    FROM organisations o
                    INNER JOIN organisation_types ot ON ot.id = o.organisation_type_id
                    WHERE o.id = organisation_branches.organisation_id
                      AND o.status = \'active\'
                      AND ot.code = \'kitchen\'
                )
             )'
        );
    }

    public function down(): void
    {
        DB::statement('DROP POLICY IF EXISTS '.self::POLICY.' ON organisation_branches');
    }

    private function roles(): ?string
    {
        $existing = collect(self::RUNTIME_ROLES)
            ->filter(static function (string $role): bool {
                $row = DB::selectOne('select 1 as ok from pg_roles where rolname = ?', [$role]);

                return $row !== null;
            })
            ->values()
            ->all();

        if ($existing === []) {
            return null;
        }

        return implode(', ', $existing);
    }
};
