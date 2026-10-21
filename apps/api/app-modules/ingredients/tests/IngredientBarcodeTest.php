<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientBarcode;
use Healthy360\Ingredients\Services\IngredientBarcodeService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Support\Str;
use Tests\SeedDatabaseOnce;

/*
|--------------------------------------------------------------------------
| Ingredient barcodes over HTTP (docs/requirements/ingredient-barcodes-plan.md)
|--------------------------------------------------------------------------
|
| A code means exactly one ingredient in a kitchen; a kitchen code's number is
| never issued twice; a fork leaves the codes with the stock; a receiver links
| producer's codes and nothing more; and one kitchen never sees another's.
|
*/

const BARCODE_EAN = '4006381333931';

function barcodeKitchenOrganisation(): Organisation
{
    return Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);
}

/**
 * A member of `$organisation` whose one role holds exactly these codes.
 *
 * @param  list<string>  $permissions
 */
function barcodeMember(Organisation $organisation, array $permissions): User
{
    $user = User::factory()->create(['email' => Str::lower(Str::random(10)).'@kitchen.test']);
    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => $user->getKey(),
    ]);
    $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

    foreach ($permissions as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return $user;
}

/**
 * @return array<string, string>
 */
function barcodeHeaders(Organisation $organisation): array
{
    return firstPartyHeaders() + ['X-Organisation-Id' => (string) $organisation->getKey()];
}

function barcodeIngredient(?Organisation $organisation, string $unit = 'kg'): Ingredient
{
    return Ingredient::factory()->create([
        'organisation_id' => $organisation?->getKey(),
        'default_unit_id' => MeasurementUnit::query()->where('code', $unit)->sole()->getKey(),
    ]);
}

function barcodesUrl(Ingredient $ingredient): string
{
    return '/api/v1/catalogue/ingredients/'.$ingredient->getKey().'/barcodes';
}

pest()->use(SeedDatabaseOnce::class);

beforeEach(function (): void {
    $this->kitchen = barcodeKitchenOrganisation();
    $this->chef = barcodeMember($this->kitchen, [
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
        'inventory.view_organisation',
    ]);
    $this->receiver = barcodeMember($this->kitchen, ['inventory.view_organisation', 'inventory.manage_organisation']);
    $this->headers = barcodeHeaders($this->kitchen);
    $this->flour = barcodeIngredient($this->kitchen);
});

it('links a producer\'s code in the one normal form, lists it and removes it', function (): void {
    $this->actingAs($this->chef);

    $barcode = $this->postJson(barcodesUrl($this->flour), [
        'origin' => 'supplier',
        'code' => ']E0'.BARCODE_EAN,
        'pack_quantity' => 5,
        'pack_unit_code' => 'kg',
    ], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.barcode.gtin', '0'.BARCODE_EAN)
        ->assertJsonPath('data.barcode.origin', 'supplier')
        ->assertJsonPath('data.barcode.pack_quantity', '5.0000')
        ->assertJsonPath('data.barcode.pack_unit_code', 'kg')
        ->json('data.barcode');

    $this->getJson(barcodesUrl($this->flour), $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.id', $barcode['id']);

    // The audit says gtin, which the recorder does not redact.
    $audit = AuditLog::query()->where('action', 'catalogue.ingredient_barcode_linked')->sole();
    expect($audit->metadata)->toMatchArray(['gtin' => '0'.BARCODE_EAN, 'origin' => 'supplier', 'via' => 'catalogue']);

    $this->deleteJson(barcodesUrl($this->flour).'/'.$barcode['id'], [], $this->headers)->assertNoContent();
    $this->getJson(barcodesUrl($this->flour), $this->headers)->assertJsonPath('meta.count', 0);
    expect(AuditLog::query()->where('action', 'catalogue.ingredient_barcode_removed')->count())->toBe(1);
});

it('refuses a code another ingredient holds, naming the holder', function (): void {
    $this->actingAs($this->chef);
    $rice = barcodeIngredient($this->kitchen);

    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => BARCODE_EAN], $this->headers)->assertCreated();

    $this->postJson(barcodesUrl($rice), ['origin' => 'supplier', 'code' => '0'.BARCODE_EAN], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'barcode.taken')
        ->assertJsonPath('error.details.ingredient_id', (string) $this->flour->getKey())
        ->assertJsonPath('error.details.name_en', $this->flour->name_en);
});

it('refuses each kind of unusable code with its reason', function (string $code, string $reason): void {
    $this->actingAs($this->chef);

    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => $code], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'barcode.invalid')
        ->assertJsonPath('error.details.reason', $reason);
})->with([
    'a wrong check digit' => ['4006381333932', 'check_digit'],
    'garbage' => ['not a barcode', 'unreadable'],
    'a weighed-item label' => ['2012345678903', 'variable_measure'],
    'a case code for a variable-measure item' => ['91234567890121', 'variable_measure'],
    'the kitchen range' => ['0400000000015', 'reserved'],
    'a lot with no GTIN' => ['(10)ABC123', 'not_a_product_code'],
]);

it('takes a pack size in the ingredient\'s unit or one that converts to it, never a container', function (): void {
    $this->actingAs($this->chef);

    // No unit given: the ingredient's own.
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => BARCODE_EAN, 'pack_quantity' => '2.5'], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.barcode.pack_unit_code', 'kg');

    // Grams convert to kilograms, and are stored as entered.
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => '96385074', 'pack_quantity' => 500, 'pack_unit_code' => 'g'], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.barcode.pack_unit_code', 'g');

    // Finer than the column's four places is refused, not rounded to a zero the CHECK would reject.
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => '036000291452', 'pack_quantity' => '0.00001'], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    foreach (['l', 'bag'] as $unit) {
        $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => '036000291452', 'pack_quantity' => 1, 'pack_unit_code' => $unit], $this->headers)
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'validation.failed');
    }
});

it('makes one kitchen code per ingredient, idempotently', function (): void {
    $this->actingAs($this->chef);

    $first = $this->postJson(barcodesUrl($this->flour), ['origin' => 'system'], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.barcode.gtin', '00400000000015')
        ->assertJsonPath('data.barcode.origin', 'system')
        ->json('data.barcode.id');

    $this->postJson(barcodesUrl($this->flour), ['origin' => 'system'], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.barcode.id', $first);

    expect(IngredientBarcode::withoutTenancy()->count())->toBe(1);
});

it('never reissues a kitchen code\'s number, even after the highest is deleted', function (): void {
    $this->actingAs($this->chef);

    $first = $this->postJson(barcodesUrl($this->flour), ['origin' => 'system'], $this->headers)->json('data.barcode');
    $this->deleteJson(barcodesUrl($this->flour).'/'.$first['id'], [], $this->headers)->assertNoContent();

    $second = $this->postJson(barcodesUrl($this->flour), ['origin' => 'system'], $this->headers)
        ->assertCreated()
        ->json('data.barcode.gtin');

    expect($first['gtin'])->toBe('00400000000015')
        ->and($second)->toBe(IngredientBarcodeService::kitchenGtin(2))
        ->and($second)->toBe('00400000000022');

    // The deleted label still scans as a kitchen code, now with no link.
    $this->getJson('/api/v1/catalogue/ingredient-barcodes/scan?code=0400000000015', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.scan.origin_hint', 'system')
        ->assertJsonPath('data.scan.link', null);
});

it('links codes to a platform ingredient as the kitchen\'s own rows, and leaves them there on fork', function (): void {
    $this->actingAs($this->chef);
    $platform = barcodeIngredient(null);

    $this->postJson(barcodesUrl($platform), ['origin' => 'supplier', 'code' => BARCODE_EAN], $this->headers)->assertCreated();
    expect(IngredientBarcode::withoutTenancy()->sole()->organisation_id)->toBe((string) $this->kitchen->getKey());

    $forkId = $this->postJson('/api/v1/catalogue/ingredients/'.$platform->getKey().'/fork', [], $this->headers)
        ->assertCreated()
        ->json('data.ingredient.id');

    $this->getJson(barcodesUrl($platform), $this->headers)->assertJsonPath('meta.count', 1);
    $this->getJson('/api/v1/catalogue/ingredients/'.$forkId.'/barcodes', $this->headers)->assertJsonPath('meta.count', 0);
    $this->getJson('/api/v1/catalogue/ingredient-barcodes/scan?code='.BARCODE_EAN, $this->headers)
        ->assertJsonPath('data.scan.link.ingredient_id', (string) $platform->getKey());
});

it('lets a receiver link producer\'s codes at the dock, and nothing more', function (): void {
    $this->actingAs($this->receiver);
    $url = '/api/v1/catalogue/inventory/ingredient-barcodes';

    $this->postJson($url, ['ingredient_id' => $this->flour->getKey(), 'code' => BARCODE_EAN, 'pack_quantity' => 25], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.barcode.origin', 'supplier');

    $this->postJson($url, ['ingredient_id' => $this->flour->getKey(), 'origin' => 'system'], $this->headers)
        ->assertStatus(422);

    $id = IngredientBarcode::withoutTenancy()->sole()->getKey();
    $this->deleteJson(barcodesUrl($this->flour).'/'.$id, [], $this->headers)->assertForbidden();
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'system'], $this->headers)->assertForbidden();

    expect(AuditLog::query()->where('action', 'catalogue.ingredient_barcode_linked')->sole()->metadata)
        ->toMatchArray(['gtin' => '0'.BARCODE_EAN, 'via' => 'receiving']);
});

it('keeps one kitchen\'s codes out of another\'s reach', function (): void {
    $this->actingAs($this->chef);
    $platform = barcodeIngredient(null);
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => BARCODE_EAN], $this->headers)->assertCreated();
    $this->postJson(barcodesUrl($platform), ['origin' => 'system'], $this->headers)->assertCreated();

    $other = barcodeKitchenOrganisation();
    $stranger = barcodeMember($other, ['catalogue.view_organisation', 'catalogue.manage_organisation', 'inventory.view_organisation']);
    $theirHeaders = barcodeHeaders($other);
    $this->actingAs($stranger);

    // Their ingredient is invisible, the shared platform row shows none of ours,
    // our code means nothing to them, and the code is free for their own use.
    $this->getJson(barcodesUrl($this->flour), $theirHeaders)->assertNotFound();
    $this->getJson(barcodesUrl($platform), $theirHeaders)->assertJsonPath('meta.count', 0);
    $this->getJson('/api/v1/catalogue/ingredient-barcodes/scan?code='.BARCODE_EAN, $theirHeaders)
        ->assertOk()
        ->assertJsonPath('data.scan.link', null);
    $this->getJson('/api/v1/catalogue/ingredients?query='.BARCODE_EAN, $theirHeaders)
        ->assertJsonMissing(['id' => (string) $this->flour->getKey()]);

    // Nor can they link to our ingredient at their dock, or remove our code.
    $receiver = barcodeMember($other, ['inventory.view_organisation', 'inventory.manage_organisation']);
    $this->actingAs($receiver);
    $this->postJson('/api/v1/catalogue/inventory/ingredient-barcodes', ['ingredient_id' => $this->flour->getKey(), 'code' => '96385074'], $theirHeaders)
        ->assertNotFound();
    $this->actingAs($stranger);
    $ours = IngredientBarcode::withoutTenancy()->where('organisation_id', $this->kitchen->getKey())->where('origin', 'supplier')->sole();
    $this->deleteJson(barcodesUrl($this->flour).'/'.$ours->getKey(), [], $theirHeaders)->assertNotFound();
    $this->deleteJson(barcodesUrl($platform).'/'.$ours->getKey(), [], $theirHeaders)->assertNotFound();

    $theirs = barcodeIngredient($other);
    $this->postJson(barcodesUrl($theirs), ['origin' => 'supplier', 'code' => BARCODE_EAN], $theirHeaders)->assertCreated();
    // Their counter is their own: their first kitchen code is the first number too.
    $this->postJson(barcodesUrl($theirs), ['origin' => 'system'], $theirHeaders)
        ->assertJsonPath('data.barcode.gtin', '00400000000015');
});

it('finds an ingredient by its code in the list search, in any form a scanner sends', function (string $query): void {
    $this->actingAs($this->chef);
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => BARCODE_EAN], $this->headers)->assertCreated();
    barcodeIngredient($this->kitchen);

    $ids = collect($this->getJson('/api/v1/catalogue/ingredients?query='.urlencode($query), $this->headers)->assertOk()->json('data'))
        ->pluck('id')
        ->all();

    expect($ids)->toBe([(string) $this->flour->getKey()]);
})->with([
    'the printed digits' => [BARCODE_EAN],
    'with an AIM prefix' => [']E0'.BARCODE_EAN],
    'as a GS1 element string' => ['(01)0'.BARCODE_EAN.'(10)LOT1'],
]);

it('reads a scan\'s GTIN, lot and dates, and resolves its link', function (): void {
    $this->actingAs($this->chef);
    $this->postJson(barcodesUrl($this->flour), ['origin' => 'supplier', 'code' => BARCODE_EAN, 'pack_quantity' => 5], $this->headers)->assertCreated();
    $scan = fn (string $code): array => $this->getJson('/api/v1/catalogue/ingredient-barcodes/scan?code='.urlencode($code), $this->headers)
        ->assertOk()
        ->json('data.scan');

    expect($scan('(01)0'.BARCODE_EAN.'(15)261130(17)261231(10)LOT42'))->toMatchArray([
        'gtin' => '0'.BARCODE_EAN,
        'supplier_lot' => 'LOT42',
        'best_before_on' => '2026-11-30',
        'expires_on' => '2026-12-31',
        'boundary_verified' => true,
        'origin_hint' => 'supplier',
        'link' => [
            'id' => IngredientBarcode::withoutTenancy()->sole()->getKey(),
            'ingredient_id' => (string) $this->flour->getKey(),
            'name_en' => $this->flour->name_en,
            'name_ar' => $this->flour->name_ar,
            'origin' => 'supplier',
            'pack_quantity' => '5.0000',
            'pack_unit_code' => 'kg',
        ],
    ]);

    // No separator: the lot is read to the end, never split, and flagged.
    expect($scan('010'.BARCODE_EAN.'10LOT4217261130'))->toMatchArray([
        'supplier_lot' => 'LOT4217261130',
        'expires_on' => null,
        'boundary_verified' => false,
    ]);

    $this->getJson('/api/v1/catalogue/ingredient-barcodes/scan?code=2012345678903', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.details.reason', 'variable_measure');
});

it('expands UPC-E only when the camera says it was UPC-E', function (): void {
    $this->actingAs($this->chef);

    $this->getJson('/api/v1/catalogue/ingredient-barcodes/scan?code=04252614&symbology=upc_e', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.scan.gtin', '00042100005264');
});
