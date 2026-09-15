<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A finished checklist activates the account, at the only moment anything asks
|--------------------------------------------------------------------------
|
| `POST /customer-account` is the only other place in the codebase that attempts
| activation, and no client calls it. So a person who verified their email,
| saved an address in a served area and answered the allergy question satisfied
| every requirement the evaluator makes and was still refused with
| `account_not_active` — for ever, with nothing they could do about it.
| `CheckoutEligibility` activates them instead.
|
| That is not a loosening, and the second test is what says so:
| `CustomerAccountLifecycle::activate()` re-asks the same evaluator, so an
| account with anything outstanding is refused exactly as it was before.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('checkout-activation@kitchen.test');
    $this->placement = app(OrderPlacementService::class);
});

it('activates a provisional consumer whose checklist is clean, and places their order', function (): void {
    // `readyCustomer()` satisfies every requirement the evaluator checks — a
    // verified email, a delivery address in a served area, a declared dietary
    // answer, and no required consent outstanding because this world seeds no
    // consent catalogue — but creates the account already `active`. Wound back
    // to where onboarding actually leaves somebody.
    $account = $this->world->customer->account;
    $account->forceFill(['status' => CustomerAccountStatus::Provisional, 'activated_at' => null])->save();

    $order = $this->placement->placeComposed(new ComposedPlacement(
        account: $account,
        address: $this->world->customer->address,
        organisationId: (string) $this->world->organisation->getKey(),
        salesChannelId: (string) $this->world->channel->getKey(),
        branchId: (string) $this->world->branch->getKey(),
        currencyCode: $this->world->organisation->default_currency_code,
        lines: [new ComposedLine(catalogueItemId: (string) $this->world->meal->getKey())],
    ))->order;

    $account->refresh();

    expect($order->customer_account_id)->toBe((string) $account->getKey())
        ->and($account->status)->toBe(CustomerAccountStatus::Active)
        // Stamped, not merely flipped: "when did this account activate" is a
        // question orders and retention both ask.
        ->and($account->activated_at)->not->toBeNull();
});

it('still refuses a provisional consumer with something outstanding, and leaves them provisional', function (): void {
    // No verified email, no address, no dietary declaration. A pickup so that
    // the missing address is not a second refusal about the same account.
    $caller = CustomerAccountFactory::new()->create();

    $reasons = [];

    try {
        $this->placement->placeComposed(new ComposedPlacement(
            account: $caller,
            address: null,
            organisationId: (string) $this->world->organisation->getKey(),
            salesChannelId: (string) $this->world->channel->getKey(),
            branchId: (string) $this->world->branch->getKey(),
            currencyCode: $this->world->organisation->default_currency_code,
            lines: [new ComposedLine(catalogueItemId: (string) $this->world->meal->getKey())],
            fulfilmentType: FulfilmentType::Pickup,
        ));
    } catch (PlacementRefused $refused) {
        /** @var list<array<string, mixed>> $reasons */
        $reasons = $refused->details['reasons'] ?? [];
    }

    expect(array_column($reasons, 'reason'))->toContain('account_not_ready')
        ->and($caller->refresh()->status)->toBe(CustomerAccountStatus::Provisional)
        ->and(Order::query()->count())->toBe(0);
});
