<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The wire contract for failures (docs/api/conventions.md)
|--------------------------------------------------------------------------
|
| Every non-2xx API response is the same four-key error envelope with a
| stable machine-readable code, and every response carries the correlation
| identifier support will ask the caller for.
|
*/

beforeEach(function (): void {
    $this->seed();

    $this->cedar = Organisation::query()->where('slug', 'cedar-clinic')->sole();
    $this->verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();
    $this->owner = User::query()->where('email', 'owner@cedar.test')->sole();
});

/**
 * The envelope contract: exactly these keys, nothing else.
 */
function assertErrorEnvelope(TestResponse $response, string $code): void
{
    $response->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']])
        ->assertJsonPath('error.code', $code);

    expect(array_keys((array) $response->json('error')))
        ->toBe(['code', 'message', 'details', 'correlation_id'])
        ->and($response->json())->not->toHaveKey('data')
        ->and($response->json('error.message'))->toBeString()->not->toBeEmpty()
        ->and($response->json('error.correlation_id'))->toBe($response->headers->get('X-Correlation-Id'));
}

it('answers an unauthenticated request with 401 auth.unauthenticated', function (): void {
    assertErrorEnvelope(
        $this->getJson('/api/v1/me')->assertUnauthorized(),
        'auth.unauthenticated',
    );
});

it('answers a cross-organisation request with 403 context.organisation_forbidden', function (): void {
    assertErrorEnvelope(
        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/organisations/current', ['X-Organisation-Id' => $this->verdant->getKey()])
            ->assertForbidden(),
        'context.organisation_forbidden',
    );
});

it('answers a missing organisation header with 400 context.organisation_required', function (): void {
    assertErrorEnvelope(
        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/organisations/current')
            ->assertStatus(400),
        'context.organisation_required',
    );
});

it('answers an unknown resource with 404 resource.not_found', function (): void {
    $this->actingAs($this->owner, 'sanctum');

    $this->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertOk();

    assertErrorEnvelope(
        $this->deleteJson('/api/v1/me/devices/'.Str::uuid7())->assertNotFound(),
        'resource.not_found',
    );
});

it('answers an unrouted path in the envelope', function (): void {
    $this->getJson('/api/v1/nothing-here')
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found')
        ->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']]);
});

it('answers invalid input with 422 validation.failed and a field map', function (): void {
    $response = $this->postJson('/api/v1/auth/register', ['email' => 'not-an-email'])->assertStatus(422);

    assertErrorEnvelope($response, 'validation.failed');

    expect(array_keys((array) $response->json('error.details.fields')))
        ->toContain('email', 'password', 'given_name', 'family_name', 'accepts_terms', 'accepts_privacy');
});

it('answers a locked-out sign-in with 429 rate_limit.exceeded and Retry-After', function (): void {
    $this->withHeaders(firstPartyHeaders());

    foreach (range(1, 5) as $ignored) {
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'wrong'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'auth.invalid_credentials');
    }

    $response = $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'wrong'])
        ->assertStatus(429)
        ->assertHeader('Retry-After');

    assertErrorEnvelope($response, 'rate_limit.exceeded');
});

it('rejects a session endpoint reached without a first-party origin', function (): void {
    assertErrorEnvelope(
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
            ->assertStatus(400),
        'request.invalid',
    );
});

it('generates its own correlation identifier and never trusts the client', function (): void {
    $success = $this->actingAs($this->owner, 'sanctum')->getJson('/api/v1/me', [
        'X-Client-Request-Id' => 'client-abc-123',
    ])->assertOk();

    $correlationId = (string) $success->headers->get('X-Correlation-Id');

    expect(Str::isUuid($correlationId))->toBeTrue()
        ->and($correlationId)->not->toBe('client-abc-123')
        ->and($success->json('meta.correlation_id'))->toBe($correlationId)
        // The client identifier is echoed for support correlation only.
        ->and($success->headers->get('X-Client-Request-Id'))->toBe('client-abc-123');

    $second = $this->actingAs($this->owner, 'sanctum')->getJson('/api/v1/me')->assertOk();

    expect($second->headers->get('X-Correlation-Id'))->not->toBe($correlationId);
});

it('never leaks an internal failure to the client', function (): void {
    Route::middleware('api')->get('/api/v1/testing/explode', function (): void {
        throw new RuntimeException('connection string user=healthy360 password=hunter2');
    });

    $this->getJson('/api/v1/testing/explode')
        ->assertStatus(500)
        ->assertJsonPath('error.code', 'server.internal_error')
        ->assertJsonPath('error.message', 'An unexpected error occurred. The correlation identifier can be quoted to support.')
        ->assertJsonMissing(['hunter2']);
});
