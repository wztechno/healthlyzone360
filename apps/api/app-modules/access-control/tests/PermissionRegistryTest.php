<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionRegistry;

/*
|--------------------------------------------------------------------------
| Organisation permissions never leak into a platform role (plan v2 §4.16)
|--------------------------------------------------------------------------
|
| `organisation_owner` used to be defined as "every registered permission".
| That is harmless while every registered permission is organisation-scoped and
| becomes a privilege-escalation the day a platform-operator code is added: the
| owner of any tenant would silently acquire the ability to review other
| tenants. The registry is therefore split, and these tests are what keep the
| split real.
|
| They are written so that they stay meaningful while `platformPermissions()`
| is empty: the union invariant, the suffix convention and the exact identity
| `organisation_owner === organisationPermissions()` all fail if the split is
| collapsed back into a single list, whether or not a platform code exists yet.
|
*/

/**
 * Template roles that are granted inside an organisation. Pinned so that the
 * first platform-scoped template role has to be classified deliberately rather
 * than slipping into the organisation set unnoticed.
 *
 * @return list<string>
 */
function organisationTemplateRoleCodes(): array
{
    return [
        'organisation_owner', 'organisation_admin', 'branch_manager', 'member',

        // Phase K1: kitchen roles. Organisation-scoped like every template —
        // no platform template role exists, and the platform codes are granted
        // through a bespoke role inside the platform-operator organisation
        // instead (DemoTenantSeeder).
        'kitchen_manager', 'kitchen_chef', 'kitchen_staff', 'commercial_manager',

        // C2: the order desk. The ninth, and organisation-scoped like the rest
        // — a desk agent is somebody's employee working somebody's counter, and
        // there is no cross-tenant reading of any kind behind the role.
        'order_desk_agent',
    ];
}

it('registers the union of the organisation and platform sets', function (): void {
    $organisation = PermissionRegistry::organisationPermissions();
    $platform = PermissionRegistry::platformPermissions();
    $registered = PermissionRegistry::foundationPermissions();

    expect(array_intersect_key($organisation, $platform))->toBe([])
        ->and($registered)->toHaveCount(count($organisation) + count($platform))
        ->and(array_keys($registered))->toEqualCanonicalizing(
            [...array_keys($organisation), ...array_keys($platform)],
        )
        ->and(PermissionRegistry::codes())->toBe(array_keys($registered));
});

it('routes every registered code through the permission checker', function (): void {
    foreach ([...PermissionRegistry::organisationPermissions(), ...PermissionRegistry::platformPermissions()] as $code => $definition) {
        expect(PermissionRegistry::isPermissionCode((string) $code))->toBeTrue()
            ->and($definition['domain'])->not->toBe('')
            ->and($definition['description'])->not->toBe('');
    }
});

it('formats every registered permission code as domain.action_scope', function (): void {
    foreach (PermissionRegistry::codes() as $code) {
        expect($code)->toMatch(PermissionRegistry::CODE_FORMAT);
    }
});

it('scopes organisation codes to the organisation or the caller, and platform codes to the platform', function (): void {
    foreach (array_keys(PermissionRegistry::organisationPermissions()) as $code) {
        expect(str_ends_with($code, '_current') || str_ends_with($code, '_organisation') || str_ends_with($code, '_own'))
            ->toBeTrue("Organisation permission {$code} is not organisation- or own-scoped.");
    }

    foreach (array_keys(PermissionRegistry::platformPermissions()) as $code) {
        expect(str_ends_with($code, '_platform'))
            ->toBeTrue("Platform permission {$code} is not platform-scoped.");
    }
});

it('classifies every template role as organisation-scoped', function (): void {
    expect(array_keys(PermissionRegistry::templateRoles()))
        ->toEqualCanonicalizing(organisationTemplateRoleCodes());
});

it('builds every organisation template role from organisation permissions only', function (): void {
    $organisationCodes = array_keys(PermissionRegistry::organisationPermissions());
    $templates = PermissionRegistry::templateRoles();

    foreach (organisationTemplateRoleCodes() as $role) {
        $unexpected = array_diff($templates[$role]['permissions'], $organisationCodes);

        expect($unexpected)->toBe([], "Template role {$role} grants codes outside the organisation set.");
    }
});

it('never grants an organisation template role a platform permission', function (): void {
    $platformCodes = array_keys(PermissionRegistry::platformPermissions());
    $templates = PermissionRegistry::templateRoles();

    foreach (organisationTemplateRoleCodes() as $role) {
        // array_intersect, not a loop over $platformCodes: the assertion has to
        // run — and keep this test honest — while the platform set is empty.
        expect(array_intersect($templates[$role]['permissions'], $platformCodes))
            ->toBe([], "Template role {$role} grants a platform permission.");
    }
});

it('gives the organisation owner exactly the organisation permission set', function (): void {
    expect(PermissionRegistry::templateRoles()['organisation_owner']['permissions'])
        ->toEqualCanonicalizing(array_keys(PermissionRegistry::organisationPermissions()));
});

it('lets the order desk read the range it sells without deciding it', function (): void {
    // Pinned as a set rather than a count, because the interesting facts about
    // this role are which side of each pair it sits on rather than how many
    // codes it holds.
    //
    // `catalogue.view_organisation` is the newest of them and was missing when
    // the role was first written: the sale wizard's item picker reads the
    // kitchen's own catalogue, and without the view code a desk agent is a
    // counter agent who cannot see the menu. Its absent partners are the point
    // of the pin — an agent sells the range at the tariff and changes neither.
    $desk = PermissionRegistry::templateRoles()['order_desk_agent']['permissions'];

    expect($desk)->toEqualCanonicalizing([
        'catalogue.view_organisation',
        'order.view_organisation',
        'order.manage_organisation',
        'order.create_on_behalf_organisation',
        'customer.create_on_behalf_organisation',
        'order.view_customer_contact_organisation',
        'subscription.view_organisation',
        'inventory.view_organisation',
    ]);

    foreach ([
        'catalogue.manage_organisation',
        'catalogue.publish_organisation',
        'plan.manage_organisation',
        'price_list.manage_organisation',
        'recipe.manage_organisation',

        // What the soup cost the kitchen is the commercial side's. An agent
        // counts the shelf without ever seeing it in money — the whole point
        // of INV1's cost split.
        'inventory.view_costs_organisation',
    ] as $withheld) {
        expect($desk)->not->toContain($withheld);
    }
});
