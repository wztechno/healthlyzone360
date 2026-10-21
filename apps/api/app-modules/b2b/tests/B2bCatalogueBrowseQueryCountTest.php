<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Services\B2bCatalogueBrowse;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/**
 * The corporate catalogue prices a whole channel in one batch (2026-10-21):
 * per article it cost about four seconds for thirty. Pinned as "the query
 * count does not grow with the articles", so a later per-article read shows up
 * here rather than in a buyer's spinner.
 */
beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

function browseQueryCount(array $buyer): array
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $items = app(B2bCatalogueBrowse::class)->items($buyer['account'], CarbonImmutable::now()->startOfDay());
    $count = count(DB::getQueryLog());
    DB::disableQueryLog();

    return [$items, $count];
}

it('prices the corporate catalogue in a fixed number of queries, however many articles it has', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $buyer = $world['buyers']['acme'];

    [$one, $queriesForOne] = browseQueryCount($buyer);

    foreach (range(1, 8) as $n) {
        $meal = CheckoutWorld::publishedMeal($world['seller'], "Batch meal {$n}");
        CheckoutWorld::offer($world['channel'], $meal);
        PricingWorld::price($buyer['agreementList'], $meal, null, 1000 + $n);
    }

    [$nine, $queriesForNine] = browseQueryCount($buyer);

    expect($one)->toHaveCount(1)
        ->and($nine)->toHaveCount(9)
        // Each article at its own agreement price, as `currentFor()` would answer.
        ->and(collect($nine)->firstWhere('item.name_en', 'Batch meal 3')['price']->amountMinor)->toBe(1003)
        ->and($queriesForNine)->toBe($queriesForOne);
});
