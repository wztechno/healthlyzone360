<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\Customers\Models\CustomerAccount;

/**
 * The wire shape of the trading account an approval earns.
 *
 * Presented here rather than by the Customers module because Customers has no
 * presenter of its own yet, and inventing one for a single B2B response would
 * put a shape in that module which nothing there serves. The dependency edge
 * already runs this way — `ProvisionApplication` writes the row — so the
 * reading is honest; when Customers grows its own HTTP surface this becomes
 * the duplicate to remove, and the account shape it defines is the one that
 * should win.
 *
 * **Thin on purpose.** The provisioning response answers "what now exists",
 * not "what is this account like": the addresses, the dietary profile and the
 * consents hanging off a customer account are somebody else's endpoints, and a
 * fat shape here would make this the accidental canonical read.
 *
 * `account_number` is served because it is the human-quotable identity — the
 * thing a reviewer reads down a phone line to the company they have just let
 * in — and it is the one field on this shape that a support conversation
 * starts with.
 */
final class ProvisioningPresenter
{
    /**
     * @return array{
     *     id: string,
     *     account_number: string,
     *     account_type: string,
     *     organisation_id: string|null,
     *     status: string,
     *     origin: string,
     *     display_name: string|null,
     *     activated_at: string|null,
     *     created_at: string|null
     * }
     */
    public function customerAccount(CustomerAccount $account): array
    {
        return [
            'id' => (string) $account->getKey(),
            'account_number' => $account->account_number,
            'account_type' => $account->account_type->value,
            'organisation_id' => $account->organisation_id,
            'status' => $account->status->value,
            'origin' => $account->origin->value,
            'display_name' => $account->display_name,
            'activated_at' => $account->activated_at?->toIso8601String(),
            'created_at' => $account->created_at?->toIso8601String(),
        ];
    }
}
