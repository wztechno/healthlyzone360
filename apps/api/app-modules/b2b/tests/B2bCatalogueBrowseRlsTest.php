<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Services\B2bCatalogueBrowse;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;

/**
 * The suite connects as the migrator, which the `price_list_items` policy does
 * not bind, so only a run under the runtime role shows what a corporate buyer
 * actually sees: their own organisation in `app.organisation_id`, and the
 * kitchen's tariff behind the policy.
 */
beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('prices the corporate catalogue under the runtime role with the buyer organisation in context', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $buyer = $world['buyers']['acme'];

    RuntimeRole::context((string) $buyer['user']->getKey(), (string) $buyer['organisation']->getKey());

    $items = RuntimeRole::run(fn (): array => app(B2bCatalogueBrowse::class)->items($buyer['account'], CarbonImmutable::now()));

    expect($items)->toHaveCount(1)
        ->and($items[0]['price']->amountMinor)->toBe($buyer['priceMinor']);
});
