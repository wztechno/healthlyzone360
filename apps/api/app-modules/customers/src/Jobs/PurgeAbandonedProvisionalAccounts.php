<?php

declare(strict_types=1);

namespace Healthy360\Customers\Jobs;

use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Models\CustomerAccount;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Remove accounts somebody started and walked away from.
 *
 * An abandoned provisional account is a row of personal data — an email, maybe
 * a phone, maybe an address — belonging to somebody who decided not to become
 * a customer. Keeping it indefinitely is data minimisation failing quietly, so
 * it goes after `verification.provisional_account_ttl_days`.
 *
 * **Four guards, and each one is a thing that could otherwise be deleted by
 * mistake:**
 *
 *  * `status = provisional` — an active account is never touched, whatever its
 *    deadline column says.
 *  * `provisional_expires_at` in the past — the deadline is the one stamped
 *    when the account was created, so changing the setting does not
 *    retroactively condemn existing rows.
 *  * `last_activity_at` also past the deadline — somebody who came back last
 *    week is not abandoned, even if they opened the account two months ago.
 *  * `origin` is purgeable — a staff-created or B2B-provisioned account
 *    represents somebody else's work and a business relationship, and deleting
 *    it after thirty quiet days would be this job overruling an operator.
 *
 * **Thirty days is a placeholder, not a legal period** (OQ-029). It is
 * configuration, it is named as a placeholder, and nothing here presents it as
 * a settled retention decision.
 *
 * The delete cascades to addresses, dietary profile, allergen declarations,
 * food exclusions, account-owned contact points and their challenges — every
 * child is `cascadeOnDelete` — so this leaves no orphans and no partial
 * person. Daily at 03:00 UTC, `withoutOverlapping` and `onOneServer`
 * (routes/console.php).
 */
final class PurgeAbandonedProvisionalAccounts implements ShouldQueue
{
    use Queueable;

    /** Accounts per statement, so one run cannot hold a long lock. */
    public const int CHUNK = 200;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(): void
    {
        $purgeable = array_values(array_map(
            static fn (CustomerAccountOrigin $origin): string => $origin->value,
            array_filter(CustomerAccountOrigin::cases(), static fn (CustomerAccountOrigin $origin): bool => $origin->isPurgeable()),
        ));

        $now = now();
        $deleted = 0;

        do {
            /** @var list<string> $batch */
            $batch = CustomerAccount::query()
                ->where('status', CustomerAccountStatus::Provisional)
                ->whereIn('origin', $purgeable)
                ->whereNotNull('provisional_expires_at')
                ->where('provisional_expires_at', '<', $now)
                // Nothing has happened since the deadline passed. Somebody who
                // came back yesterday is dormant, not abandoned, and their
                // stamped deadline is now the wrong question to be asking.
                ->where(function ($query): void {
                    $query->whereNull('last_activity_at')
                        ->orWhereColumn('last_activity_at', '<', 'provisional_expires_at');
                })
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            if ($batch === []) {
                break;
            }

            $deleted += DB::transaction(fn (): int => CustomerAccount::query()->whereIn('id', $batch)->delete());
        } while (count($batch) === self::CHUNK);

        // A count, never the accounts. Logging which identities were purged
        // would reconstruct in the log exactly what was deleted from the
        // table.
        Log::info('Abandoned provisional customer accounts purged.', [
            'deleted' => $deleted,
            'ttl_days' => (int) config('verification.provisional_account_ttl_days', 30),
        ]);
    }
}
