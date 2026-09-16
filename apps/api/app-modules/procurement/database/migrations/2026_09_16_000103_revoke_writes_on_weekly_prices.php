<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The weekly price tables become append-only at the grant level (PROD1), the
 * fourth and fifth tables to take the treatment after `audit_logs`,
 * `recipe_cost_snapshots`, `stock_movements` and `ingredient_cost_events`.
 *
 * The property this buys is the one the whole estimating story rests on: a
 * completed production batch records the publication it was estimated against,
 * and the finance report reads last month's estimated margin off rows pinned the
 * same way. If a published price could be edited, both of those become claims
 * about a number that is no longer there — and neither the batch nor the report
 * would show any sign of it. Tampering now requires the migrator role, which the
 * application never holds.
 *
 * A recompute is an insert: a second publication naming the first in
 * `supersedes_id`, and a fresh set of price rows under it. Nothing is corrected
 * in place, which is why `ingredient_weekly_prices` has no `effective_to_date`
 * for supersession to close.
 *
 * A database provisioned without the runtime roles simply has nothing to revoke
 * and the migration completes.
 */
return new class extends Migration
{
    /**
     * @var list<string>
     */
    private const array TABLES = ['weekly_price_publications', 'ingredient_weekly_prices'];

    /**
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    public function up(): void
    {
        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        foreach (self::TABLES as $table) {
            DB::statement("REVOKE UPDATE, DELETE ON {$table} FROM {$roles}");
        }
    }

    public function down(): void
    {
        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        foreach (self::TABLES as $table) {
            DB::statement("GRANT UPDATE, DELETE ON {$table} TO {$roles}");
        }
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list, or null
     * when none do.
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
