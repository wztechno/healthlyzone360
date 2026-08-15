<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\B2bSignatoryPresence;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * A company is waiting for this person's signature.
 *
 * An application in review or an agreement at `pending_signature` names one
 * human being as the person who can sign it. Anonymise them and the application
 * is stranded: there is no second signatory, nothing in the B2B module watches
 * for a signatory who has ceased to exist, and the first anybody hears of it is
 * a corporate customer asking why their onboarding stopped.
 *
 * **Keyed on the `users` identifier, not the customer account.** A signatory is
 * frequently somebody who has never ordered anything personally — a finance
 * director, an office manager — and asking this question about a customer
 * account they do not hold would make the blocker vacuous for exactly the
 * people it protects.
 *
 * Read through `B2bSignatoryPresence` so this module never learns the B2B
 * schema; the B2B side implements it and integrator-2 binds it, and the
 * contract file is the whole of the coordination between the two. Until then
 * the null default reports `b2b_module_absent` — nothing was checked, stated as
 * such.
 */
final class PendingB2bSignatoryBlocker implements ClosureBlocker
{
    public function __construct(private readonly B2bSignatoryPresence $signatures) {}

    public function code(): string
    {
        return 'pending_b2b_signatures';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        if (! $this->signatures->isAvailable()) {
            return BlockerVerdict::notApplicable($this->code(), 'b2b_module_absent');
        }

        $pending = $this->signatures->pendingSignatureCount((string) $user->getKey());

        if ($pending > 0) {
            return BlockerVerdict::blocking($this->code(), $pending, 'signatures_pending');
        }

        return BlockerVerdict::clear($this->code());
    }
}
