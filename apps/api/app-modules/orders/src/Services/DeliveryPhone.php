<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Whether a delivery has a number the driver can ring.
 *
 * The driver run's own rule (`DriverJobIndexController::PHONE_SQL`), asked
 * before the order exists rather than after: the address's contact first, then
 * the account's live phone on either ownership arm — the account's own rows, or
 * the user's behind it. Only whether one exists is asked here; which one wins is
 * the run sheet's ordering and does not change the answer.
 *
 * The address's contact counts only while it is a live phone. A retired number
 * or an email cannot be rung, and the account's phone is the next thing the
 * driver would be given.
 *
 * Checked on the three placements a person makes — online, guest and desk — and
 * nowhere else: a subscription day and an accepted quotation were agreed earlier
 * and keep placing without one.
 */
final class DeliveryPhone
{
    public function resolves(?string $contactPointId, ?string $customerAccountId): bool
    {
        if ($contactPointId !== null && $this->livePhones()->where('id', $contactPointId)->exists()) {
            return true;
        }

        if ($customerAccountId === null) {
            return false;
        }

        return $this->livePhones()
            ->where(function (Builder $owner) use ($customerAccountId): void {
                $owner->where('customer_account_id', $customerAccountId)
                    ->orWhereIn('user_id', DB::table('customer_accounts')
                        ->select('user_id')
                        ->where('id', $customerAccountId)
                        ->whereNotNull('user_id'));
            })
            ->exists();
    }

    private function livePhones(): Builder
    {
        return DB::table('contact_points')
            ->where('channel', 'phone')
            ->whereNull('retired_at');
    }
}
