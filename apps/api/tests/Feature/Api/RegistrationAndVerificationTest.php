<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Consent\Enums\ConsentStatus;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Consent\Models\ConsentGrant;
use Healthy360\Identity\Models\UserProfile;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Notification;

/*
|--------------------------------------------------------------------------
| Registration and email verification
|--------------------------------------------------------------------------
|
| The first half of the foundation vertical slice (plan §1): an account, a
| person, recorded consent, and an address the platform has proved reaches
| that person.
|
*/

beforeEach(function (): void {
    $this->seed();

    Notification::fake();

    $this->withHeaders(firstPartyHeaders());

    $this->payload = [
        'email' => 'Nour@Example.test',
        'password' => 'correct-horse-battery-staple',
        'password_confirmation' => 'correct-horse-battery-staple',
        'given_name' => 'Nour',
        'family_name' => 'Sabbagh',
        'preferred_language_code' => 'ar',
        'country_code' => 'LB',
        'timezone' => 'Asia/Beirut',
        'accepts_terms' => true,
        'accepts_privacy' => true,
    ];
});

it('registers an account, a profile and the accepted consents in one act', function (): void {
    $this->postJson('/api/v1/auth/register', $this->payload)
        ->assertCreated()
        ->assertJsonPath('data.user.email', 'nour@example.test')
        ->assertJsonPath('data.user.email_verified', false)
        ->assertJsonPath('data.user.two_factor_enabled', false)
        ->assertJsonStructure(['data' => ['user' => ['id']], 'meta' => ['correlation_id']]);

    $user = User::query()->where('email', 'nour@example.test')->sole();

    expect(UserProfile::query()->where('user_id', $user->getKey())->value('given_name'))->toBe('Nour');

    $granted = ConsentGrant::withoutTenancy()
        ->where('user_id', $user->getKey())
        ->where('status', ConsentStatus::Granted)
        ->pluck('consent_definition_id');

    $codes = ConsentDefinition::query()->whereIn('id', $granted)->orderBy('code')->pluck('code')->all();

    expect($codes)->toBe(['consent.privacy', 'consent.terms']);

    Notification::assertSentTo($user, VerifyEmail::class);
});

it('refuses to register without both platform consents', function (string $field): void {
    $this->postJson('/api/v1/auth/register', [...$this->payload, $field => false])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['code', 'message', 'details' => ['fields' => [$field]], 'correlation_id']]);

    expect(User::query()->where('email', 'nour@example.test')->exists())->toBeFalse();
})->with(['accepts_terms', 'accepts_privacy']);

it('locks an unverified account out of verified endpoints and lets it in after the signed link', function (): void {
    $this->postJson('/api/v1/auth/register', $this->payload)->assertCreated();

    $user = User::query()->where('email', 'nour@example.test')->sole();

    // Reachable before verification on purpose: the client renders the
    // "verify your email" state from this payload.
    $this->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.user.email_verified', false)
        ->assertJsonPath('data.active_context', null);

    $this->getJson('/api/v1/me/devices')
        ->assertForbidden()
        ->assertJsonPath('error.code', 'auth.email_unverified');

    $verificationUrl = null;

    Notification::assertSentTo($user, VerifyEmail::class, function (VerifyEmail $notification) use ($user, &$verificationUrl): bool {
        $verificationUrl = $notification->toMail($user)->actionUrl;

        return true;
    });

    expect($verificationUrl)->toBeString();

    $this->getJson((string) $verificationUrl)
        ->assertOk()
        ->assertJsonPath('data.email_verified', true);

    expect($user->refresh()->hasVerifiedEmail())->toBeTrue();

    $this->getJson('/api/v1/me/devices')
        ->assertOk()
        ->assertJsonPath('data', [])
        ->assertJsonPath('meta.count', 0);
});

it('rejects a tampered verification link with its own error code', function (): void {
    $this->postJson('/api/v1/auth/register', $this->payload)->assertCreated();

    $user = User::query()->where('email', 'nour@example.test')->sole();

    $this->getJson(sprintf(
        '/api/v1/auth/verify-email/%s/%s?expires=%d&signature=%s',
        $user->getKey(),
        sha1($user->getEmailForVerification()),
        now()->addHour()->getTimestamp(),
        str_repeat('0', 64),
    ))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'auth.invalid_signature');

    expect($user->refresh()->hasVerifiedEmail())->toBeFalse();
});

it('reports an already-verified resend as 204 rather than sending another mail', function (): void {
    $this->postJson('/api/v1/auth/register', $this->payload)->assertCreated();

    $user = User::query()->where('email', 'nour@example.test')->sole();

    $this->postJson('/api/v1/auth/email/verification-notification')
        ->assertStatus(202)
        ->assertJsonPath('data.sent', true);

    $verificationUrl = null;

    Notification::assertSentTo($user, VerifyEmail::class, function (VerifyEmail $notification) use ($user, &$verificationUrl): bool {
        $verificationUrl = $notification->toMail($user)->actionUrl;

        return true;
    });

    $this->getJson((string) $verificationUrl)->assertOk();

    // 204 is a documented envelope exception: there is nothing to say.
    $this->postJson('/api/v1/auth/email/verification-notification')->assertNoContent();
});
