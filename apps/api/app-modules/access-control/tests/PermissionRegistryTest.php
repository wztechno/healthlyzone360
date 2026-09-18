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

        // AA1: purchasing and finance. Organisation-scoped for the reason every
        // other kitchen role is — both describe a job inside one kitchen, and
        // neither reads across a tenant boundary. Both are assembled entirely
        // from codes that already existed.
        'procurement_manager', 'finance_manager',
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

it('separates the administrator from the owner by the identity of the business', function (): void {
    // The one pin standing between a deliberate distinction and an accidental
    // duplicate. AA1 gave `organisation_admin` the `role.manage_organisation`
    // it had always been denied — an administrator who could not administer
    // access was a name with nothing behind it — and took
    // `organisation.update_current` in exchange.
    //
    // Without the exchange this role would be `$all`, which is exactly what
    // `organisation_owner` holds: two template roles the seeder writes, the
    // console offers and nobody can tell apart. The assertion is therefore in
    // two halves, and both matter. The first says the two roles differ. The
    // second says *how* — an administrator runs the organisation; the owner
    // decides what the organisation is.
    $templates = PermissionRegistry::templateRoles();
    $owner = $templates['organisation_owner']['permissions'];
    $admin = $templates['organisation_admin']['permissions'];

    expect($admin)->not->toEqualCanonicalizing($owner)
        ->and(array_values(array_diff($owner, $admin)))->toBe(['organisation.update_current'])
        ->and(array_diff($admin, $owner))->toBe([])
        ->and($admin)->toContain('role.manage_organisation');
});

it('lets the buyer spend the kitchen\'s money without seeing what it charges', function (): void {
    // Pinned as a set for the `order_desk_agent` reason: what is interesting
    // about this role is which side of each pair it sits on.
    //
    // It is the first operating role to hold `inventory.order_supplies_
    // organisation` other than the kitchen manager, and the first outside the
    // commercial pair to cross INV1's cost line — a buyer who cannot see what
    // the last crate cost is guessing.
    $buyer = PermissionRegistry::templateRoles()['procurement_manager']['permissions'];

    expect($buyer)->toEqualCanonicalizing([
        'organisation.view_current',
        'branch.view_current',
        'catalogue.view_organisation',
        'inventory.view_organisation',
        'inventory.manage_organisation',
        'inventory.view_costs_organisation',
        'inventory.order_supplies_organisation',
    ]);

    foreach ([
        // The sharpest line the role draws. A buyer names what the kitchen
        // pays; what it charges is the commercial side's, and a role holding
        // both could reconstruct the margin on every dish from the purchase
        // ledger — K1.3's cost split undone from the other direction.
        'price_list.view_organisation',
        'price_list.manage_organisation',

        // A dish's cost, not a crate's.
        'recipe.view_costs_organisation',

        // A buyer reads the shortage, not the customers behind it.
        'order.view_organisation',
        'order.manage_organisation',

        // Buying is not renaming the food, nor deciding what is sold.
        'catalogue.manage_organisation',
        'catalogue.publish_organisation',
    ] as $withheld) {
        expect($buyer)->not->toContain($withheld);
    }
});

it('gives finance every number and no way to change one', function (): void {
    // Almost entirely reads, and the single exception is the point:
    // `recipe.view_costs_organisation` gates the read *and* the write of line
    // unit costs by design (K1.3), and finance is who knows what a thing cost.
    $finance = PermissionRegistry::templateRoles()['finance_manager']['permissions'];

    expect($finance)->toEqualCanonicalizing([
        'organisation.view_current',
        'branch.view_current',
        'catalogue.view_organisation',
        'recipe.view_organisation',
        'recipe.view_costs_organisation',
        'price_list.view_organisation',
        'order.view_organisation',
        'subscription.view_organisation',
        'b2b_quotation.view_organisation',
        'inventory.view_organisation',
        'inventory.view_costs_organisation',
        'audit.view_organisation',
    ]);

    foreach ([
        // Every write on every surface it reads. Reading a formulation is not
        // deciding it; seeing a tariff is not setting one; reading the order
        // book is not cancelling somebody's dinner.
        'catalogue.manage_organisation',
        'catalogue.publish_organisation',
        'recipe.manage_organisation',
        'recipe.publish_organisation',
        'price_list.manage_organisation',
        'plan.manage_organisation',
        'plan.publish_organisation',
        'order.manage_organisation',
        'inventory.manage_organisation',
        'inventory.order_supplies_organisation',
        'b2b_quotation.quote_organisation',

        // Money is not access.
        'membership.view_organisation',
        'role.manage_organisation',
        'user.manage_organisation',
    ] as $withheld) {
        expect($finance)->not->toContain($withheld);
    }
});
