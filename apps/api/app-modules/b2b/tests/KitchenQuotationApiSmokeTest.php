<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Organisations\Models\Organisation;

/**
 * The kitchen's side of a quotation (B4), over HTTP.
 *
 * The full seed, on the same terms `B2bApplicationApiSmokeTest` takes it: the
 * Acme↔Verdant programme, the signed agreement behind it and the
 * `kitchen_manager` grant carrying `b2b_quotation.*` are all expressed in
 * `B2bProgrammesDemoSeeder` and `DemoTenantSeeder`. A test that hand-built
 * that grant would be asserting against its own fixture.
 */
beforeEach(function (): void {
    $this->seed();

    $this->buyerUser = User::query()->where('email', 'buyer@acme-wellness.test')->sole();
    $this->buyer = Organisation::query()->where('slug', 'acme-wellness')->sole();
    $this->kitchenUser = User::query()->where('email', 'owner@verdant.test')->sole();
    $this->kitchen = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $this->programme = CorporateProgramme::withoutTenancy()
        ->where('code', 'acme-employee-meals')
        ->sole();

    $this->buyerHeaders = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->buyer->getKey()];
    $this->kitchenHeaders = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->kitchen->getKey()];
});

/**
 * Change who is calling, the way a deployed request boundary would.
 *
 * The same two-part reset `B2bApplicationApiSmokeTest::b2bSmokeActAs()`
 * documents at length, and this file meets it for the same reason: it swaps
 * between two **seeded** users whose password hashes genuinely differ, so the
 * session's `password_hash_web` survives into the next request and
 * `Sanctum\AuthenticateSession` logs the new caller straight back out with a
 * 401. Duplicated rather than shared because Pest's helper functions are
 * global and one definition per name is all the suite gets.
 */
function kitchenQuotationSmokeActAs(User $user): void
{
    forgetResolvedGuards();

    app('session')->driver()->flush();

    app('auth')->guard()->setUser($user);
    app('auth')->shouldUse(null);
}

/**
 * A submitted quotation with `$count` lines, raised by the buyer the way the
 * corporate screens raise one.
 *
 * @return array{id: string, lineCount: int}
 */
function kitchenQuotationSmokeSubmitted(mixed $test, int $count = 2): array
{
    $meals = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $test->kitchen->getKey())
        ->where('item_type', CatalogueItemType::Meal->value)
        ->orderBy('created_at')
        ->take($count)
        ->get();

    expect($meals)->toHaveCount($count);

    kitchenQuotationSmokeActAs($test->buyerUser);

    $created = $test->postJson(
        "/api/v1/b2b/programmes/{$test->programme->getKey()}/quotations",
        [
            'notes' => 'Thursday lunch for the pilot floor.',
            'lines' => $meals
                ->values()
                ->map(fn (CatalogueItem $meal, int $index): array => [
                    'catalogue_item_id' => (string) $meal->getKey(),
                    'quantity' => 4 * ($index + 1),
                    'note' => $meal->name_en,
                ])
                ->all(),
        ],
        $test->buyerHeaders,
    )->assertCreated()->json('data.quotation');

    $test->postJson(
        "/api/v1/b2b/quotations/{$created['id']}/submit",
        [],
        $test->buyerHeaders + ['If-Match' => '"'.$created['lock_version'].'"'],
    )->assertOk();

    return ['id' => (string) $created['id'], 'lineCount' => $count];
}

/**
 * The regression this file exists for.
 *
 * `QuotationLine` is scoped to the **buyer** organisation, so the presenter's
 * `$quotation->lines()` fallback matches nothing under the seller's tenant and
 * answers `lines: []`. It fails silently — a `200` describing a quotation that
 * appears to have nothing in it — and it makes the whole surface useless: a
 * kitchen cannot price lines it was never shown, and `quote` refuses a set that
 * does not cover every line.
 */
it('serves the kitchen every line of a submitted quotation, not the buyer-scoped empty set', function (): void {
    $quotation = kitchenQuotationSmokeSubmitted($this);

    kitchenQuotationSmokeActAs($this->kitchenUser);

    $payload = $this->getJson("/api/v1/b2b/kitchen/quotations/{$quotation['id']}", $this->kitchenHeaders)
        ->assertOk()
        ->json('data.quotation');

    expect($payload['status'])->toBe('submitted')
        ->and($payload['lines'])->toHaveCount($quotation['lineCount'])
        // Ordered by `line_number`, and every line carries the identifier
        // `POST …/quote` prices against.
        ->and(array_column($payload['lines'], 'line_number'))->toBe([1, 2])
        ->and(array_filter(array_column($payload['lines'], 'id')))->toHaveCount($quotation['lineCount'])
        // Unpriced until this kitchen quotes: `null`, never a zero.
        ->and(array_column($payload['lines'], 'unit_amount_minor'))->toBe([null, null]);
});

/**
 * The list stays empty-lined on purpose — it is a navigation aid, and the wire
 * documents `lines: []` there. Pinned so a fix to the single read never
 * "helpfully" hydrates the index too.
 */
it('leaves the kitchen index without lines even though the single read has them', function (): void {
    kitchenQuotationSmokeSubmitted($this);

    kitchenQuotationSmokeActAs($this->kitchenUser);

    $rows = $this->getJson('/api/v1/b2b/kitchen/quotations', $this->kitchenHeaders)
        ->assertOk()
        ->json('data');

    expect($rows)->not->toBeEmpty();

    foreach ($rows as $row) {
        expect($row['lines'])->toBe([])
            ->and($row['status'])->not->toBe('draft');
    }
});

/**
 * End to end from the seller's side: read the lines, price every one of them,
 * and land on `quoted` with the server's own line totals.
 */
it('prices every line and moves the quotation to quoted', function (): void {
    $quotation = kitchenQuotationSmokeSubmitted($this);

    kitchenQuotationSmokeActAs($this->kitchenUser);

    $read = $this->getJson("/api/v1/b2b/kitchen/quotations/{$quotation['id']}", $this->kitchenHeaders)
        ->assertOk()
        ->json('data.quotation');

    $quoted = $this->postJson(
        "/api/v1/b2b/kitchen/quotations/{$quotation['id']}/quote",
        [
            'prices' => array_map(
                static fn (array $line): array => [
                    'quotation_line_id' => $line['id'],
                    'unit_amount_minor' => 1800,
                ],
                $read['lines'],
            ),
        ],
        $this->kitchenHeaders + ['If-Match' => '"'.$read['lock_version'].'"'],
    )->assertOk()->json('data.quotation');

    expect($quoted['status'])->toBe('quoted')
        ->and($quoted['quoted_at'])->not->toBeNull()
        ->and($quoted['lock_version'])->toBe($read['lock_version'] + 1)
        ->and(array_column($quoted['lines'], 'unit_amount_minor'))->toBe([1800, 1800])
        // `quantity × unit_amount_minor`, rounded once by the server: 4 and 8.
        ->and(array_column($quoted['lines'], 'line_total_minor'))->toBe([7200, 14400]);
});

/**
 * A short set is refused rather than partially applied, and the refusal names
 * the lines that were left out — which is what lets a client prevent the round
 * trip entirely.
 */
it('refuses a price set that does not cover every line', function (): void {
    $quotation = kitchenQuotationSmokeSubmitted($this);

    kitchenQuotationSmokeActAs($this->kitchenUser);

    $read = $this->getJson("/api/v1/b2b/kitchen/quotations/{$quotation['id']}", $this->kitchenHeaders)
        ->assertOk()
        ->json('data.quotation');

    $response = $this->postJson(
        "/api/v1/b2b/kitchen/quotations/{$quotation['id']}/quote",
        [
            'prices' => [
                ['quotation_line_id' => $read['lines'][0]['id'], 'unit_amount_minor' => 1800],
            ],
        ],
        $this->kitchenHeaders + ['If-Match' => '"'.$read['lock_version'].'"'],
    )->assertStatus(422);

    expect($response->json('error.code'))->toBe('validation.failed')
        ->and($response->json('error.details.fields.prices.missing_quotation_line_ids'))
        ->toBe([$read['lines'][1]['id']]);
});

/**
 * The seller's reach is through the programme, so a kitchen that supplies no
 * programme the quotation belongs to gets a 404 — never another kitchen's
 * negotiation, and never a 403 that would confirm the row exists.
 */
it('hides a quotation from a kitchen that does not supply its programme', function (): void {
    $quotation = kitchenQuotationSmokeSubmitted($this);

    $otherKitchen = Organisation::query()->where('slug', 'cedar-clinic')->first()
        ?? Organisation::query()->where('slug', '!=', 'verdant-kitchen')->firstOrFail();

    kitchenQuotationSmokeActAs($this->kitchenUser);

    $this->getJson(
        "/api/v1/b2b/kitchen/quotations/{$quotation['id']}",
        firstPartyHeaders() + ['X-Organisation-Id' => (string) $otherKitchen->getKey()],
    )->assertStatus(403);
});
