<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `ingredient_cost_events` becomes an append-only ledger at the grant level
 * (INV1.1), the fourth table to take the `append-only-ledger` treatment after
 * `audit_logs`, `recipe_cost_snapshots` and `stock_movements` — the REVOKE
 * pattern is copied deliberately from
 * `2026_08_09_000012_revoke_writes_on_stock_movements.php`.
 *
 * The cost ledger is the evidence behind every moving-average figure and every
 * COGS valuation INV1.2 will read. `IngredientCostService` only ever inserts
 * into it, but nothing at the database level stopped the application role from
 * rewriting a row after the fact, and a valuation history that can be edited is
 * not a history. Revoking UPDATE and DELETE from the runtime roles makes
 * tampering require the migrator role, which the application never holds.
 *
 * The current-value table `ingredient_stock_costs` is deliberately *not*
 * revoked: it is a running figure the service rewrites on every purchase, so it
 * must stay writable exactly as `stock_levels` does.
 *
 * A database provisioned without the runtime roles (no
 * infrastructure/docker/postgres/init) simply has nothing to revoke and the
 * migration completes.
 */
return new class extends Migration
{
    private const string TABLE = 'ingredient_cost_events';

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

        DB::statement('REVOKE UPDATE, DELETE ON '.self::TABLE." FROM {$roles}");
    }

    public function down(): void
    {
        $roles = $this->roles();

        if ($roles !== null) {
            DB::statement('GRANT UPDATE, DELETE ON '.self::TABLE." TO {$roles}");
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
