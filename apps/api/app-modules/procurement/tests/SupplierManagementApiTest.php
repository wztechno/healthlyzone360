<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Supplier management — the record, its lifecycle and its named contacts
|--------------------------------------------------------------------------
|
| SUP1. A supplier stops being a label on a delivery note and becomes a record
| the kitchen keeps: bilingual name, address, payment terms, lead time, notes,
| an archive that is not a delete, and the named people you actually phone.
|
| Three things are pinned here rather than trusted:
|
| - **the archive is a filter, not a deletion** — an archived supplier leaves
|   the default list, returns under `include_archived`, and comes back whole;
| - **the two contact-set invariants fail as 422s** — one primary, one reachable
|   channel — because the database constraints behind them would surface as a
|   500 that tells the person nothing;
| - **the permission split holds** — `inventory.view_organisation` reads the
|   book, and every write needs `inventory.manage_organisation`.
|
*/

/**
 * A kitchen whose user holds exactly $permissions.
 *
 * @param  list<string>  $permissions
 */
function supplierWorld(string $email, array $permissions = PricingWorld::FULL_PERMISSIONS): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);

    return (object) [
        'tenant' => $tenant,
        'organisation' => $tenant->organisation,
        'user' => $tenant->user,
        'headers' => PricingWorld::headers($tenant),
    ];
}

/**
 * A supplier written straight into an organisation — the state a test wants to
 * assert *about*, without asserting the create on the way in.
 *
 * @param  array<string, mixed>  $attributes
 */
function supplierRow(string $organisationId, array $attributes = []): Supplier
{
    return Supplier::withoutTenancy()->create($attributes + [
        'organisation_id' => $organisationId,
        'code' => 'SUP-1',
        'name_en' => 'Gulf Fresh',
    ]);
}

/** What a caller who may read the book but not write it holds. */
const SUPPLIER_VIEW_ONLY = [
    'organisation.view_current',
    'branch.view_current',
    'inventory.view_organisation',
];

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->world = supplierWorld('suppliers@kitchen.test');
    $this->actingAs($this->world->user);
    $this->headers = $this->world->headers;
});

it('creates, shows and updates a supplier with every field of the record', function (): void {
    $created = $this->postJson('/api/v1/catalogue/procurement/suppliers', [
        'name_en' => 'Gulf Fresh Trading',
        'name_ar' => 'الخليج الطازج للتجارة',
        'code' => 'GULF-01',
        'currency_code' => 'USD',
        'contact_email' => 'orders@gulffresh.test',
        'contact_phone' => '+961 1 234 567',
        'address' => "Gate 4, behind the cold store\nBourj Hammoud",
        'payment_terms' => 'Net 30',
        'lead_time_days' => 2,
        'notes' => 'Delivers before 06:00 on weekdays.',
    ], $this->headers)->assertCreated();

    $supplierId = $created->json('data.supplier.id');

    // The create response is the canonical shape, not a subset of it.
    $created
        ->assertJsonPath('data.supplier.name_ar', 'الخليج الطازج للتجارة')
        ->assertJsonPath('data.supplier.lead_time_days', 2)
        ->assertJsonPath('data.supplier.archived_at', null)
        ->assertJsonPath('data.supplier.contact_count', 0)
        ->assertJsonPath('data.supplier.primary_contact', null);

    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$supplierId}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.code', 'GULF-01')
        ->assertJsonPath('data.supplier.name_en', 'Gulf Fresh Trading')
        ->assertJsonPath('data.supplier.name_ar', 'الخليج الطازج للتجارة')
        ->assertJsonPath('data.supplier.currency_code', 'USD')
        ->assertJsonPath('data.supplier.contact_email', 'orders@gulffresh.test')
        ->assertJsonPath('data.supplier.contact_phone', '+961 1 234 567')
        ->assertJsonPath('data.supplier.address', "Gate 4, behind the cold store\nBourj Hammoud")
        ->assertJsonPath('data.supplier.payment_terms', 'Net 30')
        ->assertJsonPath('data.supplier.lead_time_days', 2)
        ->assertJsonPath('data.supplier.notes', 'Delivers before 06:00 on weekdays.')
        ->assertJsonPath('data.supplier.contacts', []);

    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$supplierId}", [
        'name_en' => 'Gulf Fresh Co.',
        'name_ar' => 'الخليج الطازج',
        'code' => 'GULF-02',
        'currency_code' => 'EUR',
        'contact_email' => 'sales@gulffresh.test',
        'contact_phone' => '+961 1 765 432',
        'address' => 'Souk el Ahad, stall 12',
        'payment_terms' => 'Cash on delivery',
        'lead_time_days' => 0,
        // Cleared rather than omitted: null means "remove this".
        'notes' => null,
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.name_en', 'Gulf Fresh Co.')
        ->assertJsonPath('data.supplier.name_ar', 'الخليج الطازج')
        ->assertJsonPath('data.supplier.code', 'GULF-02')
        ->assertJsonPath('data.supplier.currency_code', 'EUR')
        ->assertJsonPath('data.supplier.contact_email', 'sales@gulffresh.test')
        ->assertJsonPath('data.supplier.contact_phone', '+961 1 765 432')
        ->assertJsonPath('data.supplier.address', 'Souk el Ahad, stall 12')
        ->assertJsonPath('data.supplier.payment_terms', 'Cash on delivery')
        // Zero is a real lead time — a same-morning market run — not "unset".
        ->assertJsonPath('data.supplier.lead_time_days', 0)
        ->assertJsonPath('data.supplier.notes', null);
});

it('refuses a lead time outside the documented range before the CHECK can fire', function (): void {
    $supplier = supplierRow((string) $this->world->organisation->getKey());

    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}", [
        'lead_time_days' => 400,
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    $this->postJson('/api/v1/catalogue/procurement/suppliers', [
        'name_en' => 'Slow Supplier',
        'lead_time_days' => 400,
    ], $this->headers)->assertStatus(422);
});

it('lets a supplier keep its own code on update but refuses another supplier\'s', function (): void {
    $organisationId = (string) $this->world->organisation->getKey();
    $first = supplierRow($organisationId, ['code' => 'GULF-01', 'name_en' => 'Gulf Fresh']);
    $second = supplierRow($organisationId, ['code' => 'BEKAA-01', 'name_en' => 'Bekaa Farms']);

    // Re-saving an unchanged form is not a conflict with itself.
    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$first->getKey()}", [
        'code' => 'GULF-01',
        'name_en' => 'Gulf Fresh Trading',
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.code', 'GULF-01')
        ->assertJsonPath('data.supplier.name_en', 'Gulf Fresh Trading');

    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$second->getKey()}", [
        'code' => 'GULF-01',
    ], $this->headers)->assertStatus(422);
});

it('archives a supplier out of the book, serves it under include_archived and restores it whole', function (): void {
    $organisationId = (string) $this->world->organisation->getKey();
    $archived = supplierRow($organisationId, ['code' => 'GULF-01', 'name_en' => 'Gulf Fresh']);
    supplierRow($organisationId, ['code' => 'BEKAA-01', 'name_en' => 'Bekaa Farms']);

    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$archived->getKey()}/archive", [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.id', (string) $archived->getKey());

    expect($this->postJson("/api/v1/catalogue/procurement/suppliers/{$archived->getKey()}/archive", [], $this->headers)
        ->assertOk()
        ->json('data.supplier.archived_at'))->not->toBeNull();

    // Gone from the default book — every picker reads this list.
    $live = $this->getJson('/api/v1/catalogue/procurement/suppliers', $this->headers)->assertOk();
    expect($live->json('data.suppliers'))->toHaveCount(1)
        ->and($live->json('data.suppliers.0.code'))->toBe('BEKAA-01');

    // Present, and flagged, when the archive filter asks for it.
    $all = $this->getJson('/api/v1/catalogue/procurement/suppliers?include_archived=true', $this->headers)->assertOk();
    expect($all->json('data.suppliers'))->toHaveCount(2)
        ->and($all->json('meta.archived_count'))->toBe(1);

    // The record is never hidden from its own page — a receipt posted last
    // month names it.
    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$archived->getKey()}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.name_en', 'Gulf Fresh');

    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$archived->getKey()}/restore", [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.archived_at', null);

    expect($this->getJson('/api/v1/catalogue/procurement/suppliers', $this->headers)->json('data.suppliers'))
        ->toHaveCount(2);
});

it('replaces a contact set in one call — inserting, updating by id and deleting what was omitted', function (): void {
    $supplier = supplierRow((string) $this->world->organisation->getKey());

    $first = $this->putJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}/contacts", [
        'contacts' => [
            ['name' => 'Samir Haddad', 'role_title' => 'Vegetables', 'phone' => '+961 3 111 222', 'is_primary' => true],
            ['name' => 'Rana Khoury', 'email' => 'rana@gulffresh.test'],
        ],
    ], $this->headers)->assertOk();

    expect($first->json('data.contacts'))->toHaveCount(2);

    $samirId = $first->json('data.contacts.0.id');
    expect($first->json('data.contacts.0.name'))->toBe('Samir Haddad')
        ->and($first->json('data.contacts.0.is_primary'))->toBeTrue();

    // Samir is updated by id, Rana is omitted (deleted), and a third is new.
    $second = $this->putJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}/contacts", [
        'contacts' => [
            ['id' => $samirId, 'name' => 'Samir Haddad', 'role_title' => 'Produce manager', 'phone' => '+961 3 111 222', 'whatsapp_phone' => '+961 3 111 222'],
            ['name' => 'Nadia Aoun', 'whatsapp_phone' => '+961 70 999 888', 'is_primary' => true],
        ],
    ], $this->headers)->assertOk();

    expect($second->json('data.contacts'))->toHaveCount(2);

    $names = array_column($second->json('data.contacts'), 'name');
    expect($names)->toContain('Samir Haddad')
        ->and($names)->toContain('Nadia Aoun')
        ->and($names)->not->toContain('Rana Khoury');

    // Updated in place rather than replaced — the same row, edited.
    $samir = collect($second->json('data.contacts'))->firstWhere('id', $samirId);
    expect($samir['role_title'])->toBe('Produce manager')
        ->and($samir['is_primary'])->toBeFalse();

    expect(SupplierContact::withoutTenancy()->where('supplier_id', $supplier->getKey())->count())->toBe(2);

    // The list summary follows the set: the primary moved to Nadia.
    $this->getJson('/api/v1/catalogue/procurement/suppliers', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.suppliers.0.contact_count', 2)
        ->assertJsonPath('data.suppliers.0.primary_contact.name', 'Nadia Aoun')
        ->assertJsonPath('data.suppliers.0.primary_contact.phone', '+961 70 999 888');

    // An empty set clears the lot.
    $this->putJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}/contacts", [
        'contacts' => [],
    ], $this->headers)->assertOk()->assertJsonPath('data.contacts', []);

    expect(SupplierContact::withoutTenancy()->where('supplier_id', $supplier->getKey())->count())->toBe(0);
});

it('refuses a second primary contact as a 422 rather than a constraint violation', function (): void {
    $supplier = supplierRow((string) $this->world->organisation->getKey());

    $this->putJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}/contacts", [
        'contacts' => [
            ['name' => 'Samir Haddad', 'phone' => '+961 3 111 222', 'is_primary' => true],
            ['name' => 'Nadia Aoun', 'phone' => '+961 70 999 888', 'is_primary' => true],
        ],
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(SupplierContact::withoutTenancy()->where('supplier_id', $supplier->getKey())->count())->toBe(0);
});

it('refuses a contact nobody can reach as a 422 rather than a constraint violation', function (): void {
    $supplier = supplierRow((string) $this->world->organisation->getKey());

    $this->putJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}/contacts", [
        'contacts' => [
            ['name' => 'Samir Haddad', 'phone' => '+961 3 111 222'],
            ['name' => 'Unreachable Person', 'role_title' => 'Nobody answers'],
        ],
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(SupplierContact::withoutTenancy()->where('supplier_id', $supplier->getKey())->count())->toBe(0);
});

it('answers not-found for another organisation\'s supplier on every id-bearing route', function (): void {
    $other = supplierWorld('other@kitchen.test');
    $foreign = supplierRow((string) $other->organisation->getKey(), ['code' => 'FOREIGN-1']);
    $id = (string) $foreign->getKey();

    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$id}", $this->headers)->assertNotFound();
    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$id}", ['name_en' => 'Stolen'], $this->headers)->assertNotFound();
    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$id}/archive", [], $this->headers)->assertNotFound();
    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$id}/restore", [], $this->headers)->assertNotFound();
    $this->putJson("/api/v1/catalogue/procurement/suppliers/{$id}/contacts", ['contacts' => []], $this->headers)->assertNotFound();

    // And nothing was written on the way to the 404.
    expect(Supplier::withoutTenancy()->whereKey($id)->value('name_en'))->toBe('Gulf Fresh');
});

it('lets a view-only holder read the book and forbids every write', function (): void {
    $viewer = supplierWorld('viewer@kitchen.test', SUPPLIER_VIEW_ONLY);
    $supplier = supplierRow((string) $viewer->organisation->getKey());
    $id = (string) $supplier->getKey();

    $this->actingAs($viewer->user);

    $this->getJson('/api/v1/catalogue/procurement/suppliers', $viewer->headers)->assertOk();
    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$id}", $viewer->headers)->assertOk();

    $this->postJson('/api/v1/catalogue/procurement/suppliers', ['name_en' => 'New'], $viewer->headers)->assertForbidden();
    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$id}", ['name_en' => 'Renamed'], $viewer->headers)->assertForbidden();
    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$id}/archive", [], $viewer->headers)->assertForbidden();
    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$id}/restore", [], $viewer->headers)->assertForbidden();
    $this->putJson("/api/v1/catalogue/procurement/suppliers/{$id}/contacts", ['contacts' => []], $viewer->headers)->assertForbidden();
});

it('lets a manage holder perform every write the view-only holder was refused', function (): void {
    $supplier = supplierRow((string) $this->world->organisation->getKey());
    $id = (string) $supplier->getKey();

    $this->patchJson("/api/v1/catalogue/procurement/suppliers/{$id}", ['name_en' => 'Renamed'], $this->headers)->assertOk();
    $this->putJson("/api/v1/catalogue/procurement/suppliers/{$id}/contacts", [
        'contacts' => [['name' => 'Samir Haddad', 'phone' => '+961 3 111 222']],
    ], $this->headers)->assertOk();
    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$id}/archive", [], $this->headers)->assertOk();
    $this->postJson("/api/v1/catalogue/procurement/suppliers/{$id}/restore", [], $this->headers)->assertOk();
    $this->postJson('/api/v1/catalogue/procurement/suppliers', ['name_en' => 'Bekaa Farms'], $this->headers)->assertCreated();
});
