<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\CreditMemoStatus;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\CreditMemo;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
|--------------------------------------------------------------------------
| The subscription journey, over HTTP
|--------------------------------------------------------------------------
|
| One pass through the whole customer surface: quote, buy, read the balance,
| skip a day, pause, and cancel with the memo that falls out of it. The
| service-layer properties are proven in S1's own smokes; what this file
| exists to prove is that the *wire* preserves them, because a balance that is
| right in the database and wrong on the screen is a balance a customer will
| never believe again.
|
| Three properties carry the file:
|
|  1. **Skipping and pausing cost nothing.** `remaining_days` is asserted
|     unchanged across both, from the response body rather than from the model.
|     That is §1 as a client can observe it, and it is the single claim most
|     likely to rot silently — a presenter that served `balance_days_total`
|     minus a skip count would look plausible in every code review.
|  2. **The captured price reaches the customer.** All three columns, so "why
|     am I paying 1 800 when the plan says 2 000" is answerable on the screen.
|  3. **The credit memo comes back with the cancellation**, carrying
|     `settlement: manual` on the wire. A client left to infer that from the
|     status vocabulary would eventually render `recorded` as "refunded".
|
| SPEED MODE: one smoke per route family, per the wave protocol. The exhaustive
| per-endpoint refusal matrix is on the deferred list.
|
*/

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);

    // A 20-day plan at 2 000 a day with a stated 10% duration discount, so the
    // grandfathered per-day price is 1 800 and the three price columns are
    // genuinely different numbers rather than three copies of one.
    $this->world = SubscriptionWorld::build('journey@kitchen.test', perDayMinor: 2000, discountPercent: '10.00', days: 20);
    $this->customer = $this->world->customer->account->user;
});

it('quotes, buys, skips, pauses and cancels without ever losing a balance day', function (): void {
    $this->actingAs($this->customer);

    // ------------------------------------------------------------------ quote

    $quote = $this->getJson('/api/v1/subscriptions/quote?'.http_build_query([
        'sales_channel_id' => (string) $this->world->channel->getKey(),
        'catalogue_item_id' => (string) $this->world->plan->getKey(),
        'catalogue_item_variant_id' => (string) $this->world->configuration->getKey(),
        'plan_duration_id' => (string) $this->world->duration->getKey(),
    ]), firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.quote.days', 20)
        ->assertJsonPath('data.quote.list_price_minor', 2000)
        ->assertJsonPath('data.quote.discount_percent', '10.00')
        ->assertJsonPath('data.quote.per_day_minor', 1800)
        ->assertJsonPath('data.quote.total_minor', 36000);

    // The provenance is never on a customer's screen: it names a kitchen's
    // tariff structure to the person being charged by it.
    expect($quote->json('data.quote'))->not->toHaveKey('price_list_id')
        ->and($quote->json('data.quote'))->not->toHaveKey('price_list_item_id');

    // --------------------------------------------------------------------- buy

    $created = $this->postJson('/api/v1/subscriptions', [
        'sales_channel_id' => (string) $this->world->channel->getKey(),
        'branch_id' => (string) $this->world->branch->getKey(),
        'catalogue_item_id' => (string) $this->world->plan->getKey(),
        'catalogue_item_variant_id' => (string) $this->world->configuration->getKey(),
        'plan_duration_id' => (string) $this->world->duration->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
        'weekdays' => [1, 2, 3, 4, 5, 6, 7],
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.subscription.status', SubscriptionStatus::Active->value)
        // The captured price, in full. The derivation as well as the result.
        ->assertJsonPath('data.subscription.captured_unit_price_minor', 2000)
        ->assertJsonPath('data.subscription.captured_discount_percent', '10.00')
        ->assertJsonPath('data.subscription.effective_day_price_minor', 1800)
        ->assertJsonPath('data.subscription.balance.remaining_days', 20)
        ->assertJsonPath('data.subscription.balance.skipped_days', 0);

    $id = $created->json('data.subscription.id');

    // Never on the wire, whatever else changes.
    expect($created->json('data.subscription'))->not->toHaveKey('organisation_id')
        ->and($created->json('data.subscription'))->not->toHaveKey('captured_price_list_id')
        ->and($created->json('data.subscription'))->not->toHaveKey('created_by');

    // -------------------------------------------------------------------- read

    $this->getJson("/api/v1/me/subscriptions/{$id}", firstPartyHeaders())
        ->assertOk()
        ->assertHeader('ETag', '"'.Subscription::query()->findOrFail($id)->lock_version.'"')
        ->assertJsonPath('data.subscription.balance.balance_days_total', 20)
        ->assertJsonPath('data.subscription.balance.balance_days_consumed', 0);

    $this->getJson('/api/v1/me/subscriptions', firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.id', $id);

    // -------------------------------------------------------------------- skip

    // Far enough out that the plan's 24-hour window is open on it whatever hour
    // the suite runs at, and a day the subscription delivers on because it
    // delivers on all seven.
    $skipDate = now()->addDays(4)->toDateString();

    $this->postJson("/api/v1/me/subscriptions/{$id}/skips", ['date' => $skipDate], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.delivery.status', 'skipped_customer')
        ->assertJsonPath('data.delivery.consumed', false)
        // §1, as a client can observe it: the skip is recorded and the balance
        // has not moved.
        ->assertJsonPath('data.balance.remaining_days', 20)
        ->assertJsonPath('data.balance.skipped_days', 1);

    // ------------------------------------------------------------------- pause

    $this->postJson("/api/v1/me/subscriptions/{$id}/pause", [], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.subscription.status', SubscriptionStatus::Paused->value)
        // A paused subscription has no next date at all — nulling the cursor is
        // what takes it out of the sweep.
        ->assertJsonPath('data.subscription.next_delivery_date', null)
        ->assertJsonPath('data.subscription.balance.remaining_days', 20);

    // ------------------------------------------------------------------ ledger

    $this->getJson("/api/v1/me/subscriptions/{$id}/deliveries", firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.delivery_date', $skipDate)
        ->assertJsonPath('data.0.consumed', false)
        ->assertJsonPath('meta.balance.remaining_days', 20);

    // ------------------------------------------------------------------ cancel

    $cancelled = $this->postJson("/api/v1/me/subscriptions/{$id}/cancel", ['reason' => 'moving_away'], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.subscription.status', SubscriptionStatus::Cancelled->value)
        ->assertJsonPath('data.subscription.cancellation_reason', 'moving_away')
        // Twenty unused days at the grandfathered 1 800: the discount already
        // enjoyed is not clawed back.
        ->assertJsonPath('data.credit_memo.unused_days', 20)
        ->assertJsonPath('data.credit_memo.per_day_minor', 1800)
        ->assertJsonPath('data.credit_memo.amount_minor', 36000)
        ->assertJsonPath('data.credit_memo.status', CreditMemoStatus::Recorded->value)
        // The one sentence a customer needs, stated rather than inferred.
        ->assertJsonPath('data.credit_memo.settlement', 'manual');

    expect(CreditMemo::query()->where('subscription_id', $id)->count())->toBe(1)
        ->and($cancelled->json('data.credit_memo.currency_code'))->toBe($this->world->priceList->currency_code);

    // Terminal, and the state machine says so rather than a 500.
    $this->postJson("/api/v1/me/subscriptions/{$id}/resume", [], firstPartyHeaders())
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'subscription.change_refused');
});

it('answers somebody else subscription with 404 rather than a denial', function (): void {
    $mine = SubscriptionWorld::build('mine@kitchen.test');
    $theirs = SubscriptionWorld::build('theirs@kitchen.test');

    $subscription = app(SubscriptionService::class)->create(SubscriptionWorld::request($theirs));

    $this->actingAs($mine->customer->account->user);

    // Not 403. Confirming that an identifier names a real standing arrangement
    // is a disclosure on its own — the row carries an address and a negotiated
    // price.
    $this->getJson('/api/v1/me/subscriptions/'.$subscription->getKey(), firstPartyHeaders())
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');

    $this->postJson('/api/v1/me/subscriptions/'.$subscription->getKey().'/pause', [], firstPartyHeaders())
        ->assertNotFound();
});
