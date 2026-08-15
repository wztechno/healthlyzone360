<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpCodeHasher;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\Mailer\SentMessage;

/*
|--------------------------------------------------------------------------
| The passcode surface, over HTTP
|--------------------------------------------------------------------------
|
| `OtpCodeLeakTest` proves the framework keeps its secret. This proves the six
| routes that expose it answer at all: every one of them in the Healthy360
| envelope, with the one refusal a client actually branches on.
|
| **`expose_codes` is on for this file**, which is the affordance
| `OtpService::exposesCodes()` guards behind a flag *and* a local/testing
| environment. It is how a test learns the code a challenge was issued with —
| the plaintext exists between generation and delivery and nowhere else. The
| one place it is deliberately not used is the inline-delivery happy path
| below, where the whole claim is that the *message* carries the code, so the
| code is read out of the rendered message instead.
|
*/

beforeEach(function (): void {
    config()->set('verification.otp.expose_codes', true);

    $this->user = User::factory()->create();
});

/**
 * The rendered bodies of everything the array transport was handed.
 *
 * Neither fake intercepts this message usefully. `Notification::fake()` swaps
 * the channel out before `VerifyEmail::toMail()` runs, so the messenger — and
 * therefore the challenge — never happens at all; `Mail::fake()` lets the
 * messenger run but silently drops the send, because `MailFake::sendMail()`
 * returns early for anything that is not a `Mailable` and a notification's mail
 * channel hands the mailer a view. The `array` transport that phpunit.xml
 * already configures is the only thing that keeps the rendered message.
 */
function sentMailBodies(): string
{
    $transport = Mail::mailer()->getSymfonyTransport();

    if (! $transport instanceof ArrayTransport) {
        return '';
    }

    return $transport->messages()
        ->map(static fn (SentMessage $message): string => $message->getOriginalMessage()->toString())
        ->implode("\n");
}

/**
 * The one number in a message that is really this challenge's passcode.
 *
 * Every candidate run of digits is checked against the stored HMAC rather than
 * the first one being trusted: a body full of markup has plenty of numbers in
 * it, and "the message contains six digits" is a much weaker claim than "the
 * message contains *the* code".
 */
function passcodeWithin(string $body, OtpChallenge $challenge): ?string
{
    $hasher = app(OtpCodeHasher::class);

    preg_match_all('/\d{6}/', $body, $matches);

    foreach (array_unique($matches[0]) as $candidate) {
        if ($hasher->matches($candidate, $challenge->code_hash)) {
            return $candidate;
        }
    }

    return null;
}

it('issues a passcode to the caller\'s own address, reads it back and sends it again', function (): void {
    $this->actingAs($this->user);

    $issued = $this->postJson('/api/v1/verification/email/challenges', [], firstPartyHeaders())
        // 202: a message was queued, not a resource created.
        ->assertStatus(202)
        ->assertJsonPath('data.challenge.purpose', OtpPurpose::ContactVerification->value)
        ->assertJsonPath('data.challenge.channel', 'email')
        ->assertJsonPath('data.challenge.attempts_remaining', 3)
        ->assertJsonStructure(['data' => ['challenge' => ['challenge_id', 'destination_masked', 'expires_at', 'resend_available_at']], 'meta' => ['correlation_id']]);

    $challengeId = $issued->json('data.challenge.challenge_id');

    $this->getJson('/api/v1/verification/challenges/'.$challengeId, firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.challenge.challenge_id', $challengeId)
        ->assertJsonPath('data.challenge.status', 'pending')
        ->assertJsonPath('data.challenge.is_live', true)
        ->assertJsonPath('meta.correlation_id', fn (mixed $id): bool => is_string($id) && $id !== '');

    // Past the 45-second cooldown, which the service enforces from the row
    // rather than from a client's clock. Asking for the resend a moment after
    // the issue is the refusal, not the smoke.
    $this->travel(60)->seconds();

    $this->postJson('/api/v1/verification/challenges/'.$challengeId.'/resend', [], firstPartyHeaders())
        ->assertStatus(202)
        ->assertJsonPath('data.challenge.challenge_id', $challengeId)
        ->assertJsonPath('data.challenge.resends_remaining', 2)
        // The counter carries over: a resend buys a new code, never new tries.
        ->assertJsonPath('data.challenge.attempts_remaining', 3);
});

it('sends a step-up passcode to a proven destination and unlocks the action with it', function (): void {
    // A step-up goes to a contact the account has already proven; an unverified
    // one is not a candidate, because a code sent to an unproven destination is
    // worth exactly as much as the claim behind it.
    ContactPoint::factory()->verified()->create([
        'user_id' => $this->user->getKey(),
        'is_primary' => true,
    ]);

    $this->actingAs($this->user);

    $challenge = $this->postJson('/api/v1/verification/step-up/challenges', [
        'purpose' => OtpPurpose::ClosureStepUp->value,
    ], firstPartyHeaders())
        ->assertStatus(202)
        ->assertJsonPath('data.challenge.purpose', OtpPurpose::ClosureStepUp->value)
        ->assertJsonStructure(['meta' => ['correlation_id']]);

    $this->postJson('/api/v1/verification/step-up/confirm', [
        'challenge_id' => $challenge->json('data.challenge.challenge_id'),
        'code' => $challenge->json('data.challenge.debug_code'),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.confirmed', true)
        ->assertJsonPath('data.method', 'otp')
        // The guard's own timeout, never a number the controller restates.
        ->assertJsonPath('data.expires_in_seconds', 600)
        ->assertJsonPath('meta.correlation_id', fn (mixed $id): bool => is_string($id) && $id !== '');
});

it('carries both a signed link and an inline passcode in one verification email, and the passcode settles the account', function (): void {
    // D-036, end to end. The named happy path: the message a person actually
    // receives has to contain both halves, and the half this asserts hardest is
    // the one a native client uses — six digits typed into the screen they are
    // already looking at.
    $user = User::factory()->unverified()->create();

    $user->sendEmailVerificationNotification();

    $body = sentMailBodies();

    $challenge = OtpChallenge::query()
        ->where('user_id', $user->getKey())
        ->where('purpose', OtpPurpose::ContactVerification)
        ->sole();

    $code = passcodeWithin($body, $challenge);

    expect($body)->toContain('verify-email')
        // Signed, not merely routed: an unsigned link is a link anybody can mint.
        ->and($body)->toContain('signature')
        ->and($code)->not->toBeNull('The verification email carried no passcode matching the challenge that was issued with it.');

    forgetResolvedGuards();
    $this->actingAs($user);

    $this->postJson('/api/v1/verification/email/verify', ['code' => $code], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.verified', true)
        ->assertJsonPath('data.contact.is_login_identity', true)
        ->assertJsonStructure(['meta' => ['correlation_id']]);

    $contact = ContactPoint::query()->whereKey($challenge->contact_point_id)->sole();

    // Both halves of the one fact, which is the whole point of routing this
    // through ContactVerificationService rather than OtpService.
    expect($contact->verified_at)->not->toBeNull()
        ->and($user->refresh()->email_verified_at)->not->toBeNull();
});

it('refuses a wrong code with the number of tries that are left', function (): void {
    $this->actingAs($this->user);

    $challengeId = $this->postJson('/api/v1/verification/email/challenges', [], firstPartyHeaders())
        ->assertStatus(202)
        ->json('data.challenge.challenge_id');

    $this->postJson('/api/v1/verification/challenges/'.$challengeId.'/verify', [
        'code' => '000000',
    ], firstPartyHeaders())
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'otp.invalid')
        // "2 tries left" is the difference between somebody retyping carefully
        // and somebody locked out with no warning.
        ->assertJsonPath('error.details.attempts_remaining', 2)
        ->assertJsonPath('error.correlation_id', fn (mixed $id): bool => is_string($id) && $id !== '')
        ->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']]);

    expect(OtpChallenge::query()->whereKey($challengeId)->value('attempts'))->toBe(1);
});
