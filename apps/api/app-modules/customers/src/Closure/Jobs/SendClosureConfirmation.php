<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Jobs;

use Healthy360\Customers\Closure\Mail\AccountClosedMessage;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Mail;

/**
 * "Your account is closed." The last message the platform ever sends to this
 * address.
 *
 * **`ShouldBeEncrypted` is the reason this is its own class**, exactly as
 * `SendOtpMessage` is on the verification side. The payload carries a real
 * email address belonging to somebody who has just asked to be forgotten, and
 * it carries it *after* every copy of that address has been deleted from the
 * database. A plaintext queue payload would mean the one surviving copy of a
 * closed customer's address sitting in Redis, readable by anything that can
 * reach the queue, for as long as the job takes to run and however long the
 * completed-job retention keeps it.
 *
 * **Why send anything at all.** Somebody who did not ask for this needs to find
 * out — a closure started from a hijacked session, or a support-initiated one
 * that went to the wrong account. The message is the only channel left once the
 * login has stopped working, and its real job is to be a tripwire for the
 * person on the other end.
 *
 * **What it must not contain.** No name, because the profile has been redacted
 * and addressing somebody by a name we have just promised to forget would be
 * absurd. No order history, no reason text, no link back into an account that
 * no longer exists. The retained-order count is the one substantive fact, and
 * it is there because "you have been forgotten" and "we still hold seven
 * invoices" must not be two separate discoveries.
 *
 * Failures are swallowed by the queue rather than retried into a loop: the
 * closure has already happened, and a bouncing address cannot un-happen it.
 */
final class SendClosureConfirmation implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    /**
     * @param  string  $emailAddress  captured before deletion; the only copy left
     * @param  string  $reason  the closure reason code, for the message's own records
     * @param  string|null  $locale  the recipient's language, resolved before the profile was redacted
     * @param  int  $ordersRetained  how many commercial records survive
     */
    public function __construct(
        public readonly string $emailAddress,
        public readonly string $reason,
        public readonly ?string $locale,
        public readonly int $ordersRetained,
    ) {
        $this->onQueue('notifications');
    }

    public function handle(): void
    {
        Mail::to($this->emailAddress)->send(new AccountClosedMessage(
            reason: $this->reason,
            locale: $this->locale ?? (string) config('app.locale', 'en'),
            ordersRetained: $this->ordersRetained,
        ));
    }
}
