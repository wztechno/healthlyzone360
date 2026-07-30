<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Feature tests and module tests run against the healthy360_test PostgreSQL
| database (phpunit.xml), so both suites get the application test case and
| a refreshed schema.
|
*/

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('../app-modules/*/tests');

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

/**
 * Headers a first-party client sends. Sanctum only issues a cookie session
 * to an origin listed in SANCTUM_STATEFUL_DOMAINS, so a session test that
 * omits these is testing the token path by accident.
 *
 * @return array<string, string>
 */
function firstPartyHeaders(): array
{
    return ['Origin' => 'http://localhost:8081'];
}

/**
 * Emulate the boundary between two HTTP requests.
 *
 * A deployed request cycle resolves its guards from scratch, so the user is
 * re-derived from the cookie or bearer token every time. A test process
 * keeps the resolved guards for the whole test, which would let a user
 * cached from an earlier request survive a logout or a change of credential.
 * Tests that swap credentials call this in between.
 */
function forgetResolvedGuards(): void
{
    app('auth')->forgetGuards();
}
