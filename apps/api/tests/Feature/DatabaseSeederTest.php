<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Services\ZoneResolver;
use Healthy360\Features\Models\FeatureDefinition;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Database\Seeders\CountrySeeder;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\ReferenceData\Models\Language;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\Hash;

/*
|--------------------------------------------------------------------------
| Seeders
|--------------------------------------------------------------------------
|
| The seeded catalogue is a contract: reference data, the foundation
| permission set and the platform template roles are what every other module
| and the frontend permission kernel are written against.
|
*/

beforeEach(function (): void {
    $this->seed();
});

it('seeds every ISO country but activates only the launch markets', function (): void {
    expect(Country::query()->count())->toBe(249)
        ->and(Country::query()->where('is_active', true)->count())->toBe(9)
        ->and(Country::query()->where('is_active', true)->orderBy('code')->pluck('code')->all())
        ->toEqualCanonicalizing(CountrySeeder::LAUNCH_MARKETS)
        ->and(Country::query()->whereKey('LB')->value('default_currency_code'))->toBe('LBP')
        ->and(Country::query()->whereKey('KW')->value('default_currency_code'))->toBe('KWD');
});

it('seeds currencies with ISO minor units and activates the launch set plus the majors', function (): void {
    expect(Currency::query()->where('is_active', true)->pluck('code')->all())
        ->toEqualCanonicalizing(['LBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'EGP', 'USD', 'EUR', 'GBP'])
        ->and(Currency::query()->whereIn('code', ['KWD', 'BHD', 'OMR', 'JOD'])->pluck('minor_units')->unique()->all())
        ->toBe([3])
        ->and(Currency::query()->whereKey('USD')->value('minor_units'))->toBe(2)
        ->and(Currency::query()->whereKey('JPY')->value('minor_units'))->toBe(0);
});

it('seeds every currency a country defaults to', function (): void {
    $orphans = Country::query()
        ->whereNotNull('default_currency_code')
        ->whereNotIn('default_currency_code', Currency::query()->select('code'))
        ->count();

    expect($orphans)->toBe(0);
});

it('seeds the launch languages with the correct direction', function (): void {
    $languages = Language::query()->get()->keyBy('code');

    expect($languages)->toHaveCount(3)
        ->and($languages['en']->direction)->toBe('ltr')
        ->and($languages['en']->is_active)->toBeTrue()
        ->and($languages['ar']->direction)->toBe('rtl')
        ->and($languages['ar']->is_active)->toBeTrue()
        ->and($languages['fr']->direction)->toBe('ltr')
        ->and($languages['fr']->is_active)->toBeFalse();
});

it('seeds the foundation and kitchen measurement units', function (): void {
    expect(MeasurementUnit::query()->pluck('code')->all())->toEqualCanonicalizing([
        'g', 'mg', 'kg', 'ml', 'l', 'cm', 'm', 'kcal', 'kJ', 'piece', 'serving', 'tsp', 'tbsp', 'cup',
        'gallon', 'bunch', 'can', 'bag', 'bottle',
    ])->and(MeasurementUnit::query()->pluck('unit_system')->unique()->values()->all())
        ->toEqualCanonicalizing(['metric', 'clinical', 'imperial', 'packaging']);
});

it('gives every measurement unit a dimension conversion can be trusted within', function (): void {
    $dimensions = MeasurementUnit::query()->pluck('dimension', 'code')->all();

    expect($dimensions)->toMatchArray([
        'g' => 'mass', 'mg' => 'mass', 'kg' => 'mass',
        'ml' => 'volume', 'l' => 'volume', 'tsp' => 'volume', 'tbsp' => 'volume', 'cup' => 'volume', 'gallon' => 'volume',
        'cm' => 'length', 'm' => 'length',
        'kcal' => 'energy', 'kJ' => 'energy',
        'piece' => 'count',
        'serving' => 'serving',
        'bunch' => 'package', 'can' => 'package', 'bag' => 'package', 'bottle' => 'package',
    ])->and(array_values(array_unique(array_values($dimensions))))
        ->toEqualCanonicalizing(['mass', 'volume', 'length', 'energy', 'count', 'serving', 'package']);
});

it('seeds the twelve diet classifications the frontend union declares', function (): void {
    // The database vocabulary and the closed union a screen is written against
    // are the same list, asserted in one direction here and pinned by the
    // public endpoint test in the other. The Customer-Data-Structure source
    // lists nine; these twelve are the superset every one of them folds into,
    // so an import never has to invent a code.
    $classifications = DietClassification::query()->orderBy('display_order')->get();

    expect($classifications)->toHaveCount(12)
        ->and($classifications->pluck('code')->all())->toBe([
            'omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'low_carb',
            'high_protein', 'mediterranean', 'halal_friendly', 'gluten_free',
            'dairy_free', 'nut_free',
        ])
        ->and($classifications->where('is_active', false)->count())->toBe(0)
        // Authored Arabic, pending native review — never machine-translated,
        // and never left blank (master plan v2 §4.18).
        ->and($classifications->filter(fn (DietClassification $row): bool => trim($row->name_ar) === '')->count())->toBe(0)
        ->and($classifications->filter(fn (DietClassification $row): bool => $row->name_ar === $row->name_en)->count())->toBe(0);
});

it('seeds the ten platform product categories as a flat library', function (): void {
    $categories = ProductCategory::withoutTenancy()->whereNull('organisation_id')->orderBy('display_order')->get();

    expect($categories)->toHaveCount(10)
        ->and($categories->pluck('code')->all())->toBe([
            'poultry', 'meat', 'frozen', 'sauce', 'toppings',
            'oil', 'condiment', 'bread', 'dairy', 'vegetables',
        ])
        ->and($categories->where('is_active', false)->count())->toBe(0)
        ->and($categories->where('name_ar', '')->count())->toBe(0);
});

it('seeds the fourteen canonical allergen classes with their market metadata', function (): void {
    $classes = Allergen::query()->orderBy('display_order')->get()->keyBy('code');

    expect($classes)->toHaveCount(14)
        ->and($classes->keys()->all())->toBe([
            'gluten', 'crustaceans', 'egg', 'fish', 'peanut', 'soy', 'milk', 'tree_nut',
            'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'mollusc',
        ])
        ->and($classes->pluck('regulatory_ref')->all())->toBe([
            'ALG-01', 'ALG-02', 'ALG-03', 'ALG-04', 'ALG-05', 'ALG-06', 'ALG-07',
            'ALG-08', 'ALG-09', 'ALG-10', 'ALG-11', 'ALG-12', 'ALG-13', 'ALG-14',
        ])
        ->and($classes->where('is_eu_14', false)->keys()->all())->toBe([])
        ->and($classes->where('is_us_big_9', false)->keys()->sort()->values()->all())
        ->toBe(['celery', 'lupin', 'mollusc', 'mustard', 'sulphites'])
        ->and($classes['sulphites']->us_declaration_required)->toBeTrue()
        ->and($classes['sulphites']->us_threshold_ppm)->toBe(10)
        ->and($classes->where('us_declaration_required', true)->keys()->all())->toBe(['sulphites'])
        ->and($classes->where('name_ar', '')->count())->toBe(0);
});

it('seeds the platform ingredient library with its taxonomy and aliases', function (): void {
    $ingredients = Ingredient::withoutTenancy()->whereNull('organisation_id')->get();

    expect($ingredients)->toHaveCount(213)
        ->and($ingredients->pluck('source_system')->unique()->all())->toBe(['healthy360_platform'])
        ->and($ingredients->pluck('source_ref')->unique())->toHaveCount(213)
        ->and($ingredients->whereNull('seeded_at')->count())->toBe(0)
        ->and($ingredients->where('status', IngredientStatus::Active)->count())->toBe(213);

    $categories = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->get();

    expect($categories)->toHaveCount(62)
        ->and($categories->whereNull('parent_id')->count())->toBe(12)
        ->and($categories->whereNotNull('parent_id')->count())->toBe(50);

    // The two workbook rows that duplicate an earlier ingredient survive as
    // aliases, so a later import quoting IG-161/IG-162 still resolves.
    $aliases = IngredientAlias::query()->where('source_system', 'healthy360_platform')->get();

    expect($aliases->count())->toBeGreaterThanOrEqual(2)
        ->and($aliases->pluck('source_ref')->sort()->values()->all())->toBe(['IG-161', 'IG-162'])
        ->and($aliases->pluck('alias_normalised')->sort()->values()->all())->toBe(['garlic', 'onions']);
});

it('seeds the platform allergen baseline exactly as the source records it', function (): void {
    $mappings = IngredientAllergen::withoutTenancy()->whereNull('organisation_id')->get();

    expect($mappings)->toHaveCount(61)
        ->and($mappings->pluck('source')->unique()->all())->toBe([AllergenMappingSource::MasterList])
        ->and($mappings->countBy(fn (IngredientAllergen $row): string => $row->allergen_code)->sortKeys()->all())
        ->toBe([
            'celery' => 1, 'crustaceans' => 2, 'egg' => 2, 'fish' => 4, 'gluten' => 13,
            'lupin' => 1, 'milk' => 7, 'mollusc' => 1, 'mustard' => 1, 'peanut' => 2,
            'sesame' => 3, 'soy' => 4, 'sulphites' => 7, 'tree_nut' => 13,
        ]);

    // Coconut is a tree nut under US law and not an EU allergen.
    $usOnly = $mappings->where('market_scope', AllergenMarketScope::UsOnly);

    expect($usOnly)->toHaveCount(4)
        ->and($usOnly->pluck('allergen_code')->unique()->all())->toBe(['tree_nut']);

    // "Possible — verify per supplier" is recorded as a possibility.
    $sulphites = $mappings->where('allergen_code', 'sulphites');

    expect($sulphites->pluck('containment')->unique()->all())->toBe([AllergenContainment::MayContain])
        ->and($sulphites->pluck('verification_status')->unique()->all())
        ->toBe([AllergenVerificationStatus::RequiresSupplierConfirmation])
        ->and($sulphites->pluck('evidence')->unique()->all())->toBe(['verify per supplier']);

    // Soya sauce carries both classes the source names for it.
    $soyaSauce = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'soya-sauce')->sole();

    expect($mappings->where('ingredient_id', $soyaSauce->getKey())->pluck('allergen_code')->sort()->values()->all())
        ->toBe(['gluten', 'soy']);
});

it('quarantines the burghul and pita rows the source contradicts itself about', function (): void {
    $flagged = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('verification_status', IngredientVerificationStatus::RequiresReview)
        ->get();

    expect($flagged->pluck('source_ref')->sort()->values()->all())->toBe(['IG-025', 'IG-143'])
        ->and($flagged->pluck('slug')->sort()->values()->all())->toBe(['burghul-bulgur', 'pita-bread']);

    foreach ($flagged as $ingredient) {
        expect($ingredient->notes)->toContain('Cereals/Gluten')
            // Seeded exactly as recorded: the source says "None", so no
            // mapping is invented on the way in.
            ->and(IngredientAllergen::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->count())->toBe(0);
    }
});

it('falls back to the English name where the source has no Arabic', function (): void {
    // The ingredient workbook is English-only; a machine translation of a
    // food name that ends up on an allergen label is not an improvement.
    $fallbacks = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->whereColumn('name_ar', 'name_en')
        ->count();

    expect($fallbacks)->toBe(213);
});

it('seeds the twelve organisation types with both names', function (): void {
    expect(OrganisationType::query()->count())->toBe(12)
        ->and(OrganisationType::query()->pluck('code')->all())->toEqualCanonicalizing([
            'clinic', 'healthcare_centre', 'dietitian_practice', 'kitchen', 'restaurant',
            'fitness_centre', 'wellness_provider', 'supplier', 'delivery_provider',
            'corporate_customer', 'insurance_partner', 'platform_operator',
        ])
        ->and(OrganisationType::query()->where('name_ar', '')->orWhereNull('name_ar')->count())->toBe(0);
});

it('seeds exactly the registered permission set', function (): void {
    // 24 after K1.1, plus the three recipe codes K1.2 introduces, the cost
    // permission K1.3 splits out of them, the catalogue publication authority
    // K1.4 adds, the pricing pair K1.5 keeps deliberately separate from
    // `catalogue.*`, the plan pair K1.6 adds for the commercial instrument a
    // subscription is, and the single delivery code K1.7 adds — one rather
    // than a pair, because no screen could sensibly show a kitchen its
    // delivery map while withholding the ability to change it.
    //
    // The integration wave adds seven: the `order.*` pair, because reading the
    // day's orders and cancelling somebody's dinner are held by different
    // people; and five platform codes for B2B onboarding — four splitting the
    // review workflow into view, review, decide and provision, plus
    // `kyc_document.view_platform`, deliberately narrower than the application
    // read because working a queue is not by itself a reason to open somebody's
    // passport photograph.
    //
    // The final backend wave adds four, all of them platform codes, and none of
    // them a pair with an organisation counterpart. Two split the corporate
    // wind-up — `b2b_offboarding.manage_platform` drives the nine states, and
    // `b2b_offboarding.waive_settlement_platform` stacks on the one step that
    // lets a company stop owing money and leave anyway, which is a commercial
    // concession rather than an operational move.
    // `record_export.create_platform` is the authority to take a complete copy
    // of everything a company gave the platform, deliberately narrower than
    // driving the wind-up on the same argument that made the KYC read narrower
    // than the application read. And `customer_account.close_platform` lets
    // support *open* an account closure on somebody's behalf — with no
    // counterpart authority to finish one, because the passcode goes to the
    // customer and staff who could do both could erase anybody.
    //
    // `subscription.view_organisation` is **not** new; it has been in the
    // registry since the foundation and this wave is the first to grant it.
    expect(Permission::query()->count())->toBe(45)
        ->and(Permission::query()->pluck('code')->all())
        ->toEqualCanonicalizing(PermissionRegistry::codes());
});

it('keeps the platform permissions out of every organisation template role', function (): void {
    $platformIds = Permission::query()
        ->whereIn('code', array_keys(PermissionRegistry::platformPermissions()))
        ->pluck('id');

    // Eleven since the final backend wave: the two reference codes, B1's five,
    // and B2/J2's four. The count is pinned rather than derived so that adding a
    // platform code without thinking about this test is impossible — and the
    // four newest are exactly the kind that would be tempting to hand to an
    // organisation owner, since a wind-up and a closure are both about a
    // specific organisation's or person's records.
    expect($platformIds)->toHaveCount(11)
        ->and(RolePermission::withoutTenancy()
            ->whereIn('permission_id', $platformIds)
            ->whereIn('role_id', Role::withoutTenancy()->whereNull('organisation_id')->select('id'))
            ->count())->toBe(0);
});

it('seeds permission codes in the domain.action_scope format', function (): void {
    foreach (Permission::query()->pluck('code')->all() as $code) {
        expect($code)->toMatch(PermissionRegistry::CODE_FORMAT);
    }
});

it('seeds the platform template roles with the expected grants', function (string $code, int $expectedGrants): void {
    $role = Role::withoutTenancy()->whereNull('organisation_id')->where('code', $code)->sole();

    expect($role->is_system)->toBeTrue()
        ->and($role->organisation_id)->toBeNull()
        ->and(RolePermission::withoutTenancy()->where('role_id', $role->getKey())->count())->toBe($expectedGrants);
})->with([
    'organisation owner grants every organisation permission' => ['organisation_owner', 34],
    'organisation administrator cannot manage roles' => ['organisation_admin', 33],
    'branch manager is limited to its branch and roster' => ['branch_manager', 3],
    'member holds the organisation view plus the own-scope permissions' => ['member', 7],
    'kitchen manager runs the catalogue, publishes it and its recipes, prices it, designs its plans, draws the delivery map and reads the subscription book' => ['kitchen_manager', 19],
    'chef edits recipes and their costs but never publishes one and never sees a price' => ['kitchen_chef', 5],
    'kitchen staff read the catalogue and recipes, and no money at all' => ['kitchen_staff', 2],
    'commercial manager reads the catalogue and its costs, decides the range, writes the tariff, owns the plans, prices delivery and reads the subscription book' => ['commercial_manager', 11],
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
    $holders = static function (string $code): array {
        $permission = Permission::query()->where('code', $code)->sole();

        return Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->whereIn('id', RolePermission::withoutTenancy()->where('permission_id', $permission->getKey())->select('role_id'))
            ->pluck('code')
            ->all();
    };

    expect($holders('delivery_zone.manage_organisation'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
    ]);

    expect($holders('branch.manage_current'))->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'branch_manager', 'kitchen_manager',
    ]);
});

it('gives the plan authority to the two commercial roles and to neither the chef nor the staff', function (): void {
    // K1.6's half of the same split the cost test above asserts. A subscription
    // is a commercial instrument — cut-offs, pause rights, long-run discounts —
    // so a chef who designs the food does not thereby decide the terms it is
    // sold on, and kitchen staff hold neither code.
    foreach (['plan.manage_organisation', 'plan.publish_organisation'] as $code) {
        $permission = Permission::query()->where('code', $code)->sole();

        $holders = Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->whereIn('id', RolePermission::withoutTenancy()->where('permission_id', $permission->getKey())->select('role_id'))
            ->pluck('code')
            ->all();

        expect($holders)->toEqualCanonicalizing([
            'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
        ]);
    }
});

it('withholds cost visibility from kitchen staff and from nobody else in the kitchen', function (): void {
    // The split appendix C asks for, asserted where it is actually decided.
    // A line cook reading the method to make the dish must not thereby read
    // the margin on it, and a docblock is not a mechanism.
    $costs = Permission::query()->where('code', 'recipe.view_costs_organisation')->sole();

    $holders = Role::withoutTenancy()
        ->whereNull('organisation_id')
        ->whereIn('id', RolePermission::withoutTenancy()->where('permission_id', $costs->getKey())->select('role_id'))
        ->pluck('code')
        ->all();

    expect($holders)->toEqualCanonicalizing([
        'organisation_owner', 'organisation_admin', 'kitchen_manager', 'kitchen_chef', 'commercial_manager',
    ]);
});

it('grants the publication permission to the kitchen manager and to nobody else', function (): void {
    // Publishing freezes an allergen label that reaches a diner and withdraws
    // whatever was live before. A chef writing a formulation is a different
    // authority, and the separation has to be real in the seeded roles rather
    // than a sentence in a docblock.
    $publish = Permission::query()->where('code', 'recipe.publish_organisation')->sole();

    $holders = Role::withoutTenancy()
        ->whereNull('organisation_id')
        ->whereIn('id', RolePermission::withoutTenancy()->where('permission_id', $publish->getKey())->select('role_id'))
        ->pluck('code')
        ->all();

    expect($holders)->toEqualCanonicalizing(['organisation_owner', 'organisation_admin', 'kitchen_manager']);
});

it('grants the catalogue publication permission to the two roles that decide the range', function (): void {
    // The kitchen manager and the commercial manager, and neither the chef nor
    // the staff. Deciding what a customer can buy is a different authority
    // from writing the listing, and the commercial manager holds it *without*
    // `catalogue.manage_organisation`: a merchandiser may put a dish on sale
    // without being able to change a line of how it is made.
    $publish = Permission::query()->where('code', 'catalogue.publish_organisation')->sole();

    $holders = Role::withoutTenancy()
        ->whereNull('organisation_id')
        ->whereIn('id', RolePermission::withoutTenancy()->where('permission_id', $publish->getKey())->select('role_id'))
        ->pluck('code')
        ->all();

    expect($holders)->toEqualCanonicalizing([
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
    foreach (['price_list.view_organisation', 'price_list.manage_organisation'] as $code) {
        $permission = Permission::query()->where('code', $code)->sole();

        $holders = Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->whereIn('id', RolePermission::withoutTenancy()->where('permission_id', $permission->getKey())->select('role_id'))
            ->pluck('code')
            ->all();

        expect($holders)->toEqualCanonicalizing([
            'organisation_owner', 'organisation_admin', 'kitchen_manager', 'commercial_manager',
        ], "Unexpected holders of {$code}.");
    }
});

it('gives the demonstration kitchen its two routes to market', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $channels = SalesChannel::withoutTenancy()->where('organisation_id', $verdant->getKey())->orderBy('code')->get();

    expect($channels->pluck('code')->all())->toBe(['web-shop', 'wholesale'])
        ->and($channels->pluck('channel_kind')->map(static fn ($kind): string => $kind->value)->all())
        ->toBe(['b2c_web', 'b2b']);
});

it('gives the demonstration kitchen a draft tariff in its own currency', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $tariff = PriceList::withoutTenancy()
        ->where('organisation_id', $verdant->getKey())
        ->where('code', 'verdant-web-usd')
        ->sole();

    // USD matches Verdant's organisation default. Draft because nobody has reviewed it.
    expect($tariff->currency_code)->toBe('USD')
        ->and($tariff->currency_code)->toBe($verdant->default_currency_code)
        ->and($tariff->status)->toBe(PriceListStatus::Draft)
        ->and($tariff->customer_scope)->toBe(CustomerScope::PublicTariff);

    $webShop = SalesChannel::withoutTenancy()
        ->where('organisation_id', $verdant->getKey())
        ->where('code', 'web-shop')
        ->sole();

    expect(ChannelPriceList::withoutTenancy()
        ->where('price_list_id', $tariff->getKey())
        ->where('sales_channel_id', $webShop->getKey())
        ->count())->toBe(1);
});

it('seeds the demonstration tariff with a tier and an honest placeholder', function (): void {
    $tariff = PriceList::withoutTenancy()->where('code', 'verdant-web-usd')->sole();

    $entries = PriceListItem::withoutTenancy()
        ->where('price_list_id', $tariff->getKey())
        ->openRows()
        ->get();

    expect($entries)->toHaveCount(3);

    $statuses = $entries->groupBy(static fn (PriceListItem $row): string => $row->price_status->value);

    expect($statuses->get('confirmed'))->toHaveCount(2)
        ->and($statuses->get('placeholder'))->toHaveCount(1);

    // The placeholder is the point of the fixture: a row that says "we have
    // not priced this" without inventing a number. A surface built against
    // demo data where every price is real would never render the honest state.
    $placeholder = $statuses->get('placeholder')->sole();

    expect($placeholder->unit_amount_minor)->toBeNull();

    // And the tier, so the resolver's "highest threshold at or below" rule has
    // something to resolve against.
    $tiered = $entries->firstWhere(static fn (PriceListItem $row): bool => $row->min_quantity !== null);

    expect($tiered)->not->toBeNull()
        ->and((float) $tiered->min_quantity)->toBe(12.0)
        ->and($tiered->unit_amount_minor)->toBeLessThan(
            $entries->firstWhere(static fn (PriceListItem $row): bool => $row->min_quantity === null && $row->unit_amount_minor !== null)->unit_amount_minor,
        );
});

it('seeds Verdant sellable products alongside the three demonstration meals', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $published = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $verdant->getKey())
        ->where('status', CatalogueItemStatus::Published->value)
        ->get();

    expect($published->where('item_type', CatalogueItemType::Meal)->count())->toBe(3)
        ->and($published->where('item_type', CatalogueItemType::Product)->count())->toBeGreaterThan(3)
        ->and(PriceList::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->whereIn('code', ['verdant-products-b2c-usd', 'verdant-products-b2b-usd'])
            ->where('status', PriceListStatus::Active->value)
            ->count())->toBe(2);
});

it('seeds a plan vocabulary that includes a one-off duration', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    expect(MealCombinationOption::withoutTenancy()->where('organisation_id', $verdant->getKey())->pluck('code')->all())
        ->toEqualCanonicalizing(['lunch-dinner', 'full-day'])
        ->and(EnergyBand::withoutTenancy()->where('organisation_id', $verdant->getKey())->pluck('code')->all())
        ->toEqualCanonicalizing(['kcal-1200-1500', 'kcal-1500-1800']);

    $durations = PlanDuration::withoutTenancy()->where('organisation_id', $verdant->getKey())->get();

    expect($durations)->toHaveCount(2);

    // The shape the zero-day sentinel used to occupy (§4.3): a one-off carries
    // no number of days at all, and a demo without one would leave every
    // surface built against this data believing a duration always has one.
    $oneOff = $durations->firstWhere(static fn (PlanDuration $row): bool => $row->duration_kind === PlanDurationKind::OneOff);

    expect($oneOff)->not->toBeNull()
        ->and($oneOff->duration_days)->toBeNull()
        ->and($durations->firstWhere(static fn (PlanDuration $row): bool => $row->duration_kind === PlanDurationKind::FixedDays)->duration_days)->toBe(28);
});

it('seeds a draft plan that is exactly one confirmed price short of publishable', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $plan = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $verdant->getKey())
        ->where('slug', 'balanced-plan')
        ->sole();

    expect($plan->item_type)->toBe(CatalogueItemType::SubscriptionPlan)
        ->and($plan->status)->toBe(CatalogueItemStatus::Draft);

    // The 24 h rule both source systems state, preserved as one column.
    expect(SubscriptionPlanProfile::withoutTenancy()->whereKey($plan->getKey())->value('change_cutoff_hours'))->toBe(24);

    $cells = PlanVariantProfile::withoutTenancy()->where('catalogue_item_id', $plan->getKey())->get();

    expect($cells)->toHaveCount(2);

    $configurations = CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $plan->getKey())
        ->pluck('id', 'code');

    // Derived codes, matching what PlanVariantService produces for these
    // coordinates — so the demo data and the API agree about identity.
    expect($configurations->keys()->all())->toEqualCanonicalizing([
        'lunch-dinner-standard-kcal-1200-1500',
        'full-day-premium-kcal-1500-1800',
    ]);

    $assignments = PlanVariantDuration::withoutTenancy()
        ->whereIn('catalogue_item_variant_id', $configurations->values())
        ->get();

    // Two of the three carry no discount at all, which is what the source
    // sheets contain: NULL says "nobody has stated one" where 0.00 would say
    // "there is none".
    expect($assignments)->toHaveCount(3)
        ->and($assignments->whereNull('discount_percent'))->toHaveCount(2);

    // Exactly one configuration is priced, on an ACTIVE tariff that no channel
    // names — so the publish gate can read it while nothing quotes it to a
    // customer.
    $tariff = PriceList::withoutTenancy()->where('code', 'verdant-plans-usd')->sole();

    expect($tariff->status)->toBe(PriceListStatus::Active)
        ->and($tariff->currency_code)->toBe('USD')
        ->and(ChannelPriceList::withoutTenancy()->where('price_list_id', $tariff->getKey())->count())->toBe(0);

    $priced = PriceListItem::withoutTenancy()
        ->where('price_list_id', $tariff->getKey())
        ->confirmedOpenRows()
        ->pluck('catalogue_item_variant_id')
        ->all();

    expect($priced)->toBe([$configurations->get('lunch-dinner-standard-kcal-1200-1500')]);
});

it('seeds a published marketplace subscription plan', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $plan = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $verdant->getKey())
        ->where('slug', 'marketplace-balanced-plan')
        ->sole();

    expect($plan->item_type)->toBe(CatalogueItemType::SubscriptionPlan)
        ->and($plan->status)->toBe(CatalogueItemStatus::Published);

    $tariff = PriceList::withoutTenancy()->where('code', 'verdant-marketplace-plans-usd')->sole();

    expect($tariff->status)->toBe(PriceListStatus::Active)
        ->and(ChannelPriceList::withoutTenancy()->where('price_list_id', $tariff->getKey())->count())->toBeGreaterThan(0);

    $configurations = CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $plan->getKey())
        ->pluck('id');

    $priced = PriceListItem::withoutTenancy()
        ->where('price_list_id', $tariff->getKey())
        ->confirmedOpenRows()
        ->pluck('catalogue_item_variant_id')
        ->all();

    expect($priced)->toEqualCanonicalizing($configurations->all());
});

it('seeds the Lebanese gazetteer at exactly the 125 names the source lists', function (): void {
    // Committed platform reference data — mechanism (a) — and the count
    // follows the source rather than a target. The `ae-demo-*` rows the demo
    // tenant needs are excluded by construction: they are Emirati, and they
    // are mechanism (b).
    expect(DeliveryArea::query()->where('country_code', 'LB')->count())->toBe(125);

    // Appendix D data-quality finding 25: the spelling is the source's, kept
    // verbatim because a corrected place name is indistinguishable from a
    // different place.
    expect(DeliveryArea::query()->where('code', 'beirut-airpot')->value('name_en'))->toBe('Beirut Airpot');

    // OD-12: the source does not say which governorate a name belongs to, so
    // nothing here pretends to.
    expect(DeliveryArea::query()->whereNotNull('region')->count())->toBe(0);
});

it('keeps the six synthetic demo areas out of the platform gazetteer', function (): void {
    // Verdant is Emirati and the committed gazetteer is Lebanese, so
    // demonstrating a zone at all needs Emirati places. Inventing six of them
    // *into* the gazetteer would put fabricated geography in front of every
    // tenant in every environment. They live in the demo seeder instead, and
    // their codes say so.
    $demo = DeliveryArea::query()->where('country_code', 'AE')->get();

    expect($demo)->toHaveCount(6)
        ->and($demo->every(static fn (DeliveryArea $area): bool => str_starts_with($area->code, 'ae-demo-')))->toBeTrue();
});

it('seeds the demonstration kitchen a two-level delivery map with a branch override', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $wide = DeliveryZone::withoutTenancy()->where('organisation_id', $verdant->getKey())->where('code', 'emirates-wide')->sole();
    $express = DeliveryZone::withoutTenancy()->where('organisation_id', $verdant->getKey())->where('code', 'al-quoz-express')->sole();

    expect($wide->branch_id)->toBeNull()
        ->and($wide->currency_code)->toBe('USD')
        ->and($express->branch_id)->not->toBeNull();

    // The overlap is the fixture the resolution order is worth testing
    // against: Al Quoz is claimed by both, and the branch claim wins.
    $alQuoz = DeliveryArea::query()->where('code', 'ae-demo-al-quoz')->sole();

    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_area_id', $alQuoz->getKey())->count())->toBe(2);

    // The resolver reads through the tenant scope, so the context an
    // `org.context` request would have resolved is set by hand here.
    $owner = User::query()->where('email', 'owner@verdant.test')->sole();
    app(TenantContext::class)->setOrganisation((string) $owner->getKey(), (string) $verdant->getKey());

    expect(app(ZoneResolver::class)->zoneFor((string) $alQuoz->getKey(), (string) $express->branch_id)?->code)
        ->toBe('al-quoz-express');

    expect(app(ZoneResolver::class)->zoneFor((string) $alQuoz->getKey())?->code)->toBe('emirates-wide');

    app(TenantContext::class)->clear();
});

it('seeds the demonstration branch a full week with one closed day', function (): void {
    $branch = OrganisationBranch::withoutTenancy()->where('name', 'Al Quoz')->sole();

    $week = BranchOpeningHour::withoutTenancy()->where('branch_id', $branch->getKey())->orderBy('weekday')->get();

    // Seven rows, because a closed day is a row: "shut on Friday" and "nobody
    // has filled in Friday" have to stay distinguishable.
    expect($week)->toHaveCount(7)
        ->and($week->where('opens_at', null))->toHaveCount(1)
        ->and($week->firstWhere('weekday', 5)?->opens_at)->toBeNull()
        ->and($week->firstWhere('weekday', 5)?->order_cut_off_at)->toBeNull()
        ->and($week->firstWhere('weekday', 1)?->order_cut_off_at)->toBe('18:00:00');
});

it('seeds two delivery windows, one of them restricted to some weekdays', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $windows = DeliveryWindow::withoutTenancy()->where('organisation_id', $verdant->getKey())->orderBy('display_order')->get();

    expect($windows)->toHaveCount(2)
        // `[]` is every day, and it is the only encoding of that fact.
        ->and($windows->firstWhere('code', 'morning')?->weekdays)->toBe([])
        ->and($windows->firstWhere('code', 'evening')?->weekdays)->toBe([1, 2, 3, 4]);
});

it('seeds the eight platform template roles plus the platform operators bespoke role', function (): void {
    expect(Role::withoutTenancy()->whereNull('organisation_id')->count())->toBe(8);

    // The one organisation-scoped role the demo seeds: platform permissions
    // are granted deliberately, inside a platform-operator organisation, and
    // never through a template (master plan v2 §4.16).
    $bespoke = Role::withoutTenancy()->whereNotNull('organisation_id')->get();

    expect($bespoke)->toHaveCount(1)
        ->and($bespoke->first()?->code)->toBe('reference_editor');
});

it('grants the platform permissions only inside the platform operator organisation', function (): void {
    $platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();

    expect($platform->type->code)->toBe('platform_operator')
        ->and($platform->country_code)->toBe('LB')
        ->and($platform->default_currency_code)->toBe('USD')
        ->and($platform->default_language_code)->toBe('en');

    $role = Role::withoutTenancy()->where('organisation_id', $platform->getKey())->where('code', 'reference_editor')->sole();

    $codes = Permission::query()
        ->whereIn('id', RolePermission::withoutTenancy()->where('role_id', $role->getKey())->select('permission_id'))
        ->pluck('code')
        ->all();

    // Every platform code the registry declares, and only inside this
    // organisation. B1's five join the two reference codes: admitting a company
    // to trade is a platform decision by construction, because there is no
    // organisation to scope it to until the decision has been made. The final
    // backend wave adds the other end of the same relationship — the two
    // offboarding codes and the record export — plus the support authority to
    // open a customer's account closure.
    //
    // The list is written out rather than derived from `platformPermissions()`,
    // and that is the point: a code added to the registry must be added here by
    // somebody who has thought about whether a platform operator should hold it.
    expect($codes)->toEqualCanonicalizing([
        'reference.view_platform',
        'reference.manage_platform',
        'b2b_application.view_platform',
        'b2b_application.review_platform',
        'b2b_application.decide_platform',
        'b2b_application.provision_platform',
        'kyc_document.view_platform',
        'b2b_offboarding.manage_platform',
        'b2b_offboarding.waive_settlement_platform',
        'record_export.create_platform',
        'customer_account.close_platform',
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
    ]);

    $ops = User::query()->where('email', 'ops@healthy360.test')->sole();
    $membership = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $platform->getKey())
        ->where('user_id', $ops->getKey())
        ->sole();

    expect(MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->where('role_id', $role->getKey())->exists())
        ->toBeTrue();
});

it('withholds role management from the organisation administrator template', function (): void {
    $admin = Role::withoutTenancy()->whereNull('organisation_id')->where('code', 'organisation_admin')->sole();

    $codes = Permission::query()
        ->whereIn('id', RolePermission::withoutTenancy()->where('role_id', $admin->getKey())->select('permission_id'))
        ->pluck('code')
        ->all();

    expect($codes)->not->toContain('role.manage_organisation')
        ->and($codes)->toContain('role.view_organisation');
});

it('seeds the feature catalogue', function (): void {
    expect(FeatureDefinition::query()->pluck('code')->all())->toEqualCanonicalizing([
        'feature.two_factor_enforcement',
        'feature.multi_branch',
        'feature.api_access',
        'feature.audit_export',
    ])->and(FeatureDefinition::query()->where('is_active', true)->count())->toBe(4);
});

it('seeds version one of the consent texts, marked as drafts', function (): void {
    // Seven since J1: the three platform texts plus the consumer set. The list
    // is pinned rather than counted, because each addition changes what a
    // person is asked to agree to and must be a deliberate act.
    $definitions = ConsentDefinition::query()->get();

    expect($definitions->pluck('code')->all())->toEqualCanonicalizing([
        'consent.terms', 'consent.privacy', 'consent.health_data_processing',
        'consent.age_confirmation', 'consent.allergen_declaration_accuracy',
        'consent.marketing_email', 'consent.marketing_whatsapp',
    ])->and($definitions->pluck('version')->unique()->all())->toBe([1]);

    foreach ($definitions as $definition) {
        expect($definition->body_en)->toContain('Draft pending legal review')
            ->and($definition->body_ar)->not->toBe('');
    }
});

it('marks every consent text with an audience and says which ones gate a lifecycle', function (): void {
    $definitions = ConsentDefinition::query()->get()->keyBy('code');

    // Marketing is the assertion that matters: consent to be advertised at is
    // the one thing on this list that must be declinable, and a required
    // marketing text would be a contradiction in terms.
    expect($definitions['consent.terms']->audience)->toBe('all')
        ->and($definitions['consent.terms']->is_required)->toBeTrue()
        ->and($definitions['consent.age_confirmation']->audience)->toBe('d2c')
        ->and($definitions['consent.age_confirmation']->is_required)->toBeTrue()
        ->and($definitions['consent.marketing_email']->is_required)->toBeFalse()
        ->and($definitions['consent.marketing_whatsapp']->is_required)->toBeFalse();
});

it('never presents an unauthored Arabic consent body as finished copy', function (): void {
    // Legal text is not machine-translated (OQ-033). The four J1 additions
    // carry a conspicuous marker instead of a translation, and this is what
    // stops one being quietly replaced by a plausible-looking string that no
    // reviewer approved.
    $pending = ConsentDefinition::query()
        ->whereIn('code', [
            'consent.age_confirmation', 'consent.allergen_declaration_accuracy',
            'consent.marketing_email', 'consent.marketing_whatsapp',
        ])
        ->get();

    expect($pending)->toHaveCount(4);

    foreach ($pending as $definition) {
        expect($definition->body_ar)->toContain('AR PENDING');
    }
});

it('seeds the demonstration tenants in the testing environment', function (): void {
    $cedar = Organisation::query()->where('slug', 'cedar-clinic')->sole();
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    expect($cedar->country_code)->toBe('LB')
        ->and($cedar->type->code)->toBe('clinic')
        ->and($verdant->country_code)->toBe('AE')
        ->and($verdant->type->code)->toBe('kitchen')
        ->and(OrganisationBranch::withoutTenancy()->where('organisation_id', $cedar->getKey())->pluck('name')->all())
        ->toEqualCanonicalizing(['Hamra', 'Jounieh'])
        ->and(OrganisationBranch::withoutTenancy()->where('organisation_id', $verdant->getKey())->pluck('name')->all())
        ->toBe(['Al Quoz']);
});

it('gives every demonstration user a verified account and a profile', function (string $email): void {
    $user = User::query()->where('email', $email)->sole();

    expect($user->email_verified_at)->not->toBeNull()
        ->and(Hash::check('password', $user->password))->toBeTrue()
        ->and($user->profile)->not->toBeNull();
})->with([
    'owner@cedar.test',
    'dietitian@cedar.test',
    'owner@verdant.test',
    'chef@verdant.test',
    'patient@healthy360.test',
    'ops@healthy360.test',
]);

it('places the dietitian in both demonstration organisations', function (): void {
    $dietitian = User::query()->where('email', 'dietitian@cedar.test')->sole();

    $slugs = Organisation::query()
        ->whereIn('id', OrganisationMembership::withoutTenancy()->where('user_id', $dietitian->getKey())->select('organisation_id'))
        ->pluck('slug')
        ->all();

    expect($slugs)->toEqualCanonicalizing(['cedar-clinic', 'verdant-kitchen']);
});

it('scopes the demonstration chef membership to the Al Quoz branch', function (): void {
    $chef = User::query()->where('email', 'chef@verdant.test')->sole();
    $membership = OrganisationMembership::withoutTenancy()->where('user_id', $chef->getKey())->sole();

    $role = Role::withoutTenancy()
        ->whereIn('id', MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->select('role_id'))
        ->sole();

    $branch = OrganisationBranch::withoutTenancy()->whereKey($membership->branch_id)->sole();

    expect($branch->name)->toBe('Al Quoz')
        ->and($role->code)->toBe('branch_manager');
});

it('converges instead of duplicating when run a second time', function (): void {
    $counts = static fn (): array => [
        Country::query()->count(),
        Currency::query()->count(),
        MeasurementUnit::query()->count(),
        Permission::query()->count(),
        Role::withoutTenancy()->count(),
        RolePermission::withoutTenancy()->count(),
        Organisation::query()->count(),
        OrganisationBranch::withoutTenancy()->count(),
        OrganisationMembership::withoutTenancy()->count(),
        MembershipRole::withoutTenancy()->count(),
        User::query()->count(),
        Allergen::query()->count(),
        IngredientCategory::withoutTenancy()->count(),
        Ingredient::withoutTenancy()->count(),
        IngredientAlias::query()->count(),
        IngredientAllergen::withoutTenancy()->count(),
        DietClassification::query()->count(),
        ProductCategory::withoutTenancy()->count(),
        SalesChannel::withoutTenancy()->count(),
        DeliveryArea::query()->count(),
        DeliveryZone::withoutTenancy()->count(),
        DeliveryZoneArea::withoutTenancy()->count(),
        DeliveryWindow::withoutTenancy()->count(),
        BranchOpeningHour::withoutTenancy()->count(),
    ];

    $before = $counts();

    $this->seed();

    expect($counts())->toBe($before);
});

it('leaves a curated platform ingredient alone on a re-run', function (): void {
    // Insert-if-absent, not upsert: a platform operator's curation of a seeded
    // row must survive the next deployment (risk R8).
    $chickpeas = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();

    $chickpeas->name_ar = 'حمص';
    $chickpeas->notes = 'Reviewed by the platform reference editor.';
    $chickpeas->save();

    $this->seed();

    $reloaded = Ingredient::withoutTenancy()->whereKey($chickpeas->getKey())->sole();

    expect($reloaded->name_ar)->toBe('حمص')
        ->and($reloaded->notes)->toBe('Reviewed by the platform reference editor.');
});
