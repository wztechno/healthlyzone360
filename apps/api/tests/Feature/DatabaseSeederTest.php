<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Consent\Models\ConsentDefinition;
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
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Database\Seeders\CountrySeeder;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\ReferenceData\Models\Language;
use Healthy360\ReferenceData\Models\MeasurementUnit;
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
    // permission K1.3 splits out of them, and the catalogue publication
    // authority K1.4 adds.
    expect(Permission::query()->count())->toBe(29)
        ->and(Permission::query()->pluck('code')->all())
        ->toEqualCanonicalizing(PermissionRegistry::codes());
});

it('keeps the platform permissions out of every organisation template role', function (): void {
    $platformIds = Permission::query()
        ->whereIn('code', array_keys(PermissionRegistry::platformPermissions()))
        ->pluck('id');

    expect($platformIds)->toHaveCount(2)
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
    'organisation owner grants every organisation permission' => ['organisation_owner', 27],
    'organisation administrator cannot manage roles' => ['organisation_admin', 26],
    'branch manager is limited to its branch and roster' => ['branch_manager', 3],
    'member holds the organisation view plus the own-scope permissions' => ['member', 7],
    'kitchen manager runs the catalogue, publishes it and its recipes, and sees their costs' => ['kitchen_manager', 10],
    'chef edits recipes and their costs but never publishes one' => ['kitchen_chef', 5],
    'kitchen staff read the catalogue and recipes, and no costs at all' => ['kitchen_staff', 2],
    'commercial manager reads the catalogue and its costs, and decides the range' => ['commercial_manager', 4],
]);

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

it('gives the demonstration kitchen its two routes to market', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $channels = SalesChannel::withoutTenancy()->where('organisation_id', $verdant->getKey())->orderBy('code')->get();

    expect($channels->pluck('code')->all())->toBe(['web-shop', 'wholesale'])
        ->and($channels->pluck('channel_kind')->map(static fn ($kind): string => $kind->value)->all())
        ->toBe(['b2c_web', 'b2b']);
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

    expect($codes)->toEqualCanonicalizing([
        'reference.view_platform',
        'reference.manage_platform',
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
    $definitions = ConsentDefinition::query()->get();

    expect($definitions->pluck('code')->all())->toEqualCanonicalizing([
        'consent.terms', 'consent.privacy', 'consent.health_data_processing',
    ])->and($definitions->pluck('version')->unique()->all())->toBe([1]);

    foreach ($definitions as $definition) {
        expect($definition->body_en)->toContain('Draft pending legal review')
            ->and($definition->body_ar)->not->toBe('');
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
