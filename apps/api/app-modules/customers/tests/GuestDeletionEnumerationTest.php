<?php

declare(strict_types=1);

use Healthy360\Customers\Guest\Results\GuestDeletionOutcome;
use Healthy360\Customers\Guest\Services\GuestDeletionService;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Services\ContactPointRegistry;

/*
|--------------------------------------------------------------------------
| The erasure surface must not answer a question nobody asked
|--------------------------------------------------------------------------
|
| "Delete everything you hold about this address" arrives unauthenticated — a
| guest has no account to log into, which is the definition of a guest. So the
| endpoint is handed an arbitrary email address by an arbitrary stranger, and if
| its answer differs at all between an address we hold and one we do not, it is
| a free "does this person order from you" lookup for anybody with a word list.
|
| The property is asserted on the *whole serialised result*, not on a hand-picked
| field, so a future addition — a challenge id, a "sent" flag, a count — cannot
| open the oracle back up without failing here.
|
| Both steps are checked, because enumeration resistance survives the second one
| or it was never there: an attacker who is told nothing by the request will
| simply submit six digits and read the refusal instead.
|
| SPEED MODE: one of three kept smokes. See DEFERRED TESTS in the G1 report.
|
*/

it('answers a deletion request identically whether or not the address is known', function (): void {
    $deletions = app(GuestDeletionService::class);

    // A real guest, reachable at a real address.
    $guest = app(GuestSessionService::class)->start();

    app(ContactPointRegistry::class)->rememberForCustomerAccount(
        customerAccountId: (string) $guest->account->getKey(),
        channel: ContactChannel::Email,
        value: 'known-guest@example.test',
    );

    $known = $deletions->request(ContactChannel::Email, 'known-guest@example.test');
    $unknown = $deletions->request(ContactChannel::Email, 'nobody-here@example.test');

    // Same shape, same values apart from the masked echo of what was typed —
    // which is derived from the submission itself and therefore tells the
    // caller only what they already knew.
    expect($known->toArray())->toEqual([
        'accepted' => true,
        'destination_masked' => 'k••••••••••@example.test',
        'verification_required' => true,
        'expires_in_seconds' => 300,
    ])->and($unknown->toArray())->toEqual([
        'accepted' => true,
        'destination_masked' => 'n••••••••••@example.test',
        'verification_required' => true,
        'expires_in_seconds' => 300,
    ]);

    // Structurally identical: same keys, same types, same values everywhere the
    // submitted address does not appear.
    expect(array_keys($known->toArray()))->toBe(array_keys($unknown->toArray()))
        ->and(array_diff_key($known->toArray(), ['destination_masked' => null]))
        ->toEqual(array_diff_key($unknown->toArray(), ['destination_masked' => null]));

    // Step two. A wrong code against the address we hold, and any code at all
    // against one we do not, refuse the same way — and neither purges.
    $wrongCodeOnKnown = $deletions->confirm(ContactChannel::Email, 'known-guest@example.test', '000000');
    $anyCodeOnUnknown = $deletions->confirm(ContactChannel::Email, 'nobody-here@example.test', '000000');

    expect($wrongCodeOnKnown->purged)->toBeFalse()
        ->and($anyCodeOnUnknown->purged)->toBeFalse()
        ->and($wrongCodeOnKnown->reason)->toBe(GuestDeletionOutcome::REASON_INVALID)
        ->and($anyCodeOnUnknown->reason)->toBe($wrongCodeOnKnown->reason)
        ->and($wrongCodeOnKnown->report)->toBeNull()
        ->and($anyCodeOnUnknown->report)->toBeNull();
});
