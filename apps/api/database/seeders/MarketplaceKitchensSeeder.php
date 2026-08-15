<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Closure;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\CatalogueStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Services\MarketplaceAvailability;
use Healthy360\Kitchens\Services\MarketplaceChannels;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationCapability;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * The five preview marketplace kitchens beside Verdant, and the meals the
 * customer prototype always showed under them.
 *
 * ## Why a second kitchen seeder exists at all
 *
 * `DemoTenantSeeder` builds one kitchen very carefully: a draft tariff, a plan
 * one price short of publishable, a placeholder row. That world is exactly
 * right for proving gates and exactly wrong for proving a *marketplace*, which
 * is a page of several kitchens a customer chooses between. The customer app
 * carried that page as a TypeScript fixture; this seeder is where that fixture
 * lands in the database, so an API-mode build and a mock build show the same
 * six kitchens rather than two different worlds.
 *
 * ## What "the same world" costs, and why the gates are still honoured
 *
 * Nothing here writes `status = published` on its own authority. Every
 * relocated meal is handed to {@see CatalogueItemReadiness} and published only
 * when it reports no reasons at all — the rule `seedVerdantMenu` follows, for
 * the reason it follows it. A seeder that published past the gate would be
 * manufacturing the one state the whole publication apparatus exists to make
 * impossible.
 *
 * Opening hours are **mandatory**, not decorative:
 * {@see MarketplaceAvailability} derives the
 * fortnight of ordering calendar from `branch_opening_hours` alone, so a branch
 * with no rows publishes fourteen unavailable days and the kitchen looks shut.
 * Every branch therefore gets a full seven-day week, with a closed day written
 * as a row carrying no times — the distinction `DemoTenantSeeder` insists on
 * between "we are shut" and "nobody has said".
 *
 * ## Geography
 *
 * The fixture zones name Emirati places, most of which `DemoTenantSeeder`
 * already invented as `ae-demo-*` demonstration areas. The rest are added here
 * with the same prefix and for the same reason: they are mechanism (b), demo
 * data, never the committed Lebanese gazetteer, and the prefix is what says so
 * at a glance to a reader and to `DatabaseSeederTest`'s exclusions.
 *
 * ## Two kitchens sell nothing, on purpose
 *
 * `northwind-provisions` runs a wholesale desk and a corporate arrangement;
 * `olive-terrace-counter` runs a till. Neither kind is a listing channel
 * ({@see MarketplaceChannels::listingKinds()}),
 * so neither gets a public tariff or a single meal. They exist to prove that a
 * kitchen with no consumer route to market still appears on the directory with
 * an empty menu, which is the honest answer and the one a filter bar is written
 * against.
 *
 * Guarded to local and testing, like every other demo seeder: these accounts
 * share one well-known password and must never reach a deployed environment.
 */
class MarketplaceKitchensSeeder extends Seeder
{
    private const string DEMO_PASSWORD = 'password';

    /**
     * The code of the one active public tariff a preview kitchen sells on.
     * `MarketplacePlansSeeder` prices its plans onto the same list rather than
     * opening a second one: a kitchen's public tariff is a single commercial
     * statement, and two of them would only raise the question of which quotes.
     */
    public const string MENU_PRICE_LIST_SUFFIX = '-menu-usd';

    /** The fixture the customer prototype's kitchen list was ported into. */
    private const string KITCHEN_FIXTURE = 'seeders/fixtures/prototype_marketplace_kitchens.php';

    /** The fixture every preview meal was ported into, kitchen by kitchen. */
    private const string MEAL_FIXTURE = 'seeders/fixtures/prototype_marketplace_meals.php';

    /**
     * Arabic names for the demonstration areas the fixture zones need and
     * `DemoTenantSeeder` has not already invented, with the display order each
     * takes in the gazetteer behind that seeder's six.
     *
     * Hand-authored, never machine-translated: an Arabic place name that
     * reaches a delivery address has to be one a person wrote (master plan v2
     * §4.18).
     *
     * @var array<string, array{string, int}>
     */
    private const array PREVIEW_AREAS = [
        'Jumeirah 1' => ['جميرا ١', 7],
        'Downtown' => ['وسط المدينة', 8],
        'Dubai Marina' => ['مرسى دبي', 9],
        'Dubai Industrial City' => ['مدينة دبي الصناعية', 10],
        'Sharjah' => ['الشارقة', 11],
    ];

    /**
     * Arabic names for the fixture's delivery zones — a kitchen's own
     * commercial statement about a set of areas, and its own words for it, so
     * these are authored rather than borrowed from the area beneath them.
     *
     * @var array<string, string>
     */
    private const array ZONE_NAMES_AR = [
        'Jumeirah coast' => 'ساحل جميرا',
        'Downtown ring' => 'حلقة وسط المدينة',
        'Marina and beachfront' => 'المرسى والواجهة البحرية',
        'Al Barsha and Tecom' => 'البرشاء والتيكوم',
        'Deira and Al Nahda' => 'ديرة والنهدة',
        'Business Bay' => 'الخليج التجاري',
        'Industrial corridor' => 'الممر الصناعي',
        'Northern emirates' => 'الإمارات الشمالية',
    ];

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('MarketplaceKitchensSeeder skipped: preview kitchens are seeded in local and testing environments only.');

            return;
        }

        /** @var list<array<string, mixed>> $kitchens */
        $kitchens = require database_path(self::KITCHEN_FIXTURE);

        /** @var list<array<string, mixed>> $meals */
        $meals = require database_path(self::MEAL_FIXTURE);

        $this->retireRelocatedVerdantMeals($meals);

        foreach ($kitchens as $fixture) {
            $this->seedKitchen($fixture, $this->mealsOwnedBy($meals, (string) $fixture['slug']));
        }
    }

    /**
     * Every fixture meal a given kitchen owns.
     *
     * @param  list<array<string, mixed>>  $meals
     * @return list<array<string, mixed>>
     */
    private function mealsOwnedBy(array $meals, string $kitchenSlug): array
    {
        return array_values(array_filter(
            $meals,
            static fn (array $meal): bool => $meal['kitchen_slug'] === $kitchenSlug,
        ));
    }

    /**
     * The legacy sweep, and it must run before anything is placed elsewhere.
     *
     * Until the fixture learned which kitchen each meal belongs to,
     * `seedVerdantMenu` seeded **all** of them under Verdant. Those rows are
     * slug-unique per organisation, so the same slug can legitimately exist
     * under two kitchens and nothing collides — but a reseed in place would
     * otherwise leave twenty-six duplicates published on the marketplace, one
     * under Verdant and one under the kitchen that actually cooks it.
     *
     * Retired rather than deleted: `price_list_items` points at a catalogue
     * item with `restrictOnDelete`, and a retired listing is exactly what the
     * sellable family means by "withdrawn for good" — the row keeps its
     * history instead of vanishing from under a price somebody agreed.
     *
     * @param  list<array<string, mixed>>  $meals
     */
    private function retireRelocatedVerdantMeals(array $meals): void
    {
        $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->first();

        if (! $verdant instanceof Organisation) {
            return;
        }

        $relocated = array_values(array_map(
            static fn (array $meal): string => (string) $meal['slug'],
            array_filter($meals, static fn (array $meal): bool => $meal['kitchen_slug'] !== 'verdant-kitchen'),
        ));

        if ($relocated === []) {
            return;
        }

        $stale = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->whereIn('slug', $relocated)
            ->where('status', '!=', CatalogueItemStatus::Retired->value)
            ->get();

        foreach ($stale as $item) {
            $item->forceFill(['status' => CatalogueItemStatus::Retired])->save();
        }
    }

    /**
     * @param  array<string, mixed>  $fixture
     * @param  list<array<string, mixed>>  $meals
     */
    private function seedKitchen(array $fixture, array $meals): void
    {
        $slug = (string) $fixture['slug'];
        $name = (string) $fixture['name'];

        $owner = $this->owner($slug, $name);
        $kitchen = $this->organisation($fixture, $owner);

        $this->capability($kitchen, $owner);
        $this->membership($kitchen, $owner);

        /** @var list<array{code: string, kind: string}> $channelFixtures */
        $channelFixtures = $fixture['channels'];
        $channels = $this->salesChannels($kitchen, $channelFixtures, $owner);

        /** @var list<array<string, mixed>> $branchFixtures */
        $branchFixtures = $fixture['branches'];

        foreach ($branchFixtures as $branchFixture) {
            $this->branchWithWeek($kitchen, $branchFixture, $owner);
        }

        /** @var list<array<string, mixed>> $zoneFixtures */
        $zoneFixtures = $fixture['zones'];
        $this->deliveryMap($kitchen, $zoneFixtures, $owner);

        /** @var list<array<string, mixed>> $windowFixtures */
        $windowFixtures = $fixture['delivery_windows'];

        foreach ($windowFixtures as $window) {
            $this->deliveryWindow($kitchen, $window, $owner);
        }

        $catalogue = $this->catalogue($kitchen, $owner);

        // The consumer route to market decides everything below it: a kitchen
        // with no listing channel has nothing to price a meal on and no channel
        // to offer it through, so it gets neither.
        $webShop = $channels[SalesChannelKind::B2cWeb->value] ?? null;

        if (! $webShop instanceof SalesChannel) {
            return;
        }

        $marketplace = $channels[SalesChannelKind::Marketplace->value] ?? null;

        $this->forOrganisation((string) $kitchen->getKey(), function () use ($kitchen, $catalogue, $webShop, $marketplace, $meals, $owner): void {
            $menu = $this->publicTariff($kitchen, $owner);

            ChannelPriceList::withoutTenancy()->updateOrCreate(
                ['sales_channel_id' => $webShop->getKey(), 'price_list_id' => $menu->getKey()],
                ['organisation_id' => $kitchen->getKey(), 'priority' => 0, 'created_by' => $owner->getKey()],
            );

            $this->seedMenu($kitchen, $catalogue, $menu, $webShop, $marketplace, $meals, $owner);
        });
    }

    /**
     * The kitchen's owner: one identity, verified, with the profile shape every
     * other demonstration user carries.
     *
     * The display name is the kitchen's rather than an invented person's. These
     * are five accounts that exist to own five tenants, and "The Daily Pot
     * Owner" is what a workspace picker should say about one — a fabricated
     * Emirati name would read as a real person who never agreed to be one.
     */
    private function owner(string $slug, string $kitchenName): User
    {
        $email = 'owner@'.$slug.'.test';

        $user = User::query()->firstOrNew(['email' => $email]);
        $user->password = self::DEMO_PASSWORD;
        $user->email_verified_at = now();
        $user->save();

        UserProfile::query()->updateOrCreate(
            ['user_id' => $user->getKey()],
            [
                'given_name' => $kitchenName,
                'family_name' => 'Owner',
                'preferred_language_code' => 'en',
                'country_code' => 'AE',
                'timezone' => 'Asia/Dubai',
                'numbering_system' => 'latn',
                'created_by' => $user->getKey(),
            ],
        );

        return $user;
    }

    /**
     * @param  array<string, mixed>  $fixture
     */
    private function organisation(array $fixture, User $owner): Organisation
    {
        $type = OrganisationType::query()->where('code', 'kitchen')->firstOrFail();

        return Organisation::query()->updateOrCreate(
            ['slug' => (string) $fixture['slug']],
            [
                'organisation_type_id' => $type->getKey(),
                'name' => (string) $fixture['name'],
                'country_code' => (string) $fixture['country_code'],
                'default_currency_code' => (string) $fixture['currency_code'],
                'default_language_code' => 'ar',
                'status' => OrganisationStatus::Active,
                'created_by' => $owner->getKey(),
            ],
        );
    }

    private function capability(Organisation $kitchen, User $owner): void
    {
        OrganisationCapability::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'capability' => 'kitchen_production'],
            ['is_enabled' => true, 'created_by' => $owner->getKey()],
        );
    }

    /**
     * The owner's membership, carrying both template roles Verdant's owner
     * holds: `organisation_owner` for the tenant and `kitchen_manager` for the
     * catalogue that hangs off it.
     */
    private function membership(Organisation $kitchen, User $owner): void
    {
        $membership = $this->forOrganisation((string) $kitchen->getKey(), fn (): OrganisationMembership => OrganisationMembership::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'user_id' => $owner->getKey()],
            [
                'branch_id' => null,
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $owner->getKey(),
            ],
        ));

        foreach (['organisation_owner', 'kitchen_manager'] as $code) {
            $role = Role::withoutTenancy()
                ->whereNull('organisation_id')
                ->where('code', $code)
                ->firstOrFail();

            MembershipRole::withoutTenancy()->updateOrCreate(
                ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
                ['organisation_id' => $kitchen->getKey(), 'created_by' => $owner->getKey()],
            );
        }
    }

    /**
     * The kitchen's routes to market, keyed by kind so the caller can ask for
     * the consumer one without re-querying.
     *
     * `order_source` mirrors what `KitchenProvisioning` writes for a web shop
     * (`web`) and extends the same idea to the two other kinds that have a
     * recognisable arrival label. A wholesale desk and a corporate arrangement
     * carry none: orders reach them by agreement rather than through a system
     * that labels itself, which is why `DemoTenantSeeder` leaves Verdant's
     * wholesale channel null too.
     *
     * @param  list<array{code: string, kind: string}>  $fixtures
     * @return array<string, SalesChannel>
     */
    private function salesChannels(Organisation $kitchen, array $fixtures, User $owner): array
    {
        $names = [
            'b2c_web' => ['Web shop', 'المتجر الإلكتروني', 'web'],
            'b2b' => ['Wholesale', 'البيع بالجملة', null],
            'pos' => ['Counter', 'الكاشير', 'pos'],
            'marketplace' => ['Marketplace', 'السوق الإلكتروني', 'marketplace'],
            'corporate' => ['Corporate', 'الحسابات المؤسسية', null],
        ];

        $channels = [];

        foreach ($fixtures as $fixture) {
            [$nameEn, $nameAr, $orderSource] = $names[$fixture['kind']];

            $channels[$fixture['kind']] = SalesChannel::withoutTenancy()->updateOrCreate(
                ['organisation_id' => $kitchen->getKey(), 'code' => $fixture['code']],
                [
                    'channel_kind' => $fixture['kind'],
                    'name_en' => $nameEn,
                    'name_ar' => $nameAr,
                    'order_source' => $orderSource,
                    'status' => SalesChannelStatus::Active,
                    'created_by' => $owner->getKey(),
                    'updated_by' => $owner->getKey(),
                ],
            );
        }

        return $channels;
    }

    /**
     * One branch and the seven rows that are its operating week.
     *
     * A closed weekday is a row with no times, exactly as `seedVerdantDelivery`
     * writes Friday: "shut" and "nobody has said" stay distinguishable in the
     * fixture rather than only in the tests.
     *
     * @param  array<string, mixed>  $fixture
     */
    private function branchWithWeek(Organisation $kitchen, array $fixture, User $owner): OrganisationBranch
    {
        $branch = $this->forOrganisation((string) $kitchen->getKey(), fn (): OrganisationBranch => OrganisationBranch::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'name' => (string) $fixture['name']],
            [
                'country_code' => $kitchen->country_code,
                'city' => (string) $fixture['city'],
                'timezone' => (string) $fixture['timezone'],
                'status' => BranchStatus::Active,
                'created_by' => $owner->getKey(),
            ],
        ));

        /** @var list<int> $closed */
        $closed = $fixture['closed_weekdays'];

        foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
            $shut = in_array($weekday, $closed, true);

            BranchOpeningHour::withoutTenancy()->updateOrCreate(
                ['branch_id' => $branch->getKey(), 'weekday' => $weekday],
                [
                    'organisation_id' => $kitchen->getKey(),
                    'opens_at' => $shut ? null : $this->clock((string) $fixture['opens_at']),
                    'closes_at' => $shut ? null : $this->clock((string) $fixture['closes_at']),
                    'order_cut_off_at' => $shut ? null : $this->clock((string) $fixture['order_cut_off_at']),
                    'created_by' => $owner->getKey(),
                ],
            );
        }

        return $branch;
    }

    /**
     * The kitchen's delivery map: one organisation-wide zone per fixture zone,
     * over one demonstration area each.
     *
     * Organisation-wide (`branch_id` NULL) rather than branch-scoped, because
     * the fixture lets two branches of one kitchen name the same zone code and
     * a zone is a single row with a single scope. An org-wide zone applies to
     * every branch, which is what "both our branches deliver to Deira" means.
     *
     * @param  list<array<string, mixed>>  $zones
     */
    private function deliveryMap(Organisation $kitchen, array $zones, User $owner): void
    {
        foreach ($zones as $fixture) {
            $area = $this->area((string) $fixture['area_name']);
            $nameEn = (string) $fixture['name'];

            $zone = DeliveryZone::withoutTenancy()->updateOrCreate(
                ['organisation_id' => $kitchen->getKey(), 'code' => (string) $fixture['code']],
                [
                    'branch_id' => null,
                    'name_en' => $nameEn,
                    'name_ar' => self::ZONE_NAMES_AR[$nameEn] ?? throw new RuntimeException(
                        'The preview delivery zone "'.$nameEn.'" has no hand-authored Arabic name.',
                    ),
                    'currency_code' => $kitchen->default_currency_code,
                    'delivery_fee_minor' => $fixture['fee_minor'],
                    'minimum_order_minor' => $fixture['minimum_minor'],
                    'estimated_minutes' => $fixture['estimated_minutes'],
                    'status' => DeliveryZoneStatus::Active,
                    'created_by' => $owner->getKey(),
                    'updated_by' => $owner->getKey(),
                ],
            );

            DeliveryZoneArea::withoutTenancy()->updateOrCreate(
                ['delivery_zone_id' => $zone->getKey(), 'delivery_area_id' => $area->getKey()],
                [
                    'organisation_id' => $kitchen->getKey(),
                    'branch_id' => null,
                    'created_by' => $owner->getKey(),
                ],
            );
        }
    }

    /**
     * The demonstration area a fixture zone covers, reusing the one
     * `DemoTenantSeeder` already invented when the name matches.
     *
     * Every code carries the `ae-demo-` prefix for the reason that seeder
     * records: these are demo places, not the committed gazetteer, and the
     * prefix is what `DatabaseSeederTest` excludes when it pins the Lebanese
     * count at 125.
     */
    private function area(string $nameEn): DeliveryArea
    {
        $code = 'ae-demo-'.str_replace(' ', '-', mb_strtolower($nameEn));

        $existing = DeliveryArea::query()
            ->where('country_code', 'AE')
            ->where('name_en', $nameEn)
            ->first();

        if ($existing instanceof DeliveryArea) {
            return $existing;
        }

        $authored = self::PREVIEW_AREAS[$nameEn] ?? null;

        if ($authored === null) {
            throw new RuntimeException(sprintf(
                'The preview area "%s" has no hand-authored Arabic name. A place name that reaches a delivery address is never machine-translated.',
                $nameEn,
            ));
        }

        [$nameAr, $displayOrder] = $authored;

        return DeliveryArea::query()->updateOrCreate(
            ['country_code' => 'AE', 'code' => $code],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'region' => null,
                'display_order' => $displayOrder,
                'is_active' => true,
            ],
        );
    }

    /**
     * @param  array<string, mixed>  $fixture
     */
    private function deliveryWindow(Organisation $kitchen, array $fixture, User $owner): void
    {
        $labels = ['morning' => 'صباحاً', 'evening' => 'مساءً'];
        $code = (string) $fixture['code'];

        DeliveryWindow::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'code' => $code],
            [
                'name_en' => (string) $fixture['name'],
                'name_ar' => $labels[$code] ?? (string) $fixture['name'],
                'starts_at' => $this->clock((string) $fixture['starts_at']),
                'ends_at' => $this->clock((string) $fixture['ends_at']),
                'weekdays' => $fixture['weekdays'],
                'display_order' => (int) $fixture['display_order'],
                'is_active' => true,
                'created_by' => $owner->getKey(),
            ],
        );
    }

    private function catalogue(Organisation $kitchen, User $owner): Catalogue
    {
        return Catalogue::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'code' => 'default'],
            [
                'name_en' => 'Default catalogue',
                'name_ar' => 'الكتالوج الافتراضي',
                'status' => CatalogueStatus::Active,
                'created_by' => $owner->getKey(),
                'updated_by' => $owner->getKey(),
            ],
        );
    }

    /**
     * The kitchen's one active public tariff.
     *
     * Active, not draft: this list is what makes a preview meal buyable, and a
     * draft one prices nothing — which is what draft means. Verdant keeps a
     * draft tariff of its own precisely so the price-list publish gate has a
     * fixture; duplicating that here would only make five more kitchens with
     * empty menus.
     */
    private function publicTariff(Organisation $kitchen, User $owner): PriceList
    {
        return PriceList::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'code' => $kitchen->slug.self::MENU_PRICE_LIST_SUFFIX],
            [
                'name_en' => $kitchen->name.' menu',
                'name_ar' => 'قائمة '.$kitchen->name,
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::PublicTariff,
                'status' => PriceListStatus::Active,
                'created_by' => $owner->getKey(),
                'updated_by' => $owner->getKey(),
            ],
        );
    }

    /**
     * The kitchen's published menu, seeded exactly the way `seedVerdantMenu`
     * seeds a fixture meal — and published only through the readiness gate.
     *
     * @param  list<array<string, mixed>>  $meals
     */
    private function seedMenu(
        Organisation $kitchen,
        Catalogue $catalogue,
        PriceList $menu,
        SalesChannel $webShop,
        ?SalesChannel $marketplace,
        array $meals,
        User $owner,
    ): void {
        if ($meals === []) {
            return;
        }

        $composition = $this->previewComposition($kitchen, $owner);
        $readiness = App::make(CatalogueItemReadiness::class);

        // The twelve platform classifications, read once: twenty-six meals
        // carrying eight diets each would otherwise be two hundred identical
        // lookups of a table that cannot change mid-seed.
        $classifications = DietClassification::query()->pluck('id', 'code');

        $offeredThrough = $marketplace instanceof SalesChannel ? [$webShop, $marketplace] : [$webShop];

        foreach ($meals as $fixture) {
            $slug = (string) $fixture['slug'];

            $meal = CatalogueItem::withoutTenancy()->updateOrCreate(
                ['organisation_id' => $kitchen->getKey(), 'slug' => $slug],
                [
                    'catalogue_id' => $catalogue->getKey(),
                    'item_type' => CatalogueItemType::Meal,
                    'name_en' => (string) $fixture['name'],
                    // The prototype supplied English display copy only. A
                    // non-empty marker keeps the menu publishable while making
                    // the remaining localisation work obvious in Arabic preview
                    // mode.
                    'name_ar' => 'وجبة تجريبية: '.$fixture['name'],
                    'status' => CatalogueItemStatus::Draft,
                    'created_by' => $owner->getKey(),
                    'updated_by' => $owner->getKey(),
                ],
            );

            $meal->forceFill([
                'description_en' => (string) $fixture['description'],
                'description_ar' => 'وصف تجريبي — تحتاج هذه الوجبة إلى وصف عربي مراجع.',
                'image_placeholder_id' => 'meal-'.$slug,
                'nutrition_facts' => $this->previewNutritionFacts($fixture),
            ])->save();

            // The full recipes live only in the customer prototype. This
            // neutral row gives the listing the allergen basis the readiness
            // gate requires without claiming a preview is an ingredient-level
            // recipe declaration.
            CatalogueItemIngredient::withoutTenancy()->updateOrCreate(
                ['catalogue_item_id' => $meal->getKey(), 'ingredient_id' => $composition->getKey()],
                [
                    'organisation_id' => $kitchen->getKey(),
                    'is_representative' => true,
                    'display_order' => 1,
                    'created_by' => $owner->getKey(),
                ],
            );

            /** @var list<string> $diets */
            $diets = $fixture['diets'];

            foreach ($diets as $code) {
                $classificationId = $classifications->get($code)
                    ?? throw new RuntimeException('The preview meal '.$slug.' claims a diet the platform does not publish: '.$code.'.');

                CatalogueItemDietClassification::withoutTenancy()->updateOrCreate(
                    [
                        'catalogue_item_id' => $meal->getKey(),
                        'diet_classification_id' => $classificationId,
                    ],
                    ['organisation_id' => $kitchen->getKey()],
                );
            }

            PriceListItem::withoutTenancy()->updateOrCreate(
                [
                    'price_list_id' => $menu->getKey(),
                    'catalogue_item_id' => $meal->getKey(),
                    'catalogue_item_variant_id' => null,
                    'min_quantity' => null,
                    'effective_to' => null,
                ],
                [
                    'organisation_id' => $kitchen->getKey(),
                    'unit_amount_minor' => (int) $fixture['amount_minor'],
                    'price_status' => PriceStatus::Confirmed,
                    'effective_from' => now()->toDateString(),
                    'created_by' => $owner->getKey(),
                ],
            );

            foreach ($offeredThrough as $channel) {
                ChannelCatalogueItem::withoutTenancy()->updateOrCreate(
                    [
                        'sales_channel_id' => $channel->getKey(),
                        'catalogue_item_id' => $meal->getKey(),
                        'catalogue_item_variant_id' => null,
                    ],
                    [
                        'organisation_id' => $kitchen->getKey(),
                        'is_available' => true,
                        'available_from' => null,
                        'available_to' => null,
                        'created_by' => $owner->getKey(),
                    ],
                );
            }

            // Re-read: the readiness evaluator queries by identifier, and the
            // in-memory model is stale about the rows just written beneath it.
            $meal->refresh();

            $reasons = $readiness->reasons($meal);

            if ($reasons !== []) {
                throw new RuntimeException(sprintf(
                    'The preview menu item %s is not ready to publish: %s. A seeder must never publish past the gate.',
                    $slug,
                    implode(', ', array_column($reasons, 'code')),
                ));
            }

            $meal->forceFill(['status' => CatalogueItemStatus::Published])->save();
        }
    }

    /**
     * The neutral ingredient every preview meal lists, and the readiness gate's
     * allergen basis for it.
     *
     * Carries no allergen mapping, which is the honest state: the prototype's
     * recipes are display copy, and inventing a containment declaration from a
     * dish name is precisely the fabrication the allergen apparatus exists to
     * prevent.
     */
    private function previewComposition(Organisation $kitchen, User $owner): Ingredient
    {
        $gram = MeasurementUnit::query()->where('code', 'g')->sole();

        return Ingredient::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'slug' => 'preview-meal-composition'],
            [
                'name_en' => 'Preview meal composition',
                'name_ar' => 'مكونات وجبة تجريبية',
                'default_unit_id' => $gram->getKey(),
                'status' => IngredientStatus::Active,
                'verification_status' => IngredientVerificationStatus::Verified,
                'created_by' => $owner->getKey(),
                'updated_by' => $owner->getKey(),
            ],
        );
    }

    /**
     * The customer prototype's per-serving facts in the API record shape —
     * the same conversion `DemoTenantSeeder::mockPreviewNutritionFacts` makes,
     * and marked synthetic for the same reason.
     *
     * @param  array<string, mixed>  $meal
     * @return array<string, mixed>
     */
    private function previewNutritionFacts(array $meal): array
    {
        $units = [
            'energy' => 'kcal',
            'protein' => 'g',
            'carbohydrate' => 'g',
            'fat' => 'g',
            'fibre' => 'g',
            'sugars' => 'g',
            'saturated_fat' => 'g',
            'sodium' => 'mg',
        ];

        $amounts = [];

        /** @var array<string, int|float> $stated */
        $stated = $meal['amounts'];

        foreach ($stated as $nutrientId => $value) {
            $amounts[] = [
                'nutrient_id' => $nutrientId,
                'unit' => $units[$nutrientId],
                'value' => $value,
                'kind' => 'planned',
                'tolerance' => null,
            ];
        }

        return [
            'basis' => 'per_serving',
            'kind' => 'planned',
            'serving' => [
                'label' => $meal['serving_label'],
                'quantity' => 1,
                'unit' => 'portion',
                'grams' => $meal['grams'],
                'millilitres' => null,
                'household_measure' => null,
            ],
            'total_grams' => $meal['grams'],
            'amounts' => $amounts,
            'source' => [
                'kind' => 'synthetic_prototype',
                'label' => 'Healthy360 customer prototype fixture — preview only',
                'version' => '2026.07',
                'calculated_at' => '2026-07-30T09:00:00+00:00',
            ],
            'calculation' => [
                'method' => 'fixture.meal_from_recipe_serving',
                'basis' => 'per_serving',
                'calculated_at' => '2026-07-30T09:00:00+00:00',
                'prototype' => true,
                'rounding' => 'Imported from the customer prototype after applying its display precision.',
                'notes' => [$meal['note']],
            ],
        ];
    }

    /**
     * The fixture states clock faces as `HH:MM`; the columns hold `HH:MM:SS`.
     */
    private function clock(string $value): string
    {
        return mb_substr($value, 0, 5).':00';
    }

    /**
     * Publish an organisation to the database session for one write, so
     * row-level security admits it on the RLS-subject application connection —
     * the same declaration `DemoTenantSeeder` makes, for the same reason.
     *
     * @template TReturn
     *
     * @param  Closure(): TReturn  $callback
     * @return TReturn
     */
    private function forOrganisation(string $organisationId, Closure $callback): mixed
    {
        return app(DatabaseTenantContext::class)->during(null, $organisationId, null, $callback);
    }
}
