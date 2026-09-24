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
        // instead (PlatformOperatorSeeder).
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
        // The recipe book: the meal, sauce, dressing and frozen-meal lists this
        // role read under the catalogue code are one page behind this code now.
        // Pinned so the merge cannot quietly take four pages away from a buyer —
        // `2026_09_24_000105` grants it to databases a deploy never re-seeds.
        'recipe.view_organisation',
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

/*
|--------------------------------------------------------------------------
| Grant counts and role splits
|--------------------------------------------------------------------------
|
| These used to be asserted against the seeded rows in `DatabaseSeederTest`, at
| the price of a full seed per case. They are facts about the registry, so they
| are pinned here, hard-coded; `DatabaseSeederTest` pins that the seeder copies
| the registry exactly, which makes each rule below a rule about the seeded
| roles too (D-141).
|
*/

/**
 * The template roles holding a code.
 *
 * @return list<string>
 */
function templateRolesHolding(string $code): array
{
    return array_keys(array_filter(
        PermissionRegistry::templateRoles(),
        static fn (array $template): bool => in_array($code, $template['permissions'], true),
    ));
}

it('grants each template role the expected number of codes', function (string $role, int $expectedGrants): void {
    expect(PermissionRegistry::templateRoles()[$role]['permissions'])->toHaveCount($expectedGrants);
})->with([
    'organisation owner grants every organisation permission' => ['organisation_owner', 46],
    // Forty-five either way, which is why this row stayed green through AA1 while
    // its name stopped being true: the console swapped `role.manage_organisation`
    // in and `organisation.update_current` out, one for one. The count is the
    // weakest half of the pin; `separates the administrator from the owner`
    // above names which code is missing.
    'organisation administrator runs everything except the legal identity of the business' => ['organisation_admin', 45],
    'branch manager is limited to its branch and roster' => ['branch_manager', 3],
    'member holds the organisation view plus the own-scope permissions' => ['member', 7],
    'kitchen manager runs the catalogue, publishes it and its recipes, prices it, designs its plans, draws the delivery map, reads the subscription book, runs inventory including its costs, orders its supplies and holds the order desk in full' => ['kitchen_manager', 31],
    // Nine since PROD1: the chef gained `production.view_organisation` and
    // `production.manage_organisation` and not the costs code. Running the line
    // is the job; what the line cost is the commercial side's, which is the same
    // line `inventory.view_costs_organisation` already draws through this role.
    'chef edits recipes and their costs and runs inventory and batches, but never publishes and never sees a price or a cost outside a recipe' => ['kitchen_chef', 9],
    'kitchen staff read the catalogue, recipes and stock quantities, and no money at all' => ['kitchen_staff', 3],
    'commercial manager reads the catalogue and its costs, decides the range, writes the tariff, owns the plans, prices delivery, reads the subscription book, reads inventory and its costs and sees who is buying' => ['commercial_manager', 16],
    // Eight, not seven: the role gained `catalogue.view_organisation` with the
    // sale wizard's item picker, which reads the kitchen's own catalogue to
    // find out what there is to sell and 403s without it. Reading the range is
    // still not deciding it — the manage and publish codes stay absent, which
    // is the half of this row the name is about.
    'order desk agent works the queue, sells across the counter and opens accounts for cold callers, reads the range and decides neither it nor the tariff' => ['order_desk_agent', 8],
    // AA1's two. They were absent from this dataset for a day after the console
    // shipped — and a dataset only asserts about the rows it lists, so their
    // absence was silent rather than red. `classifies every template role as
    // organisation-scoped` above pins the full role list, which is what notices
    // a new role that this dataset has not heard of.
    // Eight since the recipe book: `recipe.view_organisation`, so the buyer keeps
    // the meal, sauce, dressing and frozen-meal lists that merged into it.
    'purchasing manager spends the kitchen money without seeing what it charges, and reads the recipe book' => ['procurement_manager', 8],
    'finance manager reads every number and can change exactly one, the unit cost of a recipe line' => ['finance_manager', 12],
]);

it('gives the delivery map to the two commercial roles and the branch hours to the kitchen manager', function (): void {
    // K1.7's half of the same split. Where a kitchen delivers and what it
    // charges to get there is a logistics-and-money decision, so the two
    // commercial roles hold it and neither the chef nor kitchen staff do.
    //
    // `branch.manage_current` is deliberately different: it is a fact about a
    // *place*, so the kitchen manager gains it — a manager who cannot say "we
    // close at six on Fridays" cannot run the kitchen — while the commercial
    // manager does not, because a commercial manager who could rewrite opening
    // hours could close a kitchen from a spreadsheet.
    expect(templateRolesHolding('delivery_zone.manage_organisation'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
    ])->and(templateRolesHolding('branch.manage_current'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'branch_manager', 'kitchen_manager',
    ]);
});

it('gives the plan authority to the two commercial roles and to neither the chef nor the staff', function (): void {
    // K1.6's half of the same split the cost test below asserts. A subscription
    // is a commercial instrument — cut-offs, pause rights, long-run discounts —
    // so a chef who designs the food does not thereby decide the terms it is
    // sold on, and kitchen staff hold neither code.
    foreach (['plan.manage_organisation', 'plan.publish_organisation'] as $code) {
        expect(templateRolesHolding($code))->toEqualCanonicalizing([
            'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
        ], "Unexpected holders of {$code}.");
    }
});

it('withholds cost visibility from kitchen staff, and gives it to finance', function (): void {
    // The split appendix C asks for, asserted where it is actually decided.
    // A line cook reading the method to make the dish must not thereby read
    // the margin on it, and a docblock is not a mechanism.
    //
    // `finance_manager` joined the holders with AA1's access console, and it is
    // the one role here that reads a cost without being able to move a dish:
    // finance is who knows what a thing cost, and six of the reports in
    // `report-catalogue.md` are unopenable without the cost codes. The rule this
    // test protects is about the line cook, and it is unchanged — the list grew
    // at the other end.
    expect(templateRolesHolding('recipe.view_costs_organisation'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'kitchen_manager', 'kitchen_chef',
        'commercial_manager', 'finance_manager',
    ]);
});

it('grants the publication permission to the kitchen manager and to nobody else', function (): void {
    // Publishing freezes an allergen label that reaches a diner and withdraws
    // whatever was live before. A chef writing a formulation is a different
    // authority, and the separation has to be real in the template roles rather
    // than a sentence in a docblock.
    expect(templateRolesHolding('recipe.publish_organisation'))
        ->toEqualCanonicalizing(['organisation_owner', 'organisation_admin', 'kitchen_manager']);
});

it('grants the catalogue publication permission to the two roles that decide the range', function (): void {
    // The kitchen manager and the commercial manager, and neither the chef nor
    // the staff. Deciding what a customer can buy is a different authority
    // from writing the listing, and the commercial manager holds it *without*
    // `catalogue.manage_organisation`: a merchandiser may put a dish on sale
    // without being able to change a line of how it is made.
    expect(templateRolesHolding('catalogue.publish_organisation'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
    ]);
});

it('keeps price visibility away from the chef and the kitchen staff entirely', function (): void {
    // The K1.5 split, and the one that would have been easiest to get wrong.
    // Folding prices into `catalogue.view_organisation` would have handed a
    // negotiated amount — the most commercially sensitive figure in the
    // schema — to every line cook who can read an ingredient, and would have
    // quietly undone K1.3's cost split too, since a margin is reconstructable
    // from a cost and a price. Note the chef holds the *cost* permission and
    // neither price code: those are different questions with different answers.
    //
    // The two codes no longer have the same holders, and the difference is K1.5's
    // split doing the work it was made for: `finance_manager` reads the tariff
    // and cannot set one. A finance manager who cannot see a price cannot
    // reconcile a total; deciding the price is the commercial manager's. Asserted
    // as two lists rather than one loop precisely so that widening the read can
    // never quietly widen the write.
    expect(templateRolesHolding('price_list.view_organisation'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
        'finance_manager',
    ], 'Unexpected holders of price_list.view_organisation.')
        ->and(templateRolesHolding('price_list.manage_organisation'))->toEqualCanonicalizing([
            'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
        ], 'Unexpected holders of price_list.manage_organisation.');
});
