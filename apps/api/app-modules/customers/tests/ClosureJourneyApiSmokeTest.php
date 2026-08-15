<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Consent\Database\Seeders\ConsentDefinitionSeeder;
use Healthy360\Customers\Closure\Enums\ClosureReasonCode;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Identity\Enums\UserStatus;
use Healthy360\Orders\Tests\Fixtures\OrderWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Verification\Mail\OtpMessage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/*
|--------------------------------------------------------------------------
| The closure journey, over HTTP
|--------------------------------------------------------------------------
|
| Ask, prove, and be gone — plus the two answers a client most needs to be able
| to tell apart from a failure.
|
| Three properties carry the file:
|
|  1. **A blocked closure is a success.** It comes back `202` with
|     `blocked: true` and the verdicts, and the request survives. There is
|     deliberately no `closure.blocked` error code (D-073), and a smoke that
|     only walked the happy path would let somebody add one without noticing
|     that every client would then have to render the commonest case through an
|     exception handler.
|  2. **The full journey erases.** Request, verify with the real passcode, and
|     the identity comes back anonymised with `users.email` freed — the property
|     a "null everything" implementation gets wrong.
|  3. **A marketing opt-out is a `200`, already completed, with no passcode.**
|     Friction on the reversible choice is how people are pushed toward the
|     irreversible one, and the status code is where a client sees which half
|     happened.
|
| The passcode is read **from the message**, through `Mail::fake()`. That is not
| a convenience: the closure acknowledgement deliberately carries a masked
| destination and a countdown and never the code, unlike the guest challenge
| response which exposes a `debug_code` under a testing flag. Reading the row
| would find an HMAC. So the only honest way to prove the journey end to end is
| the way a customer does it — open the message.
|
| SPEED MODE: one smoke per route family. The exhaustive refusal matrix — a
| second request in flight, a cancelled request re-verified, a support actor
| entering the code — is on the deferred list.
|
*/

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
});

it('reports the blockers in a successful body and leaves the request alive', function (): void {
    // A world with an order in flight. `OpenOrdersBlocker` is the one blocker
    // in the registry that has always been real, so it is the one that proves
    // a blocked request is not an error.
    $world = CheckoutWorld::build('blocked@kitchen.test');
    OrderWorld::place($world);

    $this->actingAs($world->customer->account->user);

    $response = $this->postJson('/api/v1/me/closure-requests', [
        'reason_code' => ClosureReasonCode::PrivacyConcerns->value,
        'scope' => ClosureScope::Full->value,
    ], firstPartyHeaders())
        // Accepted, not refused. The request exists and the customer can come
        // back when the food has arrived.
        ->assertAccepted()
        ->assertJsonPath('data.closure_request.blocked', true)
        ->assertJsonPath('data.closure_request.status', ClosureRequestStatus::Requested->value);

    $verdicts = collect($response->json('data.closure_request.blockers'))->keyBy('code');

    expect($verdicts['open_orders']['status'])->toBe('blocking')
        ->and($verdicts['open_orders']['count'])->toBeGreaterThan(0)
        // The seams the integration wave closed: a real answer rather than
        // "nobody looked".
        ->and($verdicts['active_subscriptions']['status'])->toBe('clear')
        ->and($verdicts['pending_b2b_signatures']['status'])->toBe('clear')
        ->and($verdicts['unsettled_credit_memos']['status'])->toBe('clear')
        // And the two that genuinely have nothing to check against still say so.
        ->and($verdicts['wallet_balance']['status'])->toBe('not_applicable')
        ->and($verdicts['wallet_balance']['reason'])->toBe('no_wallet_module');

    // No passcode was sent for a request that cannot proceed: asking somebody to
    // prove their identity for an act already decided against is friction for
    // nothing.
    $request = AccountClosureRequest::query()->sole();
    expect($request->otp_challenge_id)->toBeNull()
        ->and($request->status)->toBe(ClosureRequestStatus::Requested);

    // The live read agrees, and re-evaluates rather than echoing the snapshot.
    $this->getJson('/api/v1/me/closure-requests/live', firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.closure_request.request_id', (string) $request->getKey())
        ->assertJsonPath('data.blockers.0.code', 'open_orders');

    // And it can be called off, which answers with the row rather than 204.
    $this->deleteJson('/api/v1/me/closure-requests/'.$request->getKey(), [], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.closure_request.status', ClosureRequestStatus::Cancelled->value);
});

it('asks, proves and erases, freeing the address on the way out', function (): void {
    // Nothing in flight: no order, no subscription, no membership. The state
    // somebody is in when they are actually allowed to leave.
    $world = CheckoutWorld::build('leaving@kitchen.test');
    $user = $world->customer->account->user;

    Mail::fake();

    $this->actingAs($user);

    $opened = $this->postJson('/api/v1/me/closure-requests', [
        'reason_code' => ClosureReasonCode::NoLongerNeeded->value,
        'reason_note' => 'Nothing personal.',
        'scope' => ClosureScope::Full->value,
    ], firstPartyHeaders())
        ->assertAccepted()
        ->assertJsonPath('data.closure_request.blocked', false)
        ->assertJsonPath('data.closure_request.verification_required', true);

    // Server-authored, and never something the client could have made up.
    expect($opened->json('data.closure_request.destination_masked'))->toBeString()
        ->and($opened->json('data.closure_request.expires_in_seconds'))->toBeGreaterThan(0);

    $requestId = $opened->json('data.closure_request.request_id');
    $request = AccountClosureRequest::query()->findOrFail($requestId);

    expect($request->otp_challenge_id)->not->toBeNull();

    // The plaintext exists once, in the message, and the acknowledgement never
    // carries it. Opening the message is what a customer does.
    $code = null;

    Mail::assertSent(OtpMessage::class, function (OtpMessage $message) use (&$code, $request): bool {
        if ($message->dispatch->challengeId !== (string) $request->otp_challenge_id) {
            return false;
        }

        $code = $message->dispatch->code;

        return true;
    });

    expect($code)->toBeString();

    $emailBefore = DB::table('users')->where('id', $user->getKey())->value('email');

    $this->postJson("/api/v1/me/closure-requests/{$requestId}/verify", ['code' => $code], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.closure_request.blocked', false)
        // **`completed`, not `scheduled`, and the difference is configuration
        // rather than a race.** The grace window defaults to zero, so
        // `schedule()` dispatches `FinaliseAccountClosure` with no delay; the
        // suite's queue is `sync`, so it runs inside this request and the
        // acknowledgement — which re-reads the row — reports the state the
        // journey actually reached. A deployment with a positive window would
        // answer `scheduled` here and `scheduled_for` would say when.
        ->assertJsonPath('data.closure_request.status', ClosureRequestStatus::Completed->value);

    $user->refresh();

    expect($user->status)->toBe(UserStatus::Closed)
        ->and($user->anonymised_at)->not->toBeNull()
        // Freed, not merely nulled: the same person may register again.
        ->and($user->email)->not->toBe($emailBefore)
        ->and($user->email_verified_at)->toBeNull();

    $request->refresh();
    expect($request->status)->toBe(ClosureRequestStatus::Completed)
        // The one free-text field in the journey goes with everything else.
        ->and($request->reason_note)->toBeNull();
});

it('takes the reversible half immediately, with no passcode and a 200', function (): void {
    $this->seed(ConsentDefinitionSeeder::class);

    $world = CheckoutWorld::build('optout@kitchen.test');

    $this->actingAs($world->customer->account->user);

    $this->postJson('/api/v1/me/closure-requests', [
        'reason_code' => ClosureReasonCode::TooExpensive->value,
        'scope' => ClosureScope::MarketingOptOut->value,
    ], firstPartyHeaders())
        // 200, not 202: it has already happened by the time the page reloads.
        ->assertOk()
        ->assertJsonPath('data.closure_request.status', ClosureRequestStatus::Completed->value)
        ->assertJsonPath('data.closure_request.verification_required', false)
        // A marketing opt-out consults no blockers at all: an open order is a
        // reason not to erase somebody and emphatically not a reason to keep
        // emailing them offers.
        ->assertJsonPath('data.closure_request.blockers', []);

    expect(AccountClosureRequest::query()->sole()->otp_challenge_id)->toBeNull();

    // Nothing was erased.
    $world->customer->account->user->refresh();
    expect($world->customer->account->user->status)->not->toBe(UserStatus::Closed);
});

it('refuses a second request while one is still going somewhere', function (): void {
    $world = CheckoutWorld::build('twice@kitchen.test');
    $user = $world->customer->account->user;

    app(ClosureService::class)->request($user, ClosureReasonCode::Other, ClosureScope::Full);

    $this->actingAs($user);

    // Refused rather than silently returning the existing one: the two may
    // differ in scope, and quietly handing back an older request would answer a
    // question nobody asked.
    $this->postJson('/api/v1/me/closure-requests', [
        'reason_code' => ClosureReasonCode::MovingAway->value,
        'scope' => ClosureScope::Full->value,
    ], firstPartyHeaders())
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'closure.refused')
        ->assertJsonPath('error.details.reason', 'closure_already_in_flight');
});
