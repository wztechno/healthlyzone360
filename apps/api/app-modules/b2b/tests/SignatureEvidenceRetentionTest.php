<?php

declare(strict_types=1);

use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Verification\Jobs\PurgeExpiredOtpChallenges;
use Healthy360\Verification\Models\OtpChallenge;

/*
|--------------------------------------------------------------------------
| The passcode purge leaves signature evidence alone
|--------------------------------------------------------------------------
|
| A signed agreement points at the challenge that proved its signatory was
| present, `ON DELETE RESTRICT`. The hourly purge used to delete every finished
| challenge past retention, hit that constraint on the first signed agreement
| older than a week, and failed every run from then on.
|
*/

it('keeps a challenge a signed agreement cites and purges the rest', function (): void {
    $this->seed(ReferenceDataSeeder::class);

    $world = B2bWorld::provisionedWorld();
    $evidence = $world['agreement']->signature_otp_challenge_id;
    $spare = B2bWorld::spentSignatoryChallenge($world['signatory']);

    $this->travel(8)->days();

    (new PurgeExpiredOtpChallenges)->handle();

    expect(OtpChallenge::query()->whereKey($evidence)->exists())->toBeTrue()
        ->and(OtpChallenge::query()->whereKey($spare->getKey())->exists())->toBeFalse();
});
