<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The price list header, over HTTP
|--------------------------------------------------------------------------
|
| CRUD, the two immutabilities (code always, currency once prices exist), the
| activation and archive gates, channel assignment, `If-Match`, the cursor and
| the permission split that keeps prices away from the kitchen floor.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('pricing@kitchen.test');
    $this->headers = PricingWorld::headers($this->a);

    $this->actingAs($this->a->user);
});

it('creates a draft price list in a stated currency', function (): void {
    $response = $this->postJson('/api/v1/catalogue/price-lists', [
        'code' => 'web-usd',
        'name_en' => 'Web tariff',
        'name_ar' => 'تعرفة المتجر',
        'currency_code' => 'usd',
    ], $this->headers)->assertStatus(201);

    // A new list is always a draft: one created active would price customers
    // before anybody had entered a price.
    $response->assertJsonPath('data.price_list.status', 'draft')
        ->assertJsonPath('data.price_list.customer_scope', 'public')
        // Normalised on the way in, so a lowercase ISO code is not a second
        // currency.
        ->assertJsonPath('data.price_list.currency_code', 'USD')
        ->assertHeader('ETag', '"0"');
});

it('refuses a second list with the same code', function (): void {
    PricingWorld::priceList($this->a->organisation, 'web-usd');

    $this->postJson('/api/v1/catalogue/price-lists', [
        'code' => 'web-usd',
        'name_en' => 'Another tariff',
        'currency_code' => 'USD',
    ], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.conflicting_field', 'code');
});

it('refuses a currency the platform does not recognise', function (): void {
    $this->postJson('/api/v1/catalogue/price-lists', [
        'code' => 'web-xyz',
        'name_en' => 'Web tariff',
        'currency_code' => 'XYZ',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('serves a list with its channel assignments and entry counts', function (): void {
    $list = PricingWorld::priceList($this->a->organisation);
    $product = PricingWorld::product($this->a);
    $channel = PricingWorld::channel($this->a->organisation);

    PricingWorld::price($list, $product->item, $product->variant, 2200);
    PricingWorld::price($list, PricingWorld::meal($this->a), null, null, null, PriceStatus::Placeholder);
    PricingWorld::assign($channel, $list);

    $this->getJson('/api/v1/catalogue/price-lists/'.$list->getKey(), $this->headers)
        ->assertOk()
        ->assertHeader('ETag', '"0"')
        ->assertJsonPath('data.channels.0.sales_channel_id', (string) $channel->getKey())
        // Two standing rows, one of which is a real price. The pair is what a
        // merchandiser reads as "1 priced, 1 owed".
        ->assertJsonPath('meta.entry_counts.open', 2)
        ->assertJsonPath('meta.entry_counts.confirmed', 1);
});

it('addresses a list by its code as well as its identifier', function (): void {
    PricingWorld::priceList($this->a->organisation, 'web-usd');

    $this->getJson('/api/v1/catalogue/price-lists/web-usd', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.price_list.code', 'web-usd');
});

it('renames a list without touching its code', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, 'web-usd');

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), [
        'name_en' => 'Consumer tariff',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.price_list.name_en', 'Consumer tariff')
        ->assertJsonPath('data.price_list.code', 'web-usd')
        ->assertHeader('ETag', '"1"');
});

it('refuses a code change rather than ignoring it', function (): void {
    // Refused, not stripped: a client that sent it believed it was writing
    // something, and silence teaches nothing.
    $list = PricingWorld::priceList($this->a->organisation, 'web-usd');

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), [
        'code' => 'web-eur',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['code']]]]);
});

it('lets the currency move while the list holds no prices', function (): void {
    // A list that has never priced anything is still a blank form. Freezing
    // the currency at creation would make a typo a reason to start again.
    $list = PricingWorld::priceList($this->a->organisation, 'web-usd');

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), [
        'currency_code' => 'AED',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.price_list.currency_code', 'AED');
});

it('freezes the currency the moment the list holds a price', function (): void {
    // The failure this prevents: 4 500 minor units is 45 AED or 45 USD
    // depending on a field nobody edited, and history negotiated in the old
    // currency cannot be re-denominated at all.
    $list = PricingWorld::priceList($this->a->organisation, 'web-usd');
    $product = PricingWorld::product($this->a);

    PricingWorld::price($list, $product->item, $product->variant, 4500);

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), [
        'currency_code' => 'AED',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'currency_locked')
        ->assertJsonPath('error.details.entry_count', 1);

    expect(PriceList::withoutTenancy()->whereKey($list->getKey())->value('currency_code'))->toBe('USD');
});

it('keeps the currency frozen even when only closed history holds it', function (): void {
    // The subtle half. A list whose every price has been withdrawn still has a
    // history denominated in the old currency, and that history is what an
    // order from last spring points at.
    $list = PricingWorld::priceList($this->a->organisation, 'web-usd');
    $product = PricingWorld::product($this->a);

    PricingWorld::price(
        $list, $product->item, $product->variant, 4500,
        from: now()->subMonth()->startOfDay()->toImmutable(),
        to: now()->startOfDay()->toImmutable(),
    );

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), [
        'currency_code' => 'AED',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'currency_locked');
});

it('refuses a write without If-Match and a stale one with a conflict', function (): void {
    $list = PricingWorld::priceList($this->a->organisation);

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), ['name_en' => 'Renamed'], $this->headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), ['name_en' => 'Renamed'], $this->headers + ['If-Match' => '"7"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), ['name_en' => 'Renamed'], $this->headers + ['If-Match' => '"not-a-validator"'])
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('activates a list that prices something', function (): void {
    $list = PricingWorld::priceList($this->a->organisation);
    $product = PricingWorld::product($this->a);

    PricingWorld::price($list, $product->item, $product->variant, 2200);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.price_list.status', 'active')
        ->assertHeader('ETag', '"1"');
});

it('refuses to activate a list that prices nothing', function (): void {
    // A tariff with no standing rows assigned to a live channel is a silent
    // "nothing is for sale here", and it looks identical to a working
    // configuration.
    $list = PricingWorld::priceList($this->a->organisation);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->assertJsonPath('error.details.reasons.0.reason', 'no_open_rows');
});

it('refuses to activate a list twice', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);
    $product = PricingWorld::product($this->a);

    PricingWorld::price($list, $product->item, $product->variant, 2200);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'price_list_not_a_draft');
});

it('activates a list whose prices are not all confirmed', function (): void {
    // Deliberate. A kitchen with forty confirmed prices and eight owed should
    // trade on the forty; a gate that demanded a complete tariff would push
    // somebody to invent the missing numbers, which is the failure OD-2 exists
    // to prevent. Keeping them from a customer is the public projection's job.
    $list = PricingWorld::priceList($this->a->organisation);
    $meal = PricingWorld::meal($this->a);

    PricingWorld::price($list, $meal, null, null, null, PriceStatus::Placeholder);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.price_list.status', 'active');
});

it('refuses to archive a list a channel still quotes from', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);
    $channel = PricingWorld::channel($this->a->organisation);

    PricingWorld::assign($channel, $list);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/archive', [], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'channel_assignments_active')
        ->assertJsonPath('error.details.sales_channel_ids.0', (string) $channel->getKey());
});

it('archives a detached list and then refuses every further edit', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/archive', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.price_list.status', 'archived');

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), ['name_en' => 'Renamed'], $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('replaces the channel assignments and takes the priority from the array order', function (): void {
    // The order a merchandiser lists the tariffs in *is* the order they mean
    // them consulted in; asking them to invent non-colliding integers would be
    // asking them to do the machine's arithmetic.
    $list = PricingWorld::priceList($this->a->organisation);
    $web = PricingWorld::channel($this->a->organisation, 'web-shop');
    $wholesale = PricingWorld::channel($this->a->organisation, 'wholesale');

    $this->putJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/channels', [
        'channels' => [
            ['sales_channel_id' => (string) $wholesale->getKey()],
            ['sales_channel_id' => (string) $web->getKey()],
        ],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.channels.0.sales_channel_id', (string) $wholesale->getKey())
        ->assertJsonPath('data.channels.0.priority', 0)
        ->assertJsonPath('data.channels.1.sales_channel_id', (string) $web->getKey())
        ->assertJsonPath('data.channels.1.priority', 1);

    // An empty set detaches everything — the step archive insists on first.
    $this->putJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/channels', [
        'channels' => [],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    expect(ChannelPriceList::withoutTenancy()->where('price_list_id', $list->getKey())->count())->toBe(0);
});

it('refuses to name one channel twice', function (): void {
    $list = PricingWorld::priceList($this->a->organisation);
    $web = PricingWorld::channel($this->a->organisation, 'web-shop');

    $this->putJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/channels', [
        'channels' => [
            ['sales_channel_id' => (string) $web->getKey(), 'priority' => 0],
            ['sales_channel_id' => (string) $web->getKey(), 'priority' => 5],
        ],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('excludes archived lists from the index unless asked for by name', function (): void {
    PricingWorld::priceList($this->a->organisation, 'live-usd');
    PriceList::factory()->archived()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'old-usd',
        'currency_code' => 'USD',
    ]);

    $this->getJson('/api/v1/catalogue/price-lists', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'live-usd');

    $this->getJson('/api/v1/catalogue/price-lists?status=archived', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'old-usd');
});

it('filters the index by customer scope and by a search term', function (): void {
    PricingWorld::priceList($this->a->organisation, 'web-usd');
    PriceList::factory()->agreement()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'acme-usd',
        'currency_code' => 'USD',
    ]);

    $this->getJson('/api/v1/catalogue/price-lists?customer_scope=agreement', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'acme-usd');

    $this->getJson('/api/v1/catalogue/price-lists?query=acme', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'acme-usd');

    $this->getJson('/api/v1/catalogue/price-lists?status=nonsense', $this->headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('walks the index with a cursor', function (): void {
    foreach (range(1, 3) as $index) {
        PricingWorld::priceList($this->a->organisation, 'tariff-'.$index);
    }

    $first = $this->getJson('/api/v1/catalogue/price-lists?limit=2', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.has_more', true);

    $cursor = $first->json('meta.next_cursor');

    $this->getJson('/api/v1/catalogue/price-lists?limit=2&cursor='.urlencode((string) $cursor), $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('meta.has_more', false);

    $this->getJson('/api/v1/catalogue/price-lists?cursor=not-a-cursor', $this->headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('keeps prices away from a caller who may read the catalogue but not the tariff', function (): void {
    // The K1.5 split, over HTTP. A chef holds every catalogue and recipe
    // permission and neither price code, and the answer has to be 403 on the
    // read as well as the write — a margin is reconstructable from a cost and
    // a price, so leaking the read would quietly undo K1.3's cost split.
    $chef = PricingWorld::kitchen('chef@kitchen.test', [
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
        'recipe.view_organisation',
        'recipe.manage_organisation',
        'recipe.view_costs_organisation',
    ]);

    $list = PricingWorld::priceList($chef->organisation);

    $this->actingAs($chef->user);
    $headers = PricingWorld::headers($chef);

    $this->getJson('/api/v1/catalogue/price-lists', $headers)
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');

    $this->getJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/entries', $headers)->assertStatus(403);

    $this->postJson('/api/v1/catalogue/price-lists', [
        'code' => 'sneaky', 'name_en' => 'Sneaky', 'currency_code' => 'USD',
    ], $headers)->assertStatus(403);
});

it('lets a viewer read a tariff without being able to write one', function (): void {
    $viewer = PricingWorld::kitchen('viewer@kitchen.test', [
        'catalogue.view_organisation',
        'price_list.view_organisation',
    ]);

    PricingWorld::priceList($viewer->organisation, 'web-usd');

    $this->actingAs($viewer->user);
    $headers = PricingWorld::headers($viewer);

    $this->getJson('/api/v1/catalogue/price-lists', $headers)->assertOk();

    $this->postJson('/api/v1/catalogue/price-lists', [
        'code' => 'another', 'name_en' => 'Another', 'currency_code' => 'USD',
    ], $headers)->assertStatus(403);
});

it('never serves one kitchen another kitchens tariff', function (): void {
    $b = PricingWorld::kitchen('other@kitchen.test');
    $theirs = PricingWorld::priceList($b->organisation, 'their-usd');

    // Addressed by identifier from the wrong organisation: 404, and the
    // message says nothing about whether it exists elsewhere.
    $this->getJson('/api/v1/catalogue/price-lists/'.$theirs->getKey(), $this->headers)
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');

    $this->getJson('/api/v1/catalogue/price-lists', $this->headers)
        ->assertOk()
        ->assertJsonCount(0, 'data');

    // And the same code in two organisations is two different lists.
    PricingWorld::priceList($this->a->organisation, 'their-usd');

    $mine = $this->getJson('/api/v1/catalogue/price-lists/their-usd', $this->headers)->assertOk();

    expect($mine->json('data.price_list.organisation_id'))->toBe((string) $this->a->organisation->getKey())
        ->and($mine->json('data.price_list.id'))->not->toBe((string) $theirs->getKey());
});

it('records the price list lifecycle in the audit trail without leaking a code into a redacted key', function (): void {
    // `AuditRecorder::REDACTED_KEYS` matches by substring, so any metadata key
    // containing "code" is replaced with `[redacted]`. The currency is
    // therefore recorded under `currency`, not `currency_code` — a redaction
    // over-match would otherwise silently erase the one fact that makes an
    // amount meaningful (appendix C foundation defect / OQ-036).
    $list = PricingWorld::priceList($this->a->organisation, 'web-usd');
    $product = PricingWorld::product($this->a);

    PricingWorld::price($list, $product->item, $product->variant, 2200);

    $this->postJson('/api/v1/catalogue/price-lists/'.$list->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson('/api/v1/catalogue/price-lists', [
        'code' => 'second-usd', 'name_en' => 'Second', 'currency_code' => 'USD',
    ], $this->headers)->assertStatus(201);

    $created = AuditLog::query()->where('action', 'catalogue.price_list_created')->orderByDesc('occurred_at')->orderByDesc('id')->first();
    $published = AuditLog::query()->where('action', 'catalogue.price_list_published')->first();

    expect($created)->not->toBeNull()
        ->and($created->metadata['currency'])->toBe('USD')
        ->and($published)->not->toBeNull()
        ->and($published->metadata['status'])->toBe(PriceListStatus::Active->value)
        ->and($published->metadata['open_row_count'])->toBe(1);
});

it('records the customer scope change so a reclassification is never silent', function (): void {
    // The scope *is* editable — a tariff drafted as public that turns out to
    // be one client's deal has to be reclassifiable — and the protection is
    // that it takes the commercial authority and lands in the trail.
    $list = PricingWorld::priceList($this->a->organisation);

    $this->patchJson('/api/v1/catalogue/price-lists/'.$list->getKey(), [
        'customer_scope' => CustomerScope::Agreement->value,
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.price_list.customer_scope', 'agreement');

    $updated = AuditLog::query()->where('action', 'catalogue.price_list_updated')->sole();

    expect($updated->metadata['changed_fields'])->toContain('customer_scope');
});
