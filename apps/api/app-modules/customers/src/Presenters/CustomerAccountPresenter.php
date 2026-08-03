<?php

declare(strict_types=1);

namespace Healthy360\Customers\Presenters;

use Healthy360\Customers\Models\CustomerAccount;

/**
 * The consumer's own view of their account.
 *
 * **The checklist is served beside the account, always.** An onboarding screen
 * that had to ask twice — once for the account, once for what remains — would
 * be able to render the two out of step, and "you are not active" with no list
 * of why is the state that produces support tickets. `outstanding` and
 * `checklist` come from the same evaluator call that guards activation, so the
 * screen and the gate can never disagree about what is missing.
 *
 * `status` is read-only on the wire and there is no presenter method that would
 * let it be written. A client cannot PATCH its way to `active`; activation is
 * the evaluator's verdict made durable, and that is the property J1 exists to
 * hold.
 *
 * `account_number` is `Confidential` on the model and is carried here anyway,
 * because this shape is only ever served to the person the number belongs to —
 * it is what they quote to support, and withholding it from its owner would
 * protect nobody.
 */
final class CustomerAccountPresenter
{
    /**
     * @param  list<array{code: string, context: array<string, mixed>}>  $outstanding
     * @param  list<array{code: string, satisfied: bool, required: bool}>  $checklist
     * @return array{
     *     id: string,
     *     account_number: string,
     *     account_type: string,
     *     status: string,
     *     origin: string,
     *     display_name: string|null,
     *     preferred_language_code: string|null,
     *     country_code: string|null,
     *     is_ready: bool,
     *     outstanding: list<array{code: string, context: array<string, mixed>}>,
     *     checklist: list<array{code: string, satisfied: bool, required: bool}>,
     *     activated_at: string|null,
     *     provisional_expires_at: string|null,
     *     last_activity_at: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function account(CustomerAccount $account, array $outstanding, array $checklist): array
    {
        return [
            'id' => (string) $account->getKey(),
            'account_number' => $account->account_number,
            'account_type' => $account->account_type->value,
            'status' => $account->status->value,
            'origin' => $account->origin->value,
            'display_name' => $account->display_name,
            'preferred_language_code' => $account->preferred_language_code,
            'country_code' => $account->country_code,
            'is_ready' => $outstanding === [],
            'outstanding' => $outstanding,
            'checklist' => $checklist,
            'activated_at' => $account->activated_at?->toIso8601String(),
            'provisional_expires_at' => $account->provisional_expires_at?->toIso8601String(),
            'last_activity_at' => $account->last_activity_at?->toIso8601String(),
            'lock_version' => $account->lock_version,
            'created_at' => $account->created_at?->toIso8601String(),
            'updated_at' => $account->updated_at?->toIso8601String(),
        ];
    }
}
