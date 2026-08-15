<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\AccountActivationEvaluator;

/**
 * Whether this party may place an order at all — asked once, answered per
 * account shape.
 *
 * **Three shapes, three different gates, and conflating them would break two
 * of them.**
 *
 * * **A consumer account (`b2c`)** goes through the server-authoritative
 *   activation evaluator, the same one the account checklist reads, so a
 *   customer can never be told two different things about what is outstanding.
 *   `canTransact()` is the status gate on top of it: `provisional` cannot
 *   order, and when the checklist is already satisfied the refusal says
 *   `account_not_active` rather than pretending something is missing.
 *
 * * **A guest (`guest`) never activates**, by construction — that is what
 *   `CustomerAccountType::usesSelfServiceActivation()` records. A guest account
 *   stays `provisional` for its whole life and `canTransact()` is false for
 *   it, so the consumer gate would refuse *every* guest order. The real gate is
 *   the one G1 built: a live guest session graded `PlaceOrder`, which is
 *   reached only by proving a contact point with a passcode. An order is a
 *   promise that somebody will be told when it is late, and a destination
 *   nobody proved is a promise made to a typo.
 *
 * * **A corporate account (`b2b`)** is activated by B1's provisioning
 *   transaction, which has its own gates — KYC, a signed agreement, credit.
 *   None of them is this module's to re-check, so the gate here is the status
 *   that provisioning sets.
 *
 * The session is looked up by account rather than passed in. The account is
 * derived from the cart and the cart from the session, so "this account holds
 * a live `PlaceOrder` session" and "this request's session is `PlaceOrder`" are
 * the same statement — and asking by account means a placement made by a job
 * or a console command is gated identically, which a parameter threaded
 * through an HTTP layer would not be.
 */
final readonly class CheckoutEligibility
{
    public function __construct(private AccountActivationEvaluator $activation) {}

    /**
     * Everything standing between this party and an order, empty when nothing
     * does.
     *
     * @return list<array<string, mixed>>
     */
    public function outstanding(CustomerAccount $account): array
    {
        if ($account->account_type === CustomerAccountType::Guest) {
            return $this->guestReasons($account);
        }

        $reasons = [];

        if ($account->account_type->usesSelfServiceActivation()) {
            foreach ($this->activation->outstanding($account) as $item) {
                $reasons[] = ['reason' => 'account_not_ready', 'outstanding' => $item['code']] + $item['context'];
            }
        }

        if (! $account->status->canTransact()) {
            // Only when the checklist itself is clean. Saying both "verify your
            // email" and "your account is not active" is telling somebody the
            // same thing twice in two vocabularies.
            if ($reasons === []) {
                $reasons[] = ['reason' => 'account_not_active', 'status' => $account->status->value];
            }
        }

        return $reasons;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function guestReasons(CustomerAccount $account): array
    {
        $sessions = GuestSession::query()
            ->where('customer_account_id', $account->getKey())
            ->whereNull('revoked_at')
            ->get();

        foreach ($sessions as $session) {
            if ($session->permits(GuestSessionGrade::PlaceOrder)) {
                return [];
            }
        }

        // `isLive()` is asked of the clock rather than of a status column, so
        // the filtering happens in PHP over the unrevoked rows: a session can
        // be unrevoked and past its window, and a SQL predicate duplicating
        // that rule would be a second definition of "live".
        return [[
            'reason' => 'guest_not_verified',
            'required_grade' => GuestSessionGrade::PlaceOrder->value,
        ]];
    }
}
