<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Tests\Fixtures;

use Closure;
use Illuminate\Support\Facades\DB;

/**
 * The plumbing the row-level security suites share.
 *
 * The test suite connects as the schema owner so RefreshDatabase can migrate
 * and the factories can build two complete tenants; `SET ROLE` is what turns a
 * statement — or a whole HTTP request — into one the runtime role is making,
 * with the policies fully in force.
 */
final class RuntimeRole
{
    public const string NAME = 'healthy360_test';

    /**
     * Execute a callback as the runtime application role.
     *
     * The role is always given back: leaking it into the next assertion would
     * make a passing test meaningless, because the owner sees everything.
     *
     * @template TReturn
     *
     * @param  Closure(): TReturn  $callback
     * @return TReturn
     */
    public static function run(Closure $callback): mixed
    {
        DB::statement('SET ROLE '.self::NAME);

        try {
            return $callback();
        } finally {
            DB::statement('RESET ROLE');
        }
    }

    /**
     * Set the three session variables the policies read. Raw on purpose: this
     * suite must not depend on the middleware it is meant to be a backstop
     * for.
     */
    public static function context(?string $userId = null, ?string $organisationId = null, ?string $branchId = null): void
    {
        DB::statement(
            "select set_config('app.user_id', ?, false),
                    set_config('app.organisation_id', ?, false),
                    set_config('app.branch_id', ?, false)",
            [$userId ?? '', $organisationId ?? '', $branchId ?? ''],
        );
    }

    public static function setting(string $name): string
    {
        /** @var object{value: string|null} $row */
        $row = DB::selectOne("select coalesce(current_setting(?, true), '') as value", [$name]);

        return (string) $row->value;
    }
}
