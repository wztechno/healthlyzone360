<?php

declare(strict_types=1);

use App\Models\User;
use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Features\Models\FeatureDefinition;
use Healthy360\Ingredients\Database\Seeders\IngredientNutritionSeeder;
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
use Healthy360\Ingredients\Services\IngredientNutritionImporter;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\CountrySeeder;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\ReferenceData\Models\Language;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Tests\SeedDatabaseOnce;

/*
|--------------------------------------------------------------------------
| Seeders
|--------------------------------------------------------------------------
|
| The seeded catalogue is a contract: reference data, the foundation
| permission set and the platform template roles are what every other module
| and the frontend permission kernel are written against.
|
| Seeded once for the whole file, not once per case (`SeedDatabaseOnce`):
| every case reads the same seeded world, and whatever a case writes —
| including a second run of a seeder — is rolled back before the next starts.
|
*/

pest()->use(SeedDatabaseOnce::class);

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
        'gallon', 'bunch', 'can', 'bag', 'bottle', 'pack',
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
        'bunch' => 'package', 'can' => 'package', 'bag' => 'package', 'bottle' => 'package', 'pack' => 'package',
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

it('seeds the thirteen platform product categories as a flat library', function (): void {
    $categories = ProductCategory::withoutTenancy()->whereNull('organisation_id')->orderBy('display_order')->get();

    // Ten, then the three the v6 workbook publishes under names the original
    // ten did not cover — its meal sheet, its beverages and its dressings.
    // "Sauce & Marinade" reuses `sauce`, which is why there are three and not
    // four. Both halves are one list in `ProductCategorySeeder`.
    expect($categories)->toHaveCount(13)
        ->and($categories->pluck('code')->all())->toBe([
            'poultry', 'meat', 'frozen', 'sauce', 'toppings',
            'oil', 'condiment', 'bread', 'dairy', 'vegetables',
            'meal', 'beverage', 'dressing',
        ])
        ->and($categories->where('is_active', false)->count())->toBe(0)
        ->and($categories->where('name_ar', '')->count())->toBe(0);
});

it('seeds the fourteen canonical allergen classes with their market metadata', function (): void {
    $classes = Allergen::query()->orderBy('display_order')->get()->keyBy('code');

    expect($classes)->toHaveCount(14)
        ->and($classes->keys()->all())->toBe([
            'gluten', 'crustaceans', 'egg', 'fish', 'peanut', 'soy', 'milk', 'tree_nut',
            'sesame', 'celery', 'mustard', 'sulphites', 'lupin', 'mollusc',
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

it('seeds the v6 platform ingredient library with its taxonomy', function (): void {
    $ingredients = Ingredient::withoutTenancy()->whereNull('organisation_id')->get();

    // 306 ingredient rows (ING-*) plus 31 packaging & disposables rows
    // (PKG-*) — non-food supplier goods that purchase and stock like any
    // other supplier good, and carry no allergens.
    expect($ingredients)->toHaveCount(337)
        ->and($ingredients->pluck('source_system')->unique()->all())->toBe(['healthy360_platform'])
        ->and($ingredients->pluck('source_ref')->unique())->toHaveCount(337)
        ->and($ingredients->whereNull('seeded_at')->count())->toBe(0)
        ->and($ingredients->where('status', IngredientStatus::Active)->count())->toBe(335)
        // The two rows the source records no Status for land inactive —
        // visible but greyed and unusable until a human decides.
        ->and($ingredients->where('status', IngredientStatus::Inactive)->pluck('source_ref')->sort()->values()->all())
        ->toBe(['ING-013', 'ING-077']);

    $packaging = $ingredients->filter(fn (Ingredient $row): bool => str_starts_with((string) $row->source_ref, 'PKG-'));

    expect($packaging)->toHaveCount(31);

    $categories = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->get();

    expect($categories)->toHaveCount(79)
        ->and($categories->whereNull('parent_id')->count())->toBe(18)
        ->and($categories->whereNotNull('parent_id')->count())->toBe(61)
        ->and($categories->where('code', 'packaging-disposables')->count())->toBe(1);

    // The v6 master carries no duplicate rows, so no aliases are seeded.
    expect(IngredientAlias::query()->where('source_system', 'healthy360_platform')->count())->toBe(0);
});

it('seeds the platform allergen baseline exactly as the source records it', function (): void {
    $mappings = IngredientAllergen::withoutTenancy()->whereNull('organisation_id')->get();

    expect($mappings)->toHaveCount(133)
        ->and($mappings->pluck('source')->unique()->all())->toBe([AllergenMappingSource::MasterList])
        ->and($mappings->countBy(fn (IngredientAllergen $row): string => $row->allergen_code)->sortKeys()->all())
        ->toBe([
            'celery' => 6, 'crustaceans' => 3, 'egg' => 7, 'fish' => 7, 'gluten' => 27,
            'lupin' => 1, 'milk' => 29, 'mustard' => 5, 'peanut' => 2,
            'sesame' => 4, 'soy' => 8, 'sulphites' => 21, 'tree_nut' => 13,
        ]);

    // Coconut is a tree nut under US law and not an EU allergen. The v6
    // sheet marks its three coconut rows with the * convention.
    $usOnly = $mappings->where('market_scope', AllergenMarketScope::UsOnly);

    expect($usOnly)->toHaveCount(3)
        ->and($usOnly->pluck('allergen_code')->unique()->all())->toBe(['tree_nut']);

    // The ~ convention — "possible in vinegar, dried fruit… verify per
    // supplier" — is a possibility, not a determination, on both axes.
    $sulphites = $mappings->where('allergen_code', 'sulphites');

    expect($sulphites->pluck('containment')->unique()->all())->toBe([AllergenContainment::MayContain])
        ->and($sulphites->pluck('verification_status')->unique()->all())
        ->toBe([AllergenVerificationStatus::RequiresSupplierConfirmation]);

    // Soya sauce carries both classes the source names for it.
    $soyaSauce = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'soya-sauce')->sole();

    expect($mappings->where('ingredient_id', $soyaSauce->getKey())->pluck('allergen_code')->sort()->values()->all())
        ->toBe(['gluten', 'soy']);
});

it('records the burghul and pita gluten declarations the v6 source resolved', function (): void {
    // The v1 workbook contradicted itself about these two rows (class
    // "None" beside an allergen key naming them under Cereals/Gluten). The
    // v6 source declares the gluten outright, so nothing is quarantined —
    // but the declarations themselves are pinned so a regression to the
    // silent reading cannot pass unnoticed.
    expect(Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('verification_status', IngredientVerificationStatus::RequiresReview)
        ->count())->toBe(0);

    foreach (['burghul-bulgur', 'pita-bread'] as $slug) {
        $ingredient = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', $slug)->sole();

        expect(IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->pluck('allergen_code')
            ->all())->toBe(['gluten'], $slug);
    }
});

it('falls back to the English name where the source has no Arabic', function (): void {
    // The ingredient workbook is English-only; a machine translation of a
    // food name that ends up on an allergen label is not an improvement.
    $fallbacks = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->whereColumn('name_ar', 'name_en')
        ->count();

    expect($fallbacks)->toBe(337);
});

it('fills per-100 g nutrition for every platform food row and no packaging', function (): void {
    $rows = Ingredient::withoutTenancy()->whereNull('organisation_id')->get();

    $food = $rows->filter(fn (Ingredient $row): bool => str_starts_with((string) $row->source_ref, 'ING-'));
    $packaging = $rows->filter(fn (Ingredient $row): bool => str_starts_with((string) $row->source_ref, 'PKG-'));

    // The owner's table covers the 306 food rows and nothing else. A bin
    // liner has no nutrition, and inventing a zero for it would make it
    // countable in a roll-up.
    expect($food->whereNotNull('nutrition_per_100g'))->toHaveCount(306)
        ->and($packaging->whereNotNull('nutrition_per_100g'))->toHaveCount(0);

    $baking = $food->firstWhere('source_ref', 'ING-001');
    $amounts = collect($baking->nutrition_per_100g['amounts'])->keyBy('nutrient_id');

    expect($amounts['energy']['value'])->toBe(53)
        ->and($amounts['sodium']['value'])->toBe(10600)
        ->and($amounts['carbohydrate']['value'])->toBe(28.1);
});

it('writes every nutrition envelope on the per-100 g basis with the seven canonical nutrients', function (): void {
    // The completeness contract the recipe roll-up reads against: an
    // ingredient missing one of these, or stating energy in kJ, is unusable
    // rather than partially usable. Pinned here because the seeder is what
    // puts 306 rows on the right side of it.
    $canonical = [
        ['nutrient_id' => 'energy', 'unit' => 'kcal'],
        ['nutrient_id' => 'protein', 'unit' => 'g'],
        ['nutrient_id' => 'carbohydrate', 'unit' => 'g'],
        ['nutrient_id' => 'fat', 'unit' => 'g'],
        ['nutrient_id' => 'fibre', 'unit' => 'g'],
        ['nutrient_id' => 'sugars', 'unit' => 'g'],
        ['nutrient_id' => 'sodium', 'unit' => 'mg'],
    ];

    $offenders = [];

    foreach (Ingredient::withoutTenancy()->whereNull('organisation_id')->whereNotNull('nutrition_per_100g')->get() as $row) {
        $envelope = $row->nutrition_per_100g;
        $pairs = array_map(
            static fn (array $amount): array => ['nutrient_id' => $amount['nutrient_id'], 'unit' => $amount['unit']],
            $envelope['amounts'],
        );

        if (($envelope['basis'] ?? null) !== 'per_100g' || $pairs !== $canonical) {
            $offenders[] = (string) $row->source_ref;
        }
    }

    expect($offenders)->toBe([]);
});

it('seeds a density for the thirteen rows stocked by the litre, and for nothing else', function (): void {
    $withDensity = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->whereNotNull('grams_per_unit')
        ->with('defaultUnit')
        ->get();

    $byUnit = $withDensity
        ->groupBy(fn (Ingredient $row): string => (string) $row->defaultUnit?->code)
        ->map->count()
        ->sortKeys()
        ->all();

    // Thirteen, all poured. The owner's September unit table put every platform
    // ingredient on kilograms or litres, and a density is only ever asked of the
    // thirteen the kitchen pours — a mass row converts arithmetically, so a
    // density on one would be a second, redundant and silently disagreeing
    // source of truth.
    //
    // There is no longer a row counted by the piece. Eggs were the only one, and
    // their 50 g USDA figure was not lost when they moved to mass: it is what the
    // migration converts existing `4 piece` recipe lines with.
    expect($withDensity)->toHaveCount(13)
        ->and($byUnit)->toBe(['l' => 13])
        ->and($withDensity->firstWhere('source_ref', 'ING-026')?->grams_per_unit)->toBe('1080.0000');

    // The count above is the coarse half of this. `PlatformUnitNormalisationTest`
    // holds the rule it stands for — every `l` row carries a density and every
    // `kg` row carries none — which is count-free and so cannot go stale the way
    // a hard-coded twenty did.
    $mass = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('source_ref', 'ING-007')->sole();

    expect($mass->grams_per_unit)->toBeNull();
});

it('stamps every seeded row with a fingerprint of the figures it wrote', function (): void {
    // What `--overwrite` reads, and therefore what it is safe to run at all: a
    // row whose stored hash still describes its own values is the importer's to
    // rewrite, and one whose hash has stopped matching belongs to whoever
    // edited it. A seeding that stamped nothing, or stamped the wrong form,
    // would make every row look curated on the next run — which fails silently,
    // by doing nothing, and so is pinned here rather than left to be noticed.
    //
    // Both sides read the row through the model, because that is the contract
    // `fingerprint()` states: `jsonb` hands the envelope's keys back in its own
    // order, and the canonical form inside the hash is what makes the order
    // stop mattering.
    $offenders = [];

    foreach (Ingredient::withoutTenancy()->whereNull('organisation_id')->whereNotNull('nutrition_per_100g')->get() as $row) {
        $expected = IngredientNutritionImporter::fingerprint($row->nutrition_per_100g, $row->grams_per_unit);

        if ($row->nutrition_seed_fingerprint !== $expected) {
            $offenders[] = (string) $row->source_ref;
        }
    }

    expect($offenders)->toBe([]);
});

it('keeps the nutrition document and the ingredient library in step', function (): void {
    $document = json_decode(
        (string) file_get_contents(
            base_path('app-modules/ingredients/database/data/platform-ingredient-nutrition.json')
        ),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    $rows = $document['ingredients'];
    $library = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', 'like', 'ING-%')
        ->with('defaultUnit')
        ->get()
        ->keyBy('source_ref');

    expect($document['basis'])->toBe('per_100g')
        ->and($rows)->toHaveCount(306)
        ->and(array_unique(array_column($rows, 'source_ref')))->toHaveCount(306)
        ->and(array_diff(array_column($rows, 'source_ref'), $library->keys()->all()))->toBe([]);

    $mismatches = [];

    foreach ($rows as $row) {
        $ingredient = $library[$row['source_ref']];

        if ($ingredient->name_en !== $row['name_en']) {
            $mismatches[] = $row['source_ref'].': name';
        }

        foreach (['energy_kcal', 'protein_g', 'carbohydrate_g', 'fat_g', 'fibre_g', 'sugars_g', 'sodium_mg'] as $key) {
            if (! is_numeric($row[$key]) || $row[$key] < 0) {
                $mismatches[] = $row['source_ref'].': '.$key;
            }
        }

        // The density is stated against a named unit, and the seeder writes it
        // only while the row still stocks in that unit. If the document and
        // the library disagreed on every one of the thirteen, the seeder would be
        // a silent no-op rather than a failure.
        if (isset($row['grams_per_unit_of']) && $ingredient->defaultUnit?->code !== $row['grams_per_unit_of']) {
            $mismatches[] = $row['source_ref'].': unit';
        }
    }

    expect($mismatches)->toBe([]);
});

it('carries the source flag and note onto every row whose facts it wrote', function (): void {
    // The 56 estimated rows are the whole point of these two columns: the
    // document's own notice tells a kitchen to replace one with a supplier's
    // label before it reaches a printed panel, and that is an instruction
    // nothing could act on while the flag stayed in the file. What is pinned
    // here is that the flag and the sentence beside it reached the row that
    // the figures they describe reached.
    $document = json_decode(
        (string) file_get_contents(
            base_path('app-modules/ingredients/database/data/platform-ingredient-nutrition.json')
        ),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    /** @var array<string, array<string, mixed>> $rows */
    $rows = collect($document['ingredients'])->keyBy('source_ref')->all();

    // Counted from the file, never written down. The number moves the next time
    // the owner sends a revised table, and a hard-coded 56 would then fail for
    // the one reason that is not a bug. The floor below is what stops the
    // whole assertion collapsing into a tautology if the flag ever stops being
    // parsed and every row reads `false`.
    $estimatedInDocument = count(array_filter(
        $rows,
        static fn (array $row): bool => ($row['estimated'] ?? false) === true,
    ));

    expect($estimatedInDocument)->toBeGreaterThan(0);

    $library = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', 'like', 'ING-%')
        ->get();

    $offenders = [];

    foreach ($library as $row) {
        $sourceRef = (string) $row->source_ref;
        $expectedFlag = ($rows[$sourceRef]['estimated'] ?? false) === true;
        $note = $rows[$sourceRef]['note'] ?? null;
        $expectedNote = is_string($note) && trim($note) !== '' ? trim($note) : null;

        if ($row->nutrition_estimated !== $expectedFlag) {
            $offenders[] = $sourceRef.': flag';
        }

        if ($row->nutrition_note !== $expectedNote) {
            $offenders[] = $sourceRef.': note';
        }
    }

    // Strict comparisons throughout: `null == false` in PHP, so a column the
    // seeder never touched would pass a loose count of the declared rows.
    $flags = $library->map(static fn (Ingredient $row): ?bool => $row->nutrition_estimated);

    expect($offenders)->toBe([])
        ->and($flags->filter(static fn (?bool $flag): bool => $flag === true))->toHaveCount($estimatedInDocument)
        ->and($flags->filter(static fn (?bool $flag): bool => $flag === false))->toHaveCount(306 - $estimatedInDocument)
        ->and($flags->filter(static fn (?bool $flag): bool => $flag === null))->toHaveCount(0)
        ->and($library->filter(static fn (Ingredient $row): bool => $row->nutrition_note === null))->toHaveCount(0);
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
    //
    // INV1.0 adds three: the `inventory.*` domain — a view and a manage code
    // for the kitchen operating surface that used to piggyback `catalogue.*`,
    // and `inventory.view_costs_organisation`, which gates the money INV1.1 and
    // INV1.2 add and is wired in now so a role can hold it before an endpoint
    // spends it.
    //
    // The count is 51, not 48, because the B5 quotation pair
    // (`b2b_quotation.view_organisation` / `.quote_organisation`) and one
    // platform code had already been added to the registry without this pin
    // being refreshed — the registry stood at 48 before INV1.0, and the three
    // inventory codes take it to 51. Re-pinned to the registry's actual size.
    //
    // C2 (the order desk) takes it to 54 with three organisation codes, and the
    // shape of that trio is the argument for all three:
    // `order.view_customer_contact_organisation` adds two fields to a queue row
    // and permits no action at all; `order.create_on_behalf_organisation` is the
    // authority to place an order nobody asked for themselves, bypassing the
    // activation checklist because the member of staff is the verification; and
    // `customer.create_on_behalf_organisation` — the first `customer.*`
    // organisation code on the platform — opens the account a cold caller has no
    // way to open. Selling to somebody and adding them to the file are separate
    // authorities, which is why the last two are two codes and not one.
    //
    // SUP3 takes it to 55 with `inventory.order_supplies_organisation`, the
    // fourth inventory code. It is one code and not two because preparing a
    // supply order and issuing it are one job done by one person — but it is a
    // *separate* code from `inventory.manage_organisation` because booking a
    // delivery that arrived and committing the kitchen's money to the next one
    // are not. It gates reads as well as writes: the order book names who the
    // kitchen buys from and in what quantity, which the plain view code has no
    // business exposing.
    //
    // PROD1 takes it to 58 with a `production` domain of its own — view, manage
    // and view_costs. A domain rather than a fifth inventory code, because a
    // production order stopped being a row with a status: it claims stock in
    // advance, carries an estimated cost and blends a finished valuation into the
    // basis every sale is costed against. Whoever may count a shelf is not
    // thereby whoever may commit next Thursday's oil to a batch.
    expect(Permission::query()->count())->toBe(58)
        ->and(Permission::query()->pluck('code')->all())
        ->toEqualCanonicalizing(PermissionRegistry::codes());
});

it('seeds every template role with exactly the grants the registry declares', function (): void {
    // Who holds what is pinned, hard-coded, in `PermissionRegistryTest`: the
    // role list, each role's grant count and the holders of every code a role
    // split turns on. What this pins is the copy — every template role present
    // and system-owned, holding the registry's list and nothing else, because
    // `TemplateRoleSeeder` reconciles stale grants away. Compared in full rather
    // than counted, so a seeder that wrote the right number of wrong codes still
    // fails (D-141).
    $templates = PermissionRegistry::templateRoles();
    $roles = Role::withoutTenancy()->whereNull('organisation_id')->get()->keyBy('code');

    expect($roles->keys()->all())->toEqualCanonicalizing(array_keys($templates));

    foreach ($templates as $code => $template) {
        $granted = Permission::query()
            ->whereIn('id', RolePermission::withoutTenancy()->where('role_id', $roles[$code]->getKey())->select('permission_id'))
            ->pluck('code')
            ->all();

        expect($roles[$code]->is_system)->toBeTrue()
            ->and($granted)->toEqualCanonicalizing($template['permissions'], "Template role {$code} drifted from the registry.");
    }
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
        // PA1. The tenant-lifecycle console: create a kitchen, invite and
        // revoke its owners, suspend and reactivate it. Yes, a platform
        // operator should hold this — it is the job the role exists for.
        'organisation.manage_platform',
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
        // INV1.0. The kitchen operating surface moved to its own domain, so the
        // platform operator's bespoke curation role gains the three inventory
        // codes alongside the catalogue pair.
        'inventory.view_organisation',
        'inventory.manage_organisation',
        'inventory.view_costs_organisation',
    ]);

    // The way in. Not a demo account: `PlatformOperatorSeeder` runs whether or
    // not the demo world does, so a reset still leaves somebody able to sign in.
    $ops = User::query()->where('email', 'ops@healthy360.test')->sole();

    expect($ops->email_verified_at)->not->toBeNull()
        ->and(Hash::check('password', $ops->password))->toBeTrue()
        ->and($ops->profile)->not->toBeNull();

    $membership = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $platform->getKey())
        ->where('user_id', $ops->getKey())
        ->sole();

    expect(MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->where('role_id', $role->getKey())->exists())
        ->toBeTrue();

    // And the only organisation-scoped role any seeder writes: platform codes
    // are granted deliberately, inside a platform-operator organisation, and
    // never through a template (master plan v2 §4.16).
    expect(Role::withoutTenancy()->whereNotNull('organisation_id')->pluck('code')->all())->toBe(['reference_editor']);
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
        // The purchasing configuration SUP8 added to the demonstration world.
        // Contacts key on (supplier, name) and links on (supplier, item), so a
        // second run finds both and writes neither — the counts are here because
        // that is a property of the seeder, not of the keys it happens to use.
        Supplier::withoutTenancy()->count(),
        SupplierContact::withoutTenancy()->count(),
        SupplierStockItem::withoutTenancy()->count(),
        StockItem::withoutTenancy()->count(),
        StockLevel::withoutTenancy()->count(),
        // Nutrition and densities are filled rather than inserted, so a
        // duplicate would show up as a *changed* count only if the fill-empty
        // predicate stopped holding — which is the failure worth catching.
        Ingredient::withoutTenancy()->whereNotNull('nutrition_per_100g')->count(),
        Ingredient::withoutTenancy()->whereNotNull('grams_per_unit')->count(),
    ];

    $before = $counts();

    $this->seed();

    expect($counts())->toBe($before);
});

it('leaves a curated platform ingredient alone on a re-run', function (): void {
    // Insert-if-absent, not upsert: a platform operator's curation of a seeded
    // row must survive the next deployment (risk R8). Re-run through the kitchen
    // reference layer alone — `IngredientMasterSeeder` is the only writer of
    // these rows, and the full seed would only add the demo world around it.
    $chickpeas = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();

    $chickpeas->name_ar = 'حمص';
    $chickpeas->notes = 'Reviewed by the platform reference editor.';
    $chickpeas->save();

    $this->seed(KitchenReferenceSeeder::class);

    $reloaded = Ingredient::withoutTenancy()->whereKey($chickpeas->getKey())->sole();

    expect($reloaded->name_ar)->toBe('حمص')
        ->and($reloaded->notes)->toBe('Reviewed by the platform reference editor.');
});

it('leaves curated ingredient nutrition and densities alone on a re-run', function (): void {
    // Fill-empty, per column, independently (risk R8). A kitchen that has
    // replaced a generic figure with its supplier's label, or weighed one of
    // the piece rows the document has no mass for, must not lose it to the
    // next deployment.
    $curated = ['basis' => 'per_100g', 'amounts' => [['nutrient_id' => 'energy', 'unit' => 'kcal', 'value' => 1]]];

    $baking = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('source_ref', 'ING-001')->sole();
    $baking->nutrition_per_100g = $curated;
    $baking->save();

    $soySauce = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('source_ref', 'ING-026')->sole();
    $soySauce->grams_per_unit = '999';
    $soySauce->save();

    // A mass row the document has no density for: the kitchen put it there.
    $croutons = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('source_ref', 'ING-007')->sole();
    $croutons->grams_per_unit = '42';
    $croutons->save();

    $this->seed(IngredientNutritionSeeder::class);

    $reload = static fn (string $ref): Ingredient => Ingredient::withoutTenancy()
        ->whereNull('organisation_id')->where('source_ref', $ref)->sole();

    // Compared by content rather than identity: jsonb hands back an object's
    // keys in its own order, so a strict array comparison would be asserting
    // PostgreSQL's storage layout. The seeder's envelope has seven amounts and
    // an energy of 53 — one amount of 1 kcal is unmistakably the curated one.
    expect($reload('ING-001')->nutrition_per_100g['amounts'])->toHaveCount(1)
        ->and($reload('ING-001')->nutrition_per_100g['amounts'][0]['value'])->toBe(1)
        ->and($reload('ING-026')->grams_per_unit)->toBe('999.0000')
        ->and($reload('ING-007')->grams_per_unit)->toBe('42.0000');
});

it('does not restore a density after the default unit changed', function (): void {
    // The figure is grams per one *default unit*. Re-stocking soya sauce by
    // the millilitre makes 1080 wrong by a factor of a thousand, and a wrong
    // density looks exactly like a right one. So the row is skipped, counted
    // and reported — never relabelled.
    $soySauce = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('source_ref', 'ING-026')->sole();
    $soySauce->default_unit_id = MeasurementUnit::query()->where('code', 'ml')->value('id');
    $soySauce->grams_per_unit = null;
    $soySauce->save();

    $this->artisan('db:seed', ['--class' => IngredientNutritionSeeder::class])
        ->expectsOutputToContain('0 densities written, 1 skipped')
        ->assertSuccessful();

    expect(Ingredient::withoutTenancy()->whereKey($soySauce->getKey())->sole()->grams_per_unit)->toBeNull();
});

it('marks dependants stale when it fills facts used by a published version', function (): void {
    // A published version's derived figures are only as good as the ingredient
    // facts behind them, so filling a blank is a change that has to reach
    // them. The ingredient is a platform row, so the marking crosses into the
    // kitchen's own context rather than happening in the console's.
    Queue::fake();

    $soySauce = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('source_ref', 'ING-026')->sole();
    $soySauce->nutrition_per_100g = null;
    $soySauce->grams_per_unit = null;
    $soySauce->save();

    $organisation = RecipeWorld::organisation();
    $recipe = Recipe::factory()->create(['organisation_id' => $organisation->getKey()]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisation->getKey(),
    ]);

    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $organisation->getKey(),
        'ingredient_id' => $soySauce->getKey(),
    ]);

    $this->seed(IngredientNutritionSeeder::class);

    expect(RecipeVersion::withoutTenancy()->whereKey($version->getKey())->sole()->derivation_state)
        ->toBe(DerivationState::Stale);

    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);
});
