<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Identity\Models\UserDevice;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;

/*
|--------------------------------------------------------------------------
| Native credentials: personal access tokens and device management
|--------------------------------------------------------------------------
|
| The mobile half of the vertical slice (plan §13). Deliberately without an
| Origin header: these requests are never stateful, so every assertion here
| is about the bearer path.
|
*/

beforeEach(function (): void {
    $this->seed();

    $this->cedar = Organisation::query()->where('slug', 'cedar-clinic')->sole();
    $this->owner = User::query()->where('email', 'owner@cedar.test')->sole();
});

/**
 * Exchange the demonstration credentials for a device-bound token.
 *
 * @param  array<string, mixed>  $overrides
 */
function issueToken(array $overrides = []): TestResponse
{
    return test()->postJson('/api/v1/auth/token', [
        'email' => 'owner@cedar.test',
        'password' => 'password',
        'device_name' => 'Nadia iPhone',
        'platform' => 'ios',
        'app_version' => '1.0.0',
        ...$overrides,
    ]);
}

it('exchanges credentials for a device-bound token and authenticates with it', function (): void {
    $response = issueToken()
        ->assertCreated()
        ->assertJsonPath('data.token_type', 'Bearer')
        ->assertJsonPath('data.user.email', 'owner@cedar.test')
        ->assertJsonPath('data.device.device_name', 'Nadia iPhone')
        ->assertJsonPath('data.device.platform', 'ios')
        ->assertJsonPath('data.device.is_current', true)
        ->assertJsonStructure(['data' => ['token', 'token_type', 'user', 'device'], 'meta' => ['correlation_id']]);

    $token = (string) $response->json('data.token');
    $deviceId = (string) $response->json('data.device.id');

    $device = UserDevice::query()->whereKey($deviceId)->sole();

    expect($device->user_id)->toBe((string) $this->owner->getKey())
        ->and(PersonalAccessToken::query()->whereKey($device->token_reference)->exists())->toBeTrue()
        // Only the token identifier is persisted; the plaintext exists once.
        ->and($token)->toContain((string) $device->token_reference)
        ->and($device->last_seen_at)->not->toBeNull();

    $this->withToken($token)
        ->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.user.email', 'owner@cedar.test');

    $this->withToken($token)
        ->getJson('/api/v1/organisations/current', ['X-Organisation-Id' => $this->cedar->getKey()])
        ->assertOk()
        ->assertJsonPath('data.organisation.slug', 'cedar-clinic');
});

it('reports invalid credentials without saying which part was wrong', function (): void {
    issueToken(['password' => 'not-the-password'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'auth.invalid_credentials')
        ->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']]);

    issueToken(['email' => 'nobody@example.test'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'auth.invalid_credentials');

    expect(UserDevice::query()->count())->toBe(0);
});

it('rejects an unsupported platform', function (): void {
    issueToken(['platform' => 'windows'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['platform']]]]);
});

it('demands a two factor code from an enrolled account', function (): void {
    $secret = app(Google2FA::class)->generateSecretKey();

    $this->owner->forceFill([
        'two_factor_secret' => encrypt($secret),
        'two_factor_recovery_codes' => encrypt((string) json_encode(['aaaaaaaaaa-bbbbbbbbbb'])),
        'two_factor_confirmed_at' => now(),
    ])->save();

    issueToken()
        ->assertForbidden()
        ->assertJsonPath('error.code', 'auth.two_factor_required');

    issueToken(['two_factor_code' => '000000'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'auth.two_factor_invalid');

    issueToken(['two_factor_code' => app(Google2FA::class)->getCurrentOtp($secret)])
        ->assertCreated()
        ->assertJsonPath('data.user.two_factor_enabled', true);

    // A recovery code is accepted once and then replaced.
    issueToken(['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])->assertCreated();
    issueToken(['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'auth.two_factor_invalid');
});

it('rotates the credential when the same device registers again', function (): void {
    $first = issueToken()->assertCreated();
    $second = issueToken()->assertCreated();

    expect($second->json('data.device.id'))->toBe($first->json('data.device.id'))
        ->and($second->json('data.token'))->not->toBe($first->json('data.token'))
        ->and(UserDevice::query()->count())->toBe(1)
        ->and(PersonalAccessToken::query()->count())->toBe(1);

    $this->withToken((string) $first->json('data.token'))
        ->getJson('/api/v1/me')
        ->assertUnauthorized()
        ->assertJsonPath('error.code', 'auth.unauthenticated');
});

it('lists devices and revokes one only after a password confirmation', function (): void {
    $phone = issueToken()->assertCreated();
    $tablet = issueToken(['device_name' => 'Clinic iPad', 'platform' => 'android'])->assertCreated();

    $token = (string) $phone->json('data.token');
    $this->withToken($token);

    $this->getJson('/api/v1/me/devices')
        ->assertOk()
        ->assertJsonPath('meta.count', 2)
        ->assertJsonStructure(['data' => [['id', 'device_name', 'platform', 'app_version', 'last_seen_at', 'created_at', 'is_current']]])
        ->assertJsonMissing(['token_reference' => $phone->json('data.device.id')]);

    $tabletId = (string) $tablet->json('data.device.id');

    $this->deleteJson('/api/v1/me/devices/'.$tabletId)
        ->assertForbidden()
        ->assertJsonPath('error.code', 'auth.step_up_required');

    $this->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])
        ->assertOk()
        ->assertJsonPath('data.confirmed', true);

    $this->deleteJson('/api/v1/me/devices/'.$tabletId)->assertNoContent();

    expect(UserDevice::query()->whereKey($tabletId)->sole()->revoked_at)->not->toBeNull();

    forgetResolvedGuards();

    $this->withToken((string) $tablet->json('data.token'))
        ->getJson('/api/v1/me')
        ->assertUnauthorized();

    forgetResolvedGuards();

    // A revoked device is indistinguishable from one that never existed.
    $this->withToken($token)
        ->deleteJson('/api/v1/me/devices/'.$tabletId)
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');
});

it('lets a device revoke itself', function (): void {
    $phone = issueToken()->assertCreated();
    $token = (string) $phone->json('data.token');

    $this->withToken($token)
        ->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])
        ->assertOk();

    $this->withToken($token)
        ->deleteJson('/api/v1/me/devices/'.$phone->json('data.device.id'))
        ->assertNoContent();

    forgetResolvedGuards();

    $this->withToken($token)
        ->getJson('/api/v1/me')
        ->assertUnauthorized()
        ->assertJsonPath('error.code', 'auth.unauthenticated');
});

it('records that a bearer credential was used, at most once per interval', function (): void {
    $phone = issueToken()->assertCreated();
    $token = (string) $phone->json('data.token');
    $deviceId = (string) $phone->json('data.device.id');

    UserDevice::query()->whereKey($deviceId)->update(['last_seen_at' => null]);
    Cache::flush();

    $this->withToken($token)->getJson('/api/v1/me')->assertOk();

    expect(UserDevice::query()->whereKey($deviceId)->sole()->last_seen_at)->not->toBeNull();

    UserDevice::query()->whereKey($deviceId)->update(['last_seen_at' => null]);

    $this->withToken($token)->getJson('/api/v1/me')->assertOk();

    expect(UserDevice::query()->whereKey($deviceId)->sole()->last_seen_at)->toBeNull();
});
