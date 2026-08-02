<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| Set-replace on the outside, effective-dated history on the inside
|--------------------------------------------------------------------------
|
| The PUT body is the desired *current* pricing state. The storage is a
| history that is never mutated and never deleted. This suite is the proof
| that the two meet correctly:
|
|   submitted, not standing        → open a row
|   submitted, standing, same      → touch nothing at all
|   submitted, standing, different → close the old, open the new, link them
|   not submitted, standing        → close the old, no successor
|
| The "touch nothing" case is the one worth the most attention: a nightly
| importer reposting an unchanged sheet must not manufacture a supersession
| chain hundreds deep and destroy the ability to answer "when did this price
| actually change".
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('entries@kitchen.test');
    $this->headers = PricingWorld::headers($this->a);
    $this->list = PricingWorld::priceList($this->a->organisation, 'web-usd');
    $this->product = PricingWorld::product($this->a);

    $this->actingAs($this->a->user);

    $this->put = function (array $entries, int $lockVersion) {
        return $this->putJson(
            '/api/v1/catalogue/price-lists/'.$this->list->getKey().'/entries',
            ['entries' => $entries],
            $this->headers + ['If-Match' => '"'.$lockVersion.'"'],
        );
    };

    $this->rowsFor = fn (): array => PriceListItem::withoutTenancy()
        ->where('price_list_id', $this->list->getKey())
        ->orderBy('created_at')
        ->orderBy('id')
        ->get()
        ->all();
});

it('opens a standing row for a price that did not exist', function (): void {
    ($this->put)([[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]], 0)
        ->assertOk()
        ->assertJsonCount(1, 'data.entries')
        ->assertJsonPath('data.entries.0.unit_amount_minor', 2200)
        // The currency travels with every row even though it belongs to the
        // list: a row that ends up in a table cell or a log line must not
        // arrive without it.
        ->assertJsonPath('data.entries.0.currency_code', 'USD')
        ->assertJsonPath('data.entries.0.effective_to', null)
        ->assertHeader('ETag', '"1"');

    expect(($this->rowsFor)())->toHaveCount(1);
});

it('leaves an unchanged price entirely alone', function (): void {
    // Re-submitting the same tariff must be a no-op on the history. This is
    // what stops a nightly importer manufacturing a supersession chain.
    $entry = [[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]];

    ($this->put)($entry, 0)->assertOk();

    $before = ($this->rowsFor)()[0];

    ($this->put)($entry, 1)->assertOk();

    $after = ($this->rowsFor)();

    expect($after)->toHaveCount(1)
        ->and((string) $after[0]->getKey())->toBe((string) $before->getKey())
        ->and($after[0]->effective_to)->toBeNull()
        ->and($after[0]->superseded_by_id)->toBeNull();

    $replaced = AuditLog::query()->where('action', 'catalogue.price_entries_replaced')->orderByDesc('occurred_at')->orderByDesc('id')->first();

    expect($replaced->metadata['unchanged_count'])->toBe(1)
        ->and($replaced->metadata['opened_count'])->toBe(0)
        ->and($replaced->metadata['closed_count'])->toBe(0);
});

it('leaves three rows and an intact chain after two price changes', function (): void {
    // The proof the whole design exists for. One pricing point, three
    // statements about it, and the two superseded ones still saying exactly
    // what they said when an order was taken against them.
    $point = fn (int $amount): array => [[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => $amount,
        'price_status' => 'confirmed',
    ]];

    ($this->put)($point(2200), 0)->assertOk();
    ($this->put)($point(2400), 1)->assertOk();
    ($this->put)($point(2600), 2)->assertOk();

    $rows = ($this->rowsFor)();

    expect($rows)->toHaveCount(3);

    [$original, $middle, $current] = $rows;

    // Amounts unchanged from the day each was written.
    expect($original->unit_amount_minor)->toBe(2200)
        ->and($middle->unit_amount_minor)->toBe(2400)
        ->and($current->unit_amount_minor)->toBe(2600);

    // Two closed, one standing.
    expect($original->effective_to)->not->toBeNull()
        ->and($middle->effective_to)->not->toBeNull()
        ->and($current->effective_to)->toBeNull();

    // And the chain runs forwards without a break.
    expect($original->superseded_by_id)->toBe((string) $middle->getKey())
        ->and($middle->superseded_by_id)->toBe((string) $current->getKey())
        ->and($current->superseded_by_id)->toBeNull();

    // A same-day change leaves a zero-length interval, which is honest: the
    // price never governed a whole day, and the record that somebody stated
    // it survives. The exclusive end is what keeps the day single-valued.
    expect($original->effective_to->toDateString())->toBe($original->effective_from->toDateString());
});

it('closes a withdrawn price without giving it a successor', function (): void {
    // "We stopped pricing this" is a different fact from "we now price it
    // differently", and the null pointer is how the history says so.
    $entry = [[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]];

    ($this->put)($entry, 0)->assertOk();
    ($this->put)([], 1)->assertOk()->assertJsonCount(0, 'data.entries');

    $rows = ($this->rowsFor)();

    expect($rows)->toHaveCount(1)
        ->and($rows[0]->effective_to)->not->toBeNull()
        ->and($rows[0]->superseded_by_id)->toBeNull()
        // Nothing is deleted, ever.
        ->and($rows[0]->unit_amount_minor)->toBe(2200);
});

it('supersedes a confirmed price when only its status changes', function (): void {
    // Confirmed → market_priced is a real change even though no number moved:
    // the article stopped having a standing price. Treating it as unchanged
    // would leave a stale amount governing.
    $submit = fn (string $status, ?int $amount): array => [array_filter([
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => $amount,
        'price_status' => $status,
    ], static fn (mixed $value): bool => $value !== null)];

    ($this->put)($submit('confirmed', 2200), 0)->assertOk();
    ($this->put)($submit('market_priced', null), 1)
        ->assertOk()
        ->assertJsonPath('data.entries.0.price_status', 'market_priced')
        ->assertJsonPath('data.entries.0.unit_amount_minor', null);

    $rows = ($this->rowsFor)();

    expect($rows)->toHaveCount(2)
        ->and($rows[0]->superseded_by_id)->toBe((string) $rows[1]->getKey());
});

it('treats each quantity tier as its own pricing point', function (): void {
    $entries = [
        [
            'catalogue_item_id' => (string) $this->product->item->getKey(),
            'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
            'unit_amount_minor' => 2200,
            'price_status' => 'confirmed',
        ],
        [
            'catalogue_item_id' => (string) $this->product->item->getKey(),
            'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
            'min_quantity' => 12,
            'unit_amount_minor' => 1900,
            'price_status' => 'confirmed',
        ],
    ];

    ($this->put)($entries, 0)->assertOk()->assertJsonCount(2, 'data.entries');

    // Changing one tier leaves the other untouched.
    $entries[1]['unit_amount_minor'] = 1850;

    ($this->put)($entries, 1)->assertOk();

    $rows = ($this->rowsFor)();

    expect($rows)->toHaveCount(3);

    $standing = PriceListItem::withoutTenancy()->where('price_list_id', $this->list->getKey())->openRows()->get();

    expect($standing)->toHaveCount(2)
        ->and($standing->firstWhere('min_quantity', null)->unit_amount_minor)->toBe(2200);
});

it('normalises a tier so one threshold is not three pricing points', function (): void {
    // `12`, `12.0` and `"12.0000"` are one tier. Without normalisation the
    // partial unique index would accept all three and a merchandiser would end
    // up with two prices for "a dozen or more".
    $submit = fn (mixed $tier): array => [[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'min_quantity' => $tier,
        'unit_amount_minor' => 1900,
        'price_status' => 'confirmed',
    ]];

    ($this->put)($submit(12), 0)->assertOk();
    ($this->put)($submit(12.0), 1)->assertOk();
    ($this->put)($submit('12.0000'), 2)->assertOk();

    expect(($this->rowsFor)())->toHaveCount(1);
});

it('refuses to state one pricing point twice in a single submission', function (): void {
    $entry = [
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ];

    ($this->put)([$entry, $entry + ['unit_amount_minor' => 2400]], 0)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('refuses an amount that contradicts its status, in both directions', function (): void {
    $base = [
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
    ];

    // A placeholder carrying a number.
    ($this->put)([$base + ['price_status' => 'placeholder', 'unit_amount_minor' => 2200]], 0)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // A confirmed price with no number.
    ($this->put)([$base + ['price_status' => 'confirmed']], 0)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // And zero is not a confirmed price.
    ($this->put)([$base + ['price_status' => 'confirmed', 'unit_amount_minor' => 0]], 0)
        ->assertStatus(422);

    expect(($this->rowsFor)())->toHaveCount(0);
});

it('refuses a status outside the three honest states', function (): void {
    ($this->put)([[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'price_status' => 'approximately',
        'unit_amount_minor' => 2200,
    ]], 0)->assertStatus(422);
});

it('lets the database refuse the confirmed-amount contradiction even when nothing validates it', function (): void {
    // The service explains the rule; the CHECK guarantees it. This is the
    // guarantee — a raw insert with no application code in the way — because
    // the importer, a backfill and whatever writes this table in three years
    // will not go through the service.
    $insertConfirmedWithoutAmount = fn () => DB::table('price_list_items')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->a->organisation->getKey(),
        'price_list_id' => $this->list->getKey(),
        'catalogue_item_id' => $this->product->item->getKey(),
        'unit_amount_minor' => null,
        'price_status' => 'confirmed',
        'effective_from' => now()->toDateString(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $insertPlaceholderWithAmount = fn () => DB::table('price_list_items')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->a->organisation->getKey(),
        'price_list_id' => $this->list->getKey(),
        'catalogue_item_id' => $this->product->item->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'placeholder',
        'effective_from' => now()->toDateString(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect($insertConfirmedWithoutAmount)->toThrow(QueryException::class);
    expect($insertPlaceholderWithAmount)->toThrow(QueryException::class);
});

it('lets the database refuse a second standing row for one pricing point', function (): void {
    // The partial unique index. It is why the diff has to close before it
    // opens, and it is what makes "the current price of this point" a
    // single-valued question rather than a convention.
    PricingWorld::price($this->list, $this->product->item, $this->product->variant, 2200);

    $duplicate = fn () => PricingWorld::price($this->list, $this->product->item, $this->product->variant, 2400);

    expect($duplicate)->toThrow(QueryException::class);
});

it('lets the same pricing point be closed any number of times', function (): void {
    // The partial index is deliberately partial: history is unconstrained.
    PricingWorld::price(
        $this->list, $this->product->item, $this->product->variant, 2200,
        from: now()->subMonths(2)->startOfDay()->toImmutable(),
        to: now()->subMonth()->startOfDay()->toImmutable(),
    );

    PricingWorld::price(
        $this->list, $this->product->item, $this->product->variant, 2400,
        from: now()->subMonth()->startOfDay()->toImmutable(),
        to: now()->startOfDay()->toImmutable(),
    );

    expect(($this->rowsFor)())->toHaveCount(2);
});

it('refuses to price an article that belongs to another kitchen', function (): void {
    $b = PricingWorld::kitchen('smuggler@kitchen.test');
    $theirs = PricingWorld::product($b);

    ($this->put)([[
        'catalogue_item_id' => (string) $theirs->item->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]], 0)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(($this->rowsFor)())->toHaveCount(0);
});

it('refuses a variant that does not belong to the item being priced', function (): void {
    $other = PricingWorld::product($this->a, 'Zaatar blend', 'pouch-100g');

    ($this->put)([[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $other->variant->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]], 0)->assertStatus(422);
});

it('serves the standing rows by default and the whole chain on request', function (): void {
    $point = fn (int $amount): array => [[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => $amount,
        'price_status' => 'confirmed',
    ]];

    ($this->put)($point(2200), 0)->assertOk();
    ($this->put)($point(2400), 1)->assertOk();

    $entries = '/api/v1/catalogue/price-lists/'.$this->list->getKey().'/entries';

    // The default is the current tariff, because a client that reads, edits
    // and puts back would otherwise resurrect closed prices.
    $this->getJson($entries, $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.unit_amount_minor', 2400)
        ->assertJsonPath('meta.include_history', false)
        ->assertJsonPath('meta.currency_code', 'USD');

    // History walks newest-first: a history is read backwards from the most
    // recent change, not paged to the end to find last week's price.
    $this->getJson($entries.'?include_history=1', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.unit_amount_minor', 2400)
        ->assertJsonPath('data.1.unit_amount_minor', 2200)
        ->assertJsonPath('data.1.superseded_by_id', $this->getJson($entries, $this->headers)->json('data.0.id'))
        ->assertJsonPath('meta.include_history', true);

    // `include_history=0` means no, not "you mentioned it".
    $this->getJson($entries.'?include_history=0', $this->headers)->assertOk()->assertJsonCount(1, 'data');
});

it('serves placeholder rows to the admin surface with their status and no amount', function (): void {
    // The admin surface is exactly where the unpriced rows must be visible:
    // the person whose job is to price them has to see which ones they are.
    $meal = PricingWorld::meal($this->a);

    ($this->put)([[
        'catalogue_item_id' => (string) $meal->getKey(),
        'price_status' => 'placeholder',
    ]], 0)->assertOk();

    $this->getJson('/api/v1/catalogue/price-lists/'.$this->list->getKey().'/entries', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.price_status', 'placeholder')
        ->assertJsonPath('data.0.unit_amount_minor', null)
        ->assertJsonPath('meta.entry_counts.open', 1)
        ->assertJsonPath('meta.entry_counts.confirmed', 0);
});

it('excludes placeholder and market rows from the scope M1 will project through', function (): void {
    // **Pinned for the M1 leak sweep.** `confirmedOpenRows()` is the only
    // scope the public projection may build on, and its guarantee is that an
    // unpriced row cannot reach a customer even by accident. A denylist over a
    // shape that already contains the wrong rows is one refactor away from
    // leaking; a scope that never selects them cannot leak by omission.
    $meal = PricingWorld::meal($this->a);
    $other = PricingWorld::product($this->a, 'Zaatar blend', 'pouch-100g');

    $confirmed = PricingWorld::price($this->list, $this->product->item, $this->product->variant, 2200);
    PricingWorld::price($this->list, $meal, null, null, null, PriceStatus::Placeholder);
    PricingWorld::price($this->list, $other->item, $other->variant, null, null, PriceStatus::MarketPriced);

    // A closed confirmed row is excluded too: it was a real price, and it is
    // not the current one.
    PricingWorld::price(
        $this->list, $other->item, null, 1000,
        from: now()->subMonth()->startOfDay()->toImmutable(),
        to: now()->startOfDay()->toImmutable(),
    );

    $projected = PriceListItem::withoutTenancy()
        ->where('price_list_id', $this->list->getKey())
        ->confirmedOpenRows()
        ->get();

    expect($projected->modelKeys())->toBe([$confirmed->getKey()])
        ->and($projected->every(static fn (PriceListItem $row): bool => $row->unit_amount_minor !== null))->toBeTrue()
        // Four rows in the table, one of them projectable.
        ->and(PriceListItem::withoutTenancy()->where('price_list_id', $this->list->getKey())->count())->toBe(4);
});

it('versions the entries against the price list rather than against a row', function (): void {
    // A tariff's rows are one document even though they live in three tables.
    // Two merchandisers repricing at once is the race this catches; per-row
    // validators would let both succeed and leave a tariff that is half of
    // each.
    $entry = [[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]];

    ($this->put)($entry, 0)->assertOk();

    ($this->put)($entry, 0)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $this->putJson(
        '/api/v1/catalogue/price-lists/'.$this->list->getKey().'/entries',
        ['entries' => $entry],
        $this->headers,
    )->assertStatus(428);
});

it('refuses to write entries into an archived list', function (): void {
    $this->postJson('/api/v1/catalogue/price-lists/'.$this->list->getKey().'/archive', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk();

    ($this->put)([[
        'catalogue_item_id' => (string) $this->product->item->getKey(),
        'unit_amount_minor' => 2200,
        'price_status' => 'confirmed',
    ]], 1)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('records the diff counts in the audit trail', function (): void {
    $meal = PricingWorld::meal($this->a);

    ($this->put)([
        [
            'catalogue_item_id' => (string) $this->product->item->getKey(),
            'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
            'unit_amount_minor' => 2200,
            'price_status' => 'confirmed',
        ],
        ['catalogue_item_id' => (string) $meal->getKey(), 'price_status' => 'placeholder'],
    ], 0)->assertOk();

    // Second pass: one unchanged, one repriced, and the meal withdrawn.
    ($this->put)([
        [
            'catalogue_item_id' => (string) $this->product->item->getKey(),
            'catalogue_item_variant_id' => (string) $this->product->variant->getKey(),
            'unit_amount_minor' => 2400,
            'price_status' => 'confirmed',
        ],
    ], 1)->assertOk();

    $latest = AuditLog::query()->where('action', 'catalogue.price_entries_replaced')->orderByDesc('occurred_at')->orderByDesc('id')->first();

    expect($latest->metadata['submitted_count'])->toBe(1)
        ->and($latest->metadata['opened_count'])->toBe(1)
        // The repriced point and the withdrawn meal.
        ->and($latest->metadata['closed_count'])->toBe(2)
        ->and($latest->metadata['unchanged_count'])->toBe(0)
        ->and($latest->metadata['currency'])->toBe('USD');
});
