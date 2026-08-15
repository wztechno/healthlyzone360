<?php

declare(strict_types=1);

use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| One token, one guest, and no way across
|--------------------------------------------------------------------------
|
| The single invariant the guest journey rests on. There is no user behind a
| guest token, so the token *is* the authorisation: if one guest's token can be
| made to resolve to another guest's account, every downstream check — the
| basket, the address, the order — is defending nothing.
|
| Four ways that could happen, checked as one property because they are one:
|
|   * The obvious one. A's token resolving to B's session.
|   * A tampered token. Flipping a character must fail closed, not fall through
|     to a partial match.
|   * The plaintext in the row. If the token is stored as well as hashed, a
|     dump is a set of working credentials.
|   * A dead token still resolving. Revoked and expired must both return null,
|     and must return the *same* null as a token that never existed — a guest
|     surface that could say "that one expired" would be confirming it had
|     once been real.
|
| SPEED MODE: this is one of three kept smokes. See DEFERRED TESTS in the G1
| report for what is not covered here.
|
*/

it('never lets one guest token reach another guest, a tampered value, or a dead session', function (): void {
    $service = app(GuestSessionService::class);

    $first = $service->start();
    $second = $service->start();

    // Two guests, two accounts, and the shape the CHECK constraints demand.
    expect($first->account->getKey())->not->toBe($second->account->getKey())
        ->and($first->account->account_type)->toBe(CustomerAccountType::Guest)
        ->and($first->account->origin)->toBe(CustomerAccountOrigin::Guest)
        ->and($first->account->user_id)->toBeNull()
        ->and($first->account->guest_expires_at)->not->toBeNull()
        ->and($first->grade)->toBe(GuestSessionGrade::CheckoutDraft);

    // Each token resolves to its own session and to nothing else.
    expect($service->resolve($first->token)?->getKey())->toBe($first->session->getKey())
        ->and($service->resolve($second->token)?->getKey())->toBe($second->session->getKey())
        ->and($service->resolve($first->token)?->customer_account_id)->toBe((string) $first->account->getKey())
        ->and($service->resolve($first->token)?->customer_account_id)->not->toBe((string) $second->account->getKey());

    // A tampered token fails closed. The last character is swapped rather than
    // truncated, so the candidate is the same length as a real one — a length
    // check would pass it and only the digest comparison can refuse it.
    $tampered = substr($first->token, 0, -1).($first->token[strlen($first->token) - 1] === 'A' ? 'B' : 'A');

    expect($tampered)->not->toBe($first->token)
        ->and($service->resolve($tampered))->toBeNull()
        ->and($service->resolve(''))->toBeNull()
        ->and($service->resolve('not-a-token'))->toBeNull();

    // The plaintext is nowhere in the row. Asserted against the raw column
    // values rather than the model, so a cast or an accessor cannot hide a
    // stored token from the test that exists to find one.
    $raw = DB::table('guest_sessions')->where('id', $first->session->getKey())->first();

    expect(json_encode($raw))->not->toContain($first->token)
        ->and($raw?->token_hash)->toBe(hash('sha256', $first->token));

    // A revoked token and an expired one both resolve to null — the same null
    // an unknown token gets.
    $service->revoke($first->session, 'test');

    expect($service->resolve($first->token))->toBeNull();

    GuestSession::query()->whereKey($second->session->getKey())
        ->update(['expires_at' => now()->subMinute()]);

    expect($service->resolve($second->token))->toBeNull();
});
