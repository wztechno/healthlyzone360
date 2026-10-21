<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\OrderDesk\Services\CalendarComposition;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Mail\NoticeMessage;
use Illuminate\Support\Facades\Mail;

/**
 * The whole B2B workflow end to end (2026-10-20): the buyer asks, the kitchen
 * prices, the buyer accepts — and the acceptance is an order on the kitchen's
 * calendar at the quoted price, not a status nobody downstream reads.
 */
beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = B2bCheckoutWorld::dualAgreement();
    $this->buyer = $this->world['buyers']['acme'];
    $sellerId = (string) $this->world['seller']->organisation->getKey();

    $zone = DeliveryZone::withoutTenancy()->where('organisation_id', $sellerId)->sole();
    CheckoutWorld::window($zone, 'midday');

    $this->programme = CorporateProgramme::withoutTenancy()->create([
        'organisation_id' => $this->buyer['organisation']->getKey(),
        'code' => 'acme-staff-meals',
        'kitchen_organisation_id' => $sellerId,
        'b2b_agreement_id' => $this->buyer['agreement']->getKey(),
        'name_en' => 'Staff meals',
        'name_ar' => 'وجبات الموظفين',
        'status' => 'active',
        'lock_version' => 0,
        'created_by' => $this->buyer['user']->getKey(),
    ]);

    $this->deliveryDate = CarbonImmutable::today()->addDays(3)->toDateString();

    // The kitchen's user may price quotations, so it is who the kitchen's notices go to.
    RolePermission::factory()->create([
        'organisation_id' => $sellerId,
        'role_id' => $this->world['seller']->role->getKey(),
        'permission_id' => Permission::query()->where('code', 'b2b_quotation.quote_organisation')->sole()->getKey(),
    ]);

    Mail::fake();
    // Notices are deferred past the response; run them inline so they can be asserted.
    $this->withoutDefer();
});

/**
 * A quotation the buyer requested and the kitchen priced at `$unitMinor`.
 */
function quotedForAcceptance(mixed $test, int $unitMinor = 1500, bool $recurring = true): Quotation
{
    $test->actingAs($test->buyer['user']);

    $created = $test->postJson("/api/v1/b2b/programmes/{$test->programme->getKey()}/quotations", [
        'notes' => 'Reception, before noon.',
        'requested_delivery_date' => $test->deliveryDate,
        'recurring' => $recurring,
        'contact_name' => 'Layla Haddad',
        'contact_email' => 'layla@acme.test',
        'lines' => [['catalogue_item_id' => (string) $test->world['meal']->getKey(), 'quantity' => 5]],
    ], $test->buyer['headers'])
        ->assertCreated()
        ->assertJsonPath('data.quotation.requested_delivery_date', $test->deliveryDate)
        ->assertJsonPath('data.quotation.recurring', $recurring)
        ->assertJsonPath('data.quotation.contact_name', 'Layla Haddad')
        ->assertJsonPath('data.quotation.contact_email', 'layla@acme.test')
        // The article's name rides on the line, so neither side reads an identifier.
        ->assertJsonPath('data.quotation.lines.0.item_name_en', $test->world['meal']->name_en)
        ->json('data.quotation');

    $test->postJson("/api/v1/b2b/quotations/{$created['id']}/submit", [], $test->buyer['headers'] + ['If-Match' => '"'.$created['lock_version'].'"'])
        ->assertOk();

    $quotation = Quotation::withoutTenancy()->whereKey($created['id'])->sole();
    $line = QuotationLine::withoutTenancy()->where('quotation_id', $quotation->getKey())->sole();

    return app(QuotationService::class)->quote(
        $quotation,
        $test->world['seller']->user,
        [['quotation_line_id' => (string) $line->getKey(), 'unit_amount_minor' => $unitMinor]],
        $quotation->lock_version,
    );
}

/**
 * @return array<string, string>
 */
function acceptBody(mixed $test, string $window = 'midday'): array
{
    return [
        'customer_address_id' => (string) $test->buyer['address']->getKey(),
        'requested_date' => $test->deliveryDate,
        'delivery_window_code' => $window,
    ];
}

it('places the order at the quoted price when the buyer accepts, and the kitchen calendar shows it', function (): void {
    $quoted = quotedForAcceptance($this, unitMinor: 1500);

    $payload = $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        acceptBody($this),
        $this->buyer['headers'] + ['If-Match' => '"'.$quoted->lock_version.'"'],
    )
        ->assertOk()
        ->assertJsonPath('data.quotation.status', 'accepted')
        ->json('data.quotation');

    expect($payload['order_id'])->not->toBeNull()
        ->and($payload['order_number'])->not->toBeNull();

    $order = Order::query()->whereKey($payload['order_id'])->sole();
    $line = OrderLine::query()->where('order_id', $order->getKey())->sole();

    // The seller's order, for the day and window the buyer chose, charged at
    // the quote (1500) rather than the agreement tariff (1800).
    expect($order->organisation_id)->toBe((string) $this->world['seller']->organisation->getKey())
        ->and($order->requested_delivery_date?->toDateString())->toBe($this->deliveryDate)
        ->and($order->delivery_window_code)->toBe('midday')
        ->and($order->b2b_agreement_id)->toBe((string) $this->buyer['agreement']->getKey())
        ->and($line->unit_price_minor)->toBe(1500)
        ->and($line->price_source)->toBe('quotation')
        ->and($order->subtotal_minor)->toBe(7500);

    $days = app(CalendarComposition::class)->forOrganisation(
        (string) $this->world['seller']->organisation->getKey(),
        CarbonImmutable::parse($this->deliveryDate),
        CarbonImmutable::parse($this->deliveryDate),
    );

    expect($days)->toHaveCount(1)
        ->and($days[0]['counts']['order'])->toBe(1);
});

it('refuses an acceptance against a version the kitchen has since changed, and places nothing', function (): void {
    $quoted = quotedForAcceptance($this);

    $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        acceptBody($this),
        $this->buyer['headers'] + ['If-Match' => '"'.($quoted->lock_version - 1).'"'],
    )->assertStatus(409);

    expect(Order::query()->count())->toBe(0)
        ->and(Quotation::withoutTenancy()->whereKey($quoted->getKey())->sole()->status->value)->toBe('quoted');
});

it('leaves the quotation quoted when the order cannot be placed, and says why', function (): void {
    $quoted = quotedForAcceptance($this);

    $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        acceptBody($this, window: 'breakfast'),
        $this->buyer['headers'] + ['If-Match' => '"'.$quoted->lock_version.'"'],
    )
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.placement_refused')
        ->assertJsonPath('error.details.reasons.0.reason', 'window_not_offered');

    expect(Order::query()->count())->toBe(0)
        ->and(Quotation::withoutTenancy()->whereKey($quoted->getKey())->sole()->status->value)->toBe('quoted');
});

it('refuses an address that is not one of the buyers', function (): void {
    $quoted = quotedForAcceptance($this);

    $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        ['customer_address_id' => (string) $this->world['buyers']['beta']['address']->getKey()] + acceptBody($this),
        $this->buyer['headers'] + ['If-Match' => '"'.$quoted->lock_version.'"'],
    )
        ->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed');

    expect(Order::query()->count())->toBe(0);
});

it('places one order a week for a repeating quotation, all at the quoted price', function (): void {
    $quoted = quotedForAcceptance($this, unitMinor: 1500);

    $payload = $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        acceptBody($this) + ['repeat_weeks' => 3],
        $this->buyer['headers'] + ['If-Match' => '"'.$quoted->lock_version.'"'],
    )->assertOk()->json('data.quotation');

    $first = CarbonImmutable::parse($this->deliveryDate);

    expect($payload['orders'])->toHaveCount(3)
        ->and(array_column($payload['orders'], 'delivery_date'))->toBe([
            $first->toDateString(),
            $first->addWeek()->toDateString(),
            $first->addWeeks(2)->toDateString(),
        ])
        ->and($payload['order_id'])->toBe($payload['orders'][0]['order_id'])
        ->and(Order::query()->count())->toBe(3)
        ->and(OrderLine::query()->pluck('unit_price_minor')->unique()->values()->all())->toBe([1500]);
});

it('refuses a weekly run on a quotation that was for one delivery', function (): void {
    $quoted = quotedForAcceptance($this, recurring: false);

    $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        acceptBody($this) + ['repeat_weeks' => 4],
        $this->buyer['headers'] + ['If-Match' => '"'.$quoted->lock_version.'"'],
    )->assertUnprocessable()->assertJsonPath('error.code', 'validation.failed');

    expect(Order::query()->count())->toBe(0);
});

it('mails the kitchen on a request and an acceptance, and the buyer when it is priced', function (): void {
    $quoted = quotedForAcceptance($this);

    $this->postJson(
        "/api/v1/b2b/quotations/{$quoted->getKey()}/accept",
        acceptBody($this),
        $this->buyer['headers'] + ['If-Match' => '"'.$quoted->lock_version.'"'],
    )->assertOk();

    $kitchen = $this->world['seller']->user->email;

    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'quotation_submitted' && $mail->hasTo($kitchen));
    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'quotation_quoted' && $mail->hasTo('layla@acme.test'));
    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'quotation_accepted'
        && $mail->hasTo($kitchen)
        && str_contains($mail->heading, $quoted->reference));
});

it('renders the notice it queues, in both languages', function (): void {
    foreach (['en', 'ar'] as $locale) {
        $html = (new NoticeMessage('quotation_quoted', 'Heading', ['A line.'], 'Open', 'https://example.test/x', $locale))->render();

        expect($html)->toContain('Heading')
            ->and($html)->toContain('https://example.test/x')
            ->and($html)->toContain($locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
    }
});
