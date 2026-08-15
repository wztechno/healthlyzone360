<?php

declare(strict_types=1);

use App\Models\User;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;

/*
|--------------------------------------------------------------------------
| The demo account that is already through two-factor enrolment
|--------------------------------------------------------------------------
|
| `two-factor@cedar.test` is seeded with a *fixed*, published TOTP secret so an
| end-to-end suite can compute a valid code for it instead of scraping one out
| of the database mid-run. That only works if the seeded columns are exactly
| what Fortify writes — ciphertext from its own encrypter, eight recovery codes
| as a JSON list, and a confirmation timestamp — and "exactly" is a claim worth
| a test rather than a docblock.
|
| Asserted through the HTTP challenge, not by inspecting the columns: what
| matters is that a code generated from the published secret actually signs the
| account in, which is the thing the e2e suite will do.
|
*/

const SEEDED_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

beforeEach(function (): void {
    $this->seed();

    $this->withHeaders(firstPartyHeaders());
});

it('seeds a demonstration account with two factor authentication fully armed', function (): void {
    $user = User::query()->where('email', 'two-factor@cedar.test')->sole();

    expect($user->hasEnabledTwoFactorAuthentication())->toBeTrue()
        ->and($user->two_factor_confirmed_at)->not->toBeNull()
        ->and($user->email_verified_at)->not->toBeNull()
        ->and(Fortify::currentEncrypter()->decrypt((string) $user->two_factor_secret))->toBe(SEEDED_TOTP_SECRET)
        ->and($user->recoveryCodes())->toHaveCount(8);
});

it('signs that account in with a code generated from the published secret', function (): void {
    // Enrolled means challenged: the password alone is not a session.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'two-factor@cedar.test',
        'password' => 'password',
    ])
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', true);

    $this->postJson('/api/v1/auth/two-factor-challenge', [
        'code' => app(Google2FA::class)->getCurrentOtp(SEEDED_TOTP_SECRET),
    ])
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', false);

    $this->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.user.email', 'two-factor@cedar.test')
        ->assertJsonPath('data.user.two_factor_enabled', true);
});
