<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `stock_movements` becomes an append-only ledger at the grant level (INV1.0),
 * the third table to take the `append-only-ledger` treatment after `audit_logs`
 * and `recipe_cost_snapshots` — the REVOKE pattern is copied deliberately from
 * `2026_08_02_000609_extend_row_level_security_to_recipe_cost_snapshots.php`.
 *
 * The movement ledger was append-only by convention only: `recordMovement`
 * never updates or deletes a row, but nothing stopped the application role from
 * doing so, and a stock history that can be edited after the fact is not a
 * history — it is the audit trail behind every COGS figure INV1.2 will value on
 * these rows. Revoking UPDATE and DELETE from the runtime roles makes tampering
 * require the migrator role, which the application never holds.
 *
 * No row-level-security policy is added here. `stock_movements` already carries
 * `organisation_id` and `BelongsToOrganisation`, and this slice scopes the stock
 * tables at the application layer per plan; the ledger property is the one thing
 * a grant enforces that a policy or a scope cannot, so it is the one thing this
 * migration does. A database provisioned without the runtime roles (no
 * infrastructure/docker/postgres/init) simply has nothing to revoke and the
 * migration completes.
 */
return new class extends Migration
{
    private const string TABLE = 'stock_movements';

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
