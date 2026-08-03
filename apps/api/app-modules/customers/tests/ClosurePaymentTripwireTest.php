<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Customers\Closure\Blockers\PaymentMethodsBlocker;
use Healthy360\Customers\Closure\Blockers\WalletBalanceBlocker;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Enums\BlockerStatus;
use Healthy360\Customers\Closure\Services\ClosureBlockerRegistry;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The payment tripwire
|--------------------------------------------------------------------------
|
| Two of the six closure blockers report `not_applicable` today: there are no
| wallets and no stored payment instruments on this platform, so nothing was
| checked and both say so. That is honest right now and it is a lie waiting to
| happen. The failure mode is specific and it is not hypothetical:
|
|   1. PAY1 lands and adds a `payment_methods` table.
|   2. Nobody remembers that a closure screen has an opinion about payment.
|   3. `PaymentMethodsBlocker` keeps returning `no_payment_module`.
|   4. Customers close their accounts and are told, on the screen, that there
|      is nothing to settle — while a stored card token survives the erasure.
|
| Nothing in the ordinary course of review catches that, because every file
| involved is individually correct. Only a test that watches the *schema* can,
| which is why the master plan (decision 13) keeps this one by name and why the
| reviewer endorsed it.
|
| So: any table whose name contains `wallet`, `payment` or `card` must be
| claimed by a registered blocker that declares the fragment in `COVERS`, and
| any blocker claiming a table that now exists must have stopped saying
| `not_applicable`. The two assertions are a pair — the first catches a new
| table nobody wired up, the second catches a wired-up table whose blocker was
| never made real.
|
| **What this test deliberately does not do** is invent the payment blockers'
| eventual logic. It asserts that somebody will be forced to write it, at the
| moment it becomes writable, and no earlier.
|
| SPEED MODE: one of the kept tests, and the only architecture test in J2.
|
*/

/**
 * The schema questions this file asks, as a class rather than as Pest helper
 * functions.
 *
 * Pest loads the whole suite into one process, so a top-level `function
 * suspectTables()` here and another anywhere else would be a fatal
 * redeclaration rather than a test failure — the reason every module world in
 * this codebase is a class. The name is long for the same reason.
 */
final class J2ClosureTripwireSchema
{
    /**
     * Table-name fragments that make a table closure's business, mapped to the
     * blocker that claims each.
     *
     * Read from the blockers rather than restated here, so a fragment cannot be
     * added to a blocker without this file seeing it — nor quietly removed from
     * one to make this file pass.
     *
     * @return array<string, string> fragment => blocker code
     */
    public static function coveredFragments(): array
    {
        $map = [];

        foreach (WalletBalanceBlocker::COVERS as $fragment) {
            $map[$fragment] = (new WalletBalanceBlocker)->code();
        }

        foreach (PaymentMethodsBlocker::COVERS as $fragment) {
            $map[$fragment] = (new PaymentMethodsBlocker)->code();
        }

        return $map;
    }

    /**
     * Every table in the schema that looks like it holds money or an
     * instrument for moving it.
     *
     * @return list<string>
     */
    public static function suspectTables(): array
    {
        /** @var list<string> $tables */
        $tables = DB::table('information_schema.tables')
            ->where('table_schema', 'public')
            ->where('table_type', 'BASE TABLE')
            ->pluck('table_name')
            ->all();

        $fragments = array_keys(self::coveredFragments());
        $suspects = [];

        foreach ($tables as $table) {
            if (in_array($table, PaymentMethodsBlocker::EXCLUDED_TABLES, true)) {
                continue;
            }

            foreach ($fragments as $fragment) {
                if (str_contains($table, $fragment)) {
                    $suspects[] = $table;

                    break;
                }
            }
        }

        return $suspects;
    }

    /**
     * The blocker code claiming this table, if any.
     */
    public static function claimantFor(string $table): ?string
    {
        foreach (self::coveredFragments() as $fragment => $code) {
            if (str_contains($table, $fragment)) {
                return $code;
            }
        }

        return null;
    }

    /**
     * The fragments one blocker claims.
     *
     * @return list<string>
     */
    public static function coveredFragmentsFor(ClosureBlocker $blocker): array
    {
        return array_keys(array_filter(
            self::coveredFragments(),
            static fn (string $code): bool => $code === $blocker->code(),
        ));
    }

    /**
     * The suspect tables one blocker has claimed.
     *
     * @param  list<string>  $tables
     * @return list<string>
     */
    public static function tablesClaimedBy(ClosureBlocker $blocker, array $tables): array
    {
        return array_values(array_filter(
            $tables,
            static fn (string $table): bool => self::claimantFor($table) === $blocker->code(),
        ));
    }
}

it('claims every wallet, payment or card table with a registered closure blocker', function (): void {
    $registered = app(ClosureBlockerRegistry::class)->codes();

    // Asserted unconditionally, because today there are no matching tables and
    // the loop below runs zero times. Without this the test would pass while
    // asserting nothing — and would keep passing if somebody removed both
    // blockers from the registry, which is precisely the state it exists to
    // prevent.
    expect($registered)->toContain('wallet_balance')->toContain('payment_methods');

    foreach (J2ClosureTripwireSchema::suspectTables() as $table) {
        $claimant = J2ClosureTripwireSchema::claimantFor($table);

        $this->assertNotNull(
            $claimant,
            "'{$table}' looks like it holds money or a payment instrument and no closure blocker declares it. "
            .'Add the fragment to a blocker COVERS list, or exclude the table by name with a stated reason.',
        );

        $this->assertContains(
            $claimant,
            $registered,
            "'{$table}' is claimed by '{$claimant}', which is not registered in ClosureBlockerRegistry. "
            .'A blocker nobody runs protects nobody.',
        );
    }
});

it('refuses to let a blocker keep saying not_applicable once its tables exist', function (): void {
    $tables = J2ClosureTripwireSchema::suspectTables();
    $user = new User;

    foreach (app(ClosureBlockerRegistry::class)->all() as $blocker) {
        if (J2ClosureTripwireSchema::coveredFragmentsFor($blocker) === []) {
            // A blocker that claims no tables — orders, subscriptions,
            // memberships — is not this file's business.
            continue;
        }

        $present = J2ClosureTripwireSchema::tablesClaimedBy($blocker, $tables);
        $status = $blocker->evaluate($user, null)->status;

        if ($present === []) {
            // Nothing to check against, so `not_applicable` is the truth —
            // asserted positively rather than skipped, so the test still says
            // something today and so the failure when PAY1 lands points at the
            // right line.
            $this->assertSame(
                BlockerStatus::NotApplicable,
                $status,
                "'{$blocker->code()}' reports something other than not_applicable while no table it claims exists. "
                .'A blocker that found nothing to check must say so.',
            );

            continue;
        }

        $this->assertNotSame(
            BlockerStatus::NotApplicable,
            $status,
            "'{$blocker->code()}' still reports not_applicable, but ".implode(', ', $present)
            .' now exists. A closure screen is telling customers nothing needs settling while the schema says otherwise.',
        );
    }
});
