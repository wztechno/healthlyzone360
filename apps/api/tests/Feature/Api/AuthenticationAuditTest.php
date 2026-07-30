<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Audit\Services\AuditRecorder;
use Illuminate\Support\Facades\Cache;

/*
|--------------------------------------------------------------------------
| Authentication auditing (plan §12)
|--------------------------------------------------------------------------
|
| Sign-in activity has to be reconstructable after an incident, and the trail
| itself must never become the leak: no passwords, no tokens, no two-factor
| codes, whatever a caller sent.
|
*/

beforeEach(function (): void {
    $this->seed();

    $this->withHeaders([...firstPartyHeaders(), 'X-Client-Platform' => 'ios']);

    $this->owner = User::query()->where('email', 'owner@cedar.test')->sole();
});

/**
 * @return array<string, mixed>
 */
function auditMetadata(string $action): array
{
    /** @var array<string, mixed> */
    return AuditLog::query()->where('action', $action)->latest('occurred_at')->sole()->metadata;
}

it('records a successful sign-in with its correlation identifier', function (): void {
    $response = $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
        ->assertOk();

    $log = AuditLog::query()->where('action', 'auth.login_succeeded')->sole();

    expect($log->actor_user_id)->toBe((string) $this->owner->getKey())
        ->and($log->correlation_id)->toBe($response->headers->get('X-Correlation-Id'))
        ->and($log->metadata)->toMatchArray(['guard' => 'web', 'client_platform' => 'ios'])
        ->and($log->metadata)->not->toHaveKey('password');
});

it('records a failed sign-in with the attempted address but nothing secret', function (): void {
    $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'hunter2'])
        ->assertStatus(422);

    $metadata = auditMetadata('auth.login_failed');

    expect($metadata['attempted_email'])->toBe('owner@cedar.test')
        ->and(json_encode($metadata))->not->toContain('hunter2');
});

it('records a lockout, and a native sign-in once the lockout has passed', function (): void {
    foreach (range(1, 6) as $ignored) {
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'hunter2']);
    }

    expect(AuditLog::query()->where('action', 'auth.login_locked_out')->exists())->toBeTrue();

    // The native endpoint shares the lockout, so it has to lapse first.
    $this->postJson('/api/v1/auth/token', [
        'email' => 'owner@cedar.test',
        'password' => 'password',
        'device_name' => 'Nadia iPhone',
        'platform' => 'ios',
    ])->assertStatus(429);

    Cache::flush();
    AuditLog::query()->delete();

    $this->postJson('/api/v1/auth/token', [
        'email' => 'owner@cedar.test',
        'password' => 'password',
        'device_name' => 'Nadia iPhone',
        'platform' => 'ios',
    ])->assertCreated();

    expect(AuditLog::query()->where('action', 'auth.login_succeeded')->value('metadata'))
        ->toMatchArray(['guard' => 'sanctum']);
});

it('redacts anything secret a caller manages to pass into audit metadata', function (): void {
    app(AuditRecorder::class)->record(
        'auth.login_succeeded',
        (string) $this->owner->getKey(),
        metadata: [
            'ip' => '127.0.0.1',
            'password' => 'hunter2',
            'two_factor_secret' => 'JBSWY3DPEHPK3PXP',
            'access_token' => 'plain-text-token',
            'recovery_code' => 'aaaa-bbbb',
        ],
    );

    expect(auditMetadata('auth.login_succeeded'))->toMatchArray([
        'ip' => '127.0.0.1',
        'password' => '[redacted]',
        'two_factor_secret' => '[redacted]',
        'access_token' => '[redacted]',
        'recovery_code' => '[redacted]',
    ]);
});

it('records a password reset', function (): void {
    $token = app('auth.password.broker')->createToken($this->owner);

    $this->postJson('/api/v1/auth/reset-password', [
        'token' => $token,
        'email' => 'owner@cedar.test',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertOk();

    expect(AuditLog::query()->where('action', 'auth.password_reset')->exists())->toBeTrue();
});
