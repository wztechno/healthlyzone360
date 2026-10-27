<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/*
|--------------------------------------------------------------------------
| Named rate limiters
|--------------------------------------------------------------------------
|
| `catalogue-import` guards the three workbook import endpoints. What is
| tested here is the definition itself: how many, over what window, and
| which bucket. The routes' own tests prove the middleware is attached.
|
|
*/

/**
 * The limit a named limiter produces for a given request.
 */
function limitFor(string $name, Request $request): Limit
{
    $limiter = RateLimiter::limiter($name);

    expect($limiter)->not->toBeNull();

    /** @var Limit */
    return $limiter($request);
}

it('allows thirty catalogue imports an hour', function (): void {
    $limit = limitFor('catalogue-import', Request::create('/api/v1/catalogue/ingredients/imports', 'POST'));

    // A typo-fix-reupload loop spends one run a pass; five ran out after
    // three. Thirty is not a defence against a hostile client — authentication
    // and permissions are — it is a defence against a re-run loop.
    expect($limit->maxAttempts)->toBe(30)
        ->and($limit->decaySeconds)->toBe(3600);
});

it('buckets a catalogue import by the active organisation', function (): void {
    $organisationId = '019fc000-0000-7000-8000-000000000001';

    app(TenantContext::class)->restore([
        'user_id' => '019fc000-0000-7000-8000-0000000000ff',
        'organisation_id' => $organisationId,
        'branch_id' => null,
    ]);

    // The unit that must not re-run a catalogue load in a loop is the tenant,
    // not the individual operator: two administrators of one kitchen taking
    // thirty runs each is exactly the thing being prevented.
    expect(limitFor('catalogue-import', Request::create('/api/v1/catalogue/ingredients/imports', 'POST'))->key)
        ->toBe('organisation:'.$organisationId);
});

it('falls back to the user and then to the address when no organisation is active', function (): void {
    $user = User::factory()->create();

    $request = Request::create('/api/v1/catalogue/ingredients/imports', 'POST');
    $request->setUserResolver(fn (): User => $user);

    expect(limitFor('catalogue-import', $request)->key)->toBe('user:'.$user->getKey());

    // Neither fallback is the right bucket, and both beat an empty key: a
    // limiter that returned one would put every such caller into a single
    // shared bucket, which is a denial of service dressed as a throttle.
    $anonymous = Request::create('/api/v1/catalogue/ingredients/imports', 'POST', server: ['REMOTE_ADDR' => '203.0.113.7']);

    expect(limitFor('catalogue-import', $anonymous)->key)->toBe('ip:203.0.113.7');
});

it('keeps the baseline api limiter at sixty a minute', function (): void {
    // Guarded here beside the new one so that a change to either is a change
    // somebody had to make deliberately.
    $limit = limitFor('api', Request::create('/api/v1/me', 'GET', server: ['REMOTE_ADDR' => '203.0.113.7']));

    expect($limit->maxAttempts)->toBe(60)
        ->and($limit->decaySeconds)->toBe(60)
        ->and($limit->key)->toBe('203.0.113.7');
});
