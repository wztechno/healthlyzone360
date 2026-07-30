<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Database;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;

/**
 * The bridge between the in-process tenant context and the PostgreSQL session
 * variables the row-level security policies read (plan §11).
 *
 * Three settings are maintained on the runtime connection — `app.user_id`,
 * `app.organisation_id`, `app.branch_id` — and every policy reads them with
 * `current_setting(..., true)`. Clearing writes empty strings rather than
 * unsetting: an empty string compares false against every UUID, so a cleared
 * session is as closed as an absent one, and the statement never depends on
 * a variable having been defined first.
 *
 * The last applied snapshot is remembered so that a repeated apply costs
 * nothing and so a reconnected connection can be brought back to the context
 * the request or job is still operating under.
 */
final class DatabaseTenantContext
{
    private const string APPLY_STATEMENT = "select set_config('app.user_id', ?, false),
               set_config('app.organisation_id', ?, false),
               set_config('app.branch_id', ?, false)";

    /**
     * The settings currently believed to be live on the runtime connection.
     *
     * @var array{user_id: string, organisation_id: string, branch_id: string}
     */
    private array $applied = ['user_id' => '', 'organisation_id' => '', 'branch_id' => ''];

    public function __construct(private readonly DatabaseManager $db) {}

    /**
     * Publish the given context to the runtime connection. A no-op when the
     * connection already carries it.
     */
    public function apply(?string $userId, ?string $organisationId, ?string $branchId): void
    {
        $desired = [
            'user_id' => $userId ?? '',
            'organisation_id' => $organisationId ?? '',
            'branch_id' => $branchId ?? '',
        ];

        if ($desired === $this->applied) {
            return;
        }

        $this->write($desired);
    }

    public function reset(): void
    {
        $this->apply(null, null, null);
    }

    /**
     * Run a callback with the database session declaring exactly the given
     * context, restoring the previous settings afterwards whatever happens.
     *
     * This is the database-session counterpart of the application layer's
     * `withoutTenancy()`: an explicit, auditable statement that a particular
     * query legitimately runs outside the ambient context, rather than an
     * ambient bypass. Every call site is a decision.
     *
     * @template TReturn
     *
     * @param  Closure(): TReturn  $callback
     * @return TReturn
     */
    public function during(?string $userId, ?string $organisationId, ?string $branchId, Closure $callback): mixed
    {
        $previous = $this->applied;

        $this->apply($userId, $organisationId, $branchId);

        try {
            return $callback();
        } finally {
            $this->write($previous);
        }
    }

    /**
     * Run a callback with the session declaring the given person and no
     * organisation.
     *
     * Needed wherever a row is written on behalf of somebody who is not (yet)
     * the authenticated principal of the request — registration recording
     * consent is the foundation's one such path.
     *
     * @template TReturn
     *
     * @param  Closure(): TReturn  $callback
     * @return TReturn
     */
    public function asUser(string $userId, Closure $callback): mixed
    {
        return $this->during($userId, null, null, $callback);
    }

    /**
     * Re-publish the remembered context onto a connection that has just been
     * (re-)established.
     *
     * A dropped connection comes back with an empty session. Without this the
     * next statement would run context-less and — because the policies fail
     * closed — silently see nothing rather than fail, which is the hardest
     * possible symptom to diagnose.
     */
    public function reapplyTo(Connection $connection): void
    {
        if ($this->applied === ['user_id' => '', 'organisation_id' => '', 'branch_id' => '']) {
            return;
        }

        if ($connection->getName() !== $this->db->getDefaultConnection()) {
            return;
        }

        $this->writeTo($connection, $this->applied);
    }

    /**
     * The settings currently published, for assertions and diagnostics.
     *
     * @return array{user_id: string, organisation_id: string, branch_id: string}
     */
    public function applied(): array
    {
        return $this->applied;
    }

    /**
     * @param  array{user_id: string, organisation_id: string, branch_id: string}  $settings
     */
    private function write(array $settings): void
    {
        $this->applied = $settings;

        $this->writeTo($this->db->connection(), $settings);
    }

    /**
     * @param  array{user_id: string, organisation_id: string, branch_id: string}  $settings
     */
    private function writeTo(Connection $connection, array $settings): void
    {
        // The settings are a PostgreSQL feature; another driver (a future
        // read-only analytics connection, a package's sqlite fixture) must not
        // be broken by tenancy bookkeeping it does not participate in.
        if ($connection->getDriverName() !== 'pgsql') {
            return;
        }

        $connection->statement(self::APPLY_STATEMENT, [
            $settings['user_id'],
            $settings['organisation_id'],
            $settings['branch_id'],
        ]);
    }
}
