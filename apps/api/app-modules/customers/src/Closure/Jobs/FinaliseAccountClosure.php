<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Jobs;

use App\Models\User;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Customers\Closure\Services\AccountAnonymiser;
use Healthy360\Customers\Closure\Services\ClosureBlockerRegistry;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Identity\Models\ContactPoint;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * The point of no return.
 *
 * ## Why it re-runs the blockers
 *
 * The registry already ran at request and again at verification, and both
 * verdicts are stored on the row. Neither is trusted here. The grace window
 * exists precisely so time can pass, and the things blockers watch for are the
 * things that appear during it: an order placed on the way to the airport, a
 * subscription somebody's partner started, an invitation accepted this morning.
 * A finalisation that trusted a cached verdict would erase an account with food
 * in transit — and it would be right, by a reading of the world that was true
 * an hour ago.
 *
 * A blocked request is **cancelled with `blocked`, not left scheduled.** Silent
 * retries would mean a closure that fires the moment the last order is
 * delivered, days later, with nobody having asked again. The person is told and
 * comes back when they are ready.
 *
 * ## Why the address is captured before anything is deleted
 *
 * The confirmation message has to go somewhere, and by the time this job
 * finishes there is no destination on file — that is what it did. So the
 * address is read first and handed to `SendClosureConfirmation`, which declares
 * `ShouldBeEncrypted` so the one place a closed customer's address still exists
 * for a few seconds is a ciphertext payload rather than a queue row anybody with
 * Redis access can read.
 *
 * ## Idempotence
 *
 * Carried by `AccountAnonymiser`, which returns `alreadyClosed()` when the
 * tombstone exists, and by the status guard here. Both are needed: the status
 * guard stops a duplicate schedule entry doing the work twice, and the tombstone
 * stops a retry after a partial failure doing it twice inside one run.
 */
final class FinaliseAccountClosure implements ShouldQueue
{
    use Queueable;

    /**
     * Three attempts. An erasure that fails transiently — a lock, a dropped
     * connection — must be retried; one that fails deterministically must stop
     * and be looked at, not hammered.
     */
    public int $tries = 3;

    public function __construct(public readonly string $closureRequestId)
    {
        $this->onQueue('maintenance');
    }

    public function handle(
        AccountAnonymiser $anonymiser,
        ClosureBlockerRegistry $blockers,
        ClosureService $closures,
        AuditRecorder $audit,
    ): void {
        $request = AccountClosureRequest::query()->whereKey($this->closureRequestId)->first();

        if (! $request instanceof AccountClosureRequest) {
            return;
        }

        if ($request->status !== ClosureRequestStatus::Scheduled) {
            // Cancelled during the window, or already finalised by the sweep.
            // Both are ordinary; neither is an error.
            return;
        }

        $user = $request->user;

        if (! $user instanceof User) {
            return;
        }

        $account = $request->customerAccount;
        $verdicts = $blockers->evaluate($user, $account);

        if ($blockers->isBlocked($verdicts)) {
            $request->forceFill(['blockers' => $blockers->toArray($verdicts)])->save();
            $closures->cancel($request, 'blocked');

            return;
        }

        // Read while there is still something to read. Everything below this
        // line destroys it.
        $destination = $this->confirmationAddressFor($user);
        $locale = $user->profile?->preferred_language_code;

        $report = $anonymiser->anonymise($user, $account, $request);

        $request->forceFill([
            'status' => ClosureRequestStatus::Completed,
            'completed_at' => now(),
            // The note is the one field on this row written in a person's own
            // words. It goes with the rest of them.
            'reason_note' => null,
            'blockers' => $blockers->toArray($verdicts),
        ])->save();

        $audit->record(
            'account.closed',
            actorUserId: $request->initiated_by_user_id,
            subjectType: 'user',
            subjectId: (string) $request->user_id,
            metadata: [
                'closure_request' => (string) $request->getKey(),
                'closure_reason' => $request->reason_code->value,
                'support_initiated' => $request->isSupportInitiated(),
                'orders_retained' => $report->ordersRetained,
                'orders_anonymised' => $report->ordersAnonymised,
            ],
        );

        if ($report->leftOrdersUnredacted()) {
            // Loud on purpose. A closure that completed with delivery addresses
            // still on the order rows is a defect in the deployment's bindings,
            // not a clean result, and the report field alone would be read by
            // nobody until somebody went looking.
            Log::warning('Account closure completed without order anonymisation: no OrderAnonymisation implementation is bound.', [
                'closure_request' => (string) $request->getKey(),
            ]);
        }

        if ($destination !== null && config('closure.confirmation.enabled', true) === true) {
            SendClosureConfirmation::dispatch(
                $destination,
                $request->reason_code->value,
                $locale,
                $report->ordersRetained,
            );
        }
    }

    /**
     * Where the confirmation goes, read before the deletion that removes it.
     *
     * The login identity, because that is the address the person used to
     * register and the one they will recognise. A closure with no verified
     * email — possible, if the contact was retired — simply sends nothing
     * rather than inventing a destination.
     */
    private function confirmationAddressFor(User $user): ?string
    {
        $login = $user->loginContact;

        if ($login instanceof ContactPoint && $login->isVerified()) {
            return (string) $login->value_normalised;
        }

        $email = (string) $user->email;

        return $email === '' ? null : $email;
    }
}
