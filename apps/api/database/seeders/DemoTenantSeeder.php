<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Closure;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\CatalogueStatus;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\PlanType;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Enums\ServiceTier;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Kitchens\Models\BranchOpeningHour;
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
use Laravel\Fortify\Fortify;
use RuntimeException;

/**
 * Demonstration tenants exercising the multi-organisation identity model
 * (plan §9): a Lebanese clinic with two branches, an Emirati kitchen with
 * one, a dietitian who belongs to both, a patient connected to the clinic,
 * and — since K1.1 — the platform operator's own organisation.
 *
 * The platform organisation is what makes the platform-permission split
 * demonstrable rather than theoretical. `reference.*_platform` cannot be
 * granted through a template role (an organisation template must never carry
 * a platform code), so it is granted the only way it ever will be: a bespoke
 * organisation-scoped role inside an organisation whose *type* is
 * `platform_operator`. Both gates — the type and the grant — are visible in
 * one place, and the feature tests use exactly this path.
 *
 * Guarded to local and testing environments: these accounts share one
 * well-known password and must never reach a deployed environment.
 *
 * Writes go through withoutTenancy() — seeding is an explicit, auditable
 * cross-tenant path, and every organisation_id is set from the row being
 * created rather than from an ambient context.
 */
class DemoTenantSeeder extends Seeder
{
    private const string DEMO_PASSWORD = 'password';

    /**
     * The TOTP shared secret `two-factor@cedar.test` is enrolled with, base32.
     * Fixed and published so an end-to-end suite can generate a valid code for
     * that account; see {@see self::enrolTwoFactor()} for why that is safe.
     */
    private const string DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('DemoTenantSeeder skipped: demo tenants are seeded in local and testing environments only.');

            return;
        }

        $cedarOwner = $this->user('owner@cedar.test', 'Nadia', 'Haddad', 'ar', 'LB');
        $dietitian = $this->user('dietitian@cedar.test', 'Rami', 'Khoury', 'en', 'LB');
        $twoFactor = $this->user('two-factor@cedar.test', 'Sami', 'Nasr', 'en', 'LB');
        $this->enrolTwoFactor($twoFactor);
        $verdantOwner = $this->user('owner@verdant.test', 'Layla', 'Mansour', 'ar', 'AE');
        $chef = $this->user('chef@verdant.test', 'Omar', 'Saleh', 'en', 'AE');
        $patient = $this->user('patient@healthy360.test', 'Maya', 'Aoun', 'en', 'LB');

        $cedar = $this->organisation('Cedar Clinic', 'cedar-clinic', 'clinic', 'LB', 'LBP', 'ar', $cedarOwner);
        $hamra = $this->branch($cedar, 'Hamra', 'Beirut', 'Asia/Beirut', $cedarOwner);
        $this->branch($cedar, 'Jounieh', 'Jounieh', 'Asia/Beirut', $cedarOwner);
        $this->capability($cedar, 'clinic_services', $cedarOwner);

        $verdant = $this->organisation('Verdant Kitchen', 'verdant-kitchen', 'kitchen', 'AE', 'USD', 'ar', $verdantOwner);
        $this->retireLegacyVerdantAedTariffs($verdant);
        $alQuoz = $this->branch($verdant, 'Al Quoz', 'Dubai', 'Asia/Dubai', $verdantOwner);
        $this->capability($verdant, 'kitchen_production', $verdantOwner);

        $this->membership($cedar, $cedarOwner, null, 'organisation_owner', $cedarOwner);
        $this->membership($cedar, $dietitian, $hamra, 'member', $cedarOwner);
        $this->membership($cedar, $patient, null, 'member', $cedarOwner);
        $this->membership($cedar, $twoFactor, null, 'member', $cedarOwner);

        $this->membership($verdant, $verdantOwner, null, 'organisation_owner', $verdantOwner);
        $this->membership($verdant, $chef, $alQuoz, 'branch_manager', $verdantOwner);

        // The dietitian practises at Cedar and is a plain member at Verdant:
        // one global identity, two organisations, different roles.
        $this->membership($verdant, $dietitian, null, 'member', $verdantOwner);

        // The kitchen owner also runs the catalogue — the K1.1 acceptance path
        // starts here. Template roles are reconciled by TemplateRoleSeeder, so
        // widening kitchen_manager in a later slice reaches this membership
        // without touching this file.
        $this->addRole($verdant, $verdantOwner, 'kitchen_manager', $verdantOwner);

        // Two routes to market (K1.4), so channel availability is testable
        // against something a kitchen would actually have: a consumer web
        // shop and a wholesale desk. Both are structure, not content — no
        // item, no price and no formulation is seeded anywhere.
        $webShop = $this->salesChannel($verdant, 'web-shop', 'b2c_web', 'Web shop', 'المتجر الإلكتروني', 'web', $verdantOwner);
        $this->salesChannel($verdant, 'wholesale', 'b2b', 'Wholesale', 'البيع بالجملة', null, $verdantOwner);

        // These sections both write RLS-scoped rows (price list items, meal
        // publications) and read them straight back through the readiness
        // services, which see nothing on the RLS-subject application connection
        // unless Verdant is declared to the database session. One declaration
        // around the whole block covers both directions; on the schema-owning
        // connection it is a harmless no-op.
        $this->forOrganisation((string) $verdant->getKey(), function () use ($verdant, $webShop, $alQuoz, $verdantOwner): void {
            $this->seedVerdantTariff($verdant, $webShop, $verdantOwner);
            $this->seedVerdantPlan($verdant, $verdantOwner);
            $this->seedMarketplacePlan($verdant, $webShop, $verdantOwner);
            $this->seedVerdantDelivery($verdant, $alQuoz, $verdantOwner);
            $this->seedVerdantMenu($verdant, $webShop, $verdantOwner);
        });

        $this->call(VerdantProductCatalogueSeeder::class);

        $this->seedPlatformOperator();
    }

    /**
     * The demonstration kitchen's delivery configuration (K1.7): six synthetic
     * Emirati areas, two zones over them — one organisation-wide, one scoped to
     * Al Quoz — two delivery windows, and a full seven-day operating week for
     * the branch including one closed day.
     *
     * **The six areas are demo data, mechanism (b), not the platform
     * gazetteer.** The committed gazetteer (`DeliveryAreaSeeder`, mechanism
     * (a)) holds the 125 Lebanese names the source workbook lists and nothing
     * else, because that is what the source says exists. Verdant is an Emirati
     * kitchen, so demonstrating a zone at all needs Emirati places, and
     * inventing six of them *into* the platform gazetteer would put fabricated
     * geography in front of every tenant in every environment — the same class
     * of mistake as a fabricated price. They are seeded here instead, in a
     * `local`/`testing`-only seeder, and their codes say so: `ae-demo-*`.
     * Nothing in production reads them, and the seeder test asserts the
     * Lebanese count is exactly 125 with these excluded.
     *
     * **The two zones demonstrate the precedence rule.** `emirates-wide`
     * covers four areas as the organisation's default map; `al-quoz-express`
     * covers two of the same four from the branch, faster and dearer. That
     * overlap is legal precisely because the unique key is
     * `(organisation, branch, area)` with `NULLS NOT DISTINCT`, and
     * `ZoneResolver` decides that the branch claim wins. It is the fixture the
     * resolution order is worth testing against, and the one a reader of the
     * schema would otherwise assume is a bug.
     *
     * **The week has a closed day and a cut-off.** Friday is closed — a row
     * with no times, not a missing row — so the difference between "shut" and
     * "nobody has said" is visible in the fixture rather than only in the
     * tests.
     */
    private function retireLegacyVerdantAedTariffs(Organisation $verdant): void
    {
        // Earlier demos used `*-aed` codes. updateOrCreate on the new `*-usd`
        // codes would leave the AED lists behind for kitchens that reseed in
        // place, so rename (or drop if the USD twin already exists) first.
        $legacy = [
            'verdant-plans-aed' => 'verdant-plans-usd',
            'verdant-web-aed' => 'verdant-web-usd',
            'verdant-menu-aed' => 'verdant-menu-usd',
        ];

        foreach ($legacy as $oldCode => $newCode) {
            $old = PriceList::withoutTenancy()
                ->where('organisation_id', $verdant->getKey())
                ->where('code', $oldCode)
                ->first();

            if ($old === null) {
                continue;
            }

            $exists = PriceList::withoutTenancy()
                ->where('organisation_id', $verdant->getKey())
                ->where('code', $newCode)
                ->exists();

            if ($exists) {
                $old->delete();

                continue;
            }

            $old->forceFill([
                'code' => $newCode,
                'currency_code' => 'USD',
            ])->save();
        }

        DeliveryZone::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('currency_code', 'AED')
            ->update(['currency_code' => 'USD']);
    }

    private function seedVerdantDelivery(Organisation $verdant, OrganisationBranch $branch, User $creator): void
    {
        $alQuozArea = $this->demoArea('ae-demo-al-quoz', 'Al Quoz', 'القوز', 1);
        $businessBay = $this->demoArea('ae-demo-business-bay', 'Business Bay', 'الخليج التجاري', 2);
        $jumeirah = $this->demoArea('ae-demo-jumeirah', 'Jumeirah', 'جميرا', 3);
        $deira = $this->demoArea('ae-demo-deira', 'Deira', 'ديرة', 4);
        $alBarsha = $this->demoArea('ae-demo-al-barsha', 'Al Barsha', 'البرشاء', 5);
        $this->demoArea('ae-demo-mirdif', 'Mirdif', 'مردف', 6);

        $emiratesWide = $this->deliveryZone($verdant, null, 'emirates-wide', 'Emirates wide', 'كل الإمارات', 1500, 5000, 90, $creator);
        $alQuozExpress = $this->deliveryZone($verdant, $branch, 'al-quoz-express', 'Al Quoz express', 'القوز السريع', 2500, 3000, 30, $creator);

        $this->zoneAreas($emiratesWide, [$alQuozArea, $businessBay, $jumeirah, $deira], $creator);

        // Two of the four again, from the branch. Legal, and the point: a
        // customer in Al Quoz ordering from this branch gets 30 minutes at
        // USD 25, and the same customer with no branch in context gets the
        // organisation-wide 90 minutes at USD 15.
        $this->zoneAreas($alQuozExpress, [$alQuozArea, $alBarsha], $creator);

        $this->deliveryWindow($verdant, 'morning', 'Morning', 'صباحاً', '09:00:00', '12:00:00', [], 1, $creator);
        $this->deliveryWindow($verdant, 'evening', 'Evening', 'مساءً', '18:00:00', '21:00:00', [1, 2, 3, 4], 2, $creator);

        // Saturday to Thursday open, Friday closed. ISO weekdays: 5 is Friday.
        foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
            $closed = $weekday === 5;

            BranchOpeningHour::withoutTenancy()->updateOrCreate(
                ['branch_id' => $branch->getKey(), 'weekday' => $weekday],
                [
                    'organisation_id' => $verdant->getKey(),
                    'opens_at' => $closed ? null : '08:00:00',
                    'closes_at' => $closed ? null : ($weekday >= 6 ? '22:00:00' : '20:00:00'),
                    'order_cut_off_at' => $closed ? null : '18:00:00',
                    'created_by' => $creator->getKey(),
                ],
            );
        }
    }

    /**
     * A synthetic Emirati area — demo data, mechanism (b), never the committed
     * gazetteer. The `ae-demo-` prefix is what says so at a glance and is what
     * `DatabaseSeederTest` excludes when it pins the Lebanese count at 125.
     */
    private function demoArea(string $code, string $nameEn, string $nameAr, int $displayOrder): DeliveryArea
    {
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

    private function deliveryZone(
        Organisation $organisation,
        ?OrganisationBranch $branch,
        string $code,
        string $nameEn,
        string $nameAr,
        ?int $feeMinor,
        ?int $minimumMinor,
        ?int $estimatedMinutes,
        User $creator,
    ): DeliveryZone {
        return DeliveryZone::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'branch_id' => $branch?->getKey(),
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'currency_code' => $organisation->default_currency_code,
                'delivery_fee_minor' => $feeMinor,
                'minimum_order_minor' => $minimumMinor,
                'estimated_minutes' => $estimatedMinutes,
                'status' => DeliveryZoneStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * @param  list<DeliveryArea>  $areas
     */
    private function zoneAreas(DeliveryZone $zone, array $areas, User $creator): void
    {
        foreach ($areas as $area) {
            DeliveryZoneArea::withoutTenancy()->updateOrCreate(
                ['delivery_zone_id' => $zone->getKey(), 'delivery_area_id' => $area->getKey()],
                [
                    'organisation_id' => $zone->organisation_id,
                    // The denormalised copy of the zone's scope — the column
                    // the one-area-per-branch index reads.
                    'branch_id' => $zone->branch_id,
                    'created_by' => $creator->getKey(),
                ],
            );
        }
    }

    /**
     * @param  list<int>  $weekdays
     */
    private function deliveryWindow(
        Organisation $organisation,
        string $code,
        string $nameEn,
        string $nameAr,
        ?string $startsAt,
        ?string $endsAt,
        array $weekdays,
        int $displayOrder,
        User $creator,
    ): DeliveryWindow {
        return DeliveryWindow::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'weekdays' => $weekdays,
                'display_order' => $displayOrder,
                'is_active' => true,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * A minimal plan vocabulary and one draft subscription plan for the
     * demonstration kitchen (K1.6) — built to be **exactly one confirmed price
     * short of publishable**.
     *
     * That shortfall is the point of the fixture. The K1.6 publish gate refuses
     * a plan whose active configurations are not all priced with confirmed,
     * standing rows, because a plan page rendering a placeholder is the failure
     * the placeholder design exists to prevent (decision OD-2, reviewer point
     * 15). A demo where every configuration were priced would exercise the
     * happy path and prove nothing; a demo where none were would report the
     * same blocker for both cells and hide the per-configuration detail. One
     * priced and one not shows the gate naming precisely the cell that is
     * missing — and pricing the second one is a single API call away, which is
     * how the flip to publishable gets demonstrated rather than described.
     *
     * Everything else the gate wants is present: a profile, two active
     * configurations, and available durations across them. So the sole reason
     * this plan cannot publish is the one worth looking at.
     *
     * **Two durations, one of them a one-off** — the shape that used to be
     * written as zero days (§4.3). A demo without one would leave every surface
     * built against this data believing a duration always has a number.
     *
     * **Discounts are NULL, deliberately**, on all but one assignment. That is
     * what the source sheets actually contain, and a fixture that invented
     * percentages would make "nobody has stated one" the unusual case in every
     * screen built against it.
     */
    private function seedVerdantPlan(Organisation $verdant, User $creator): void
    {
        $catalogue = Catalogue::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => 'default'],
            [
                'name_en' => 'Default catalogue',
                'name_ar' => 'الكتالوج الافتراضي',
                'status' => CatalogueStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        $lunchDinner = $this->combination($verdant, 'lunch-dinner', 'Lunch and dinner', 'الغداء والعشاء', false, true, true, 2, 1, $creator);
        $fullDay = $this->combination($verdant, 'full-day', 'Full day', 'اليوم الكامل', true, true, true, 3, 2, $creator);

        $lowerBand = $this->energyBand($verdant, 'kcal-1200-1500', '1200–1500 kcal', '١٢٠٠–١٥٠٠ سعرة', 1200, 1500, 1, $creator);
        $upperBand = $this->energyBand($verdant, 'kcal-1500-1800', '1500–1800 kcal', '١٥٠٠–١٨٠٠ سعرة', 1500, 1800, 2, $creator);

        // The one-off first: it is the shortest commitment there is, and it
        // carries no number of days at all.
        $oneOff = $this->planDuration($verdant, 'one-off', PlanDurationKind::OneOff, null, 'One-off order', 'طلب لمرة واحدة', 1, $creator);
        // 28 days maps to the client's closed `4w` duration vocabulary (7/14/28/84).
        // A 20-day fixture would publish on the wire but drop out of every consumer
        // chooser — leaving a plan with no buyable duration.
        $twentyEightDays = $this->planDuration($verdant, 'days-28', PlanDurationKind::FixedDays, 28, '28 days', '٢٨ يوماً', 2, $creator);

        $plan = $this->catalogueItem($verdant, $catalogue, 'balanced-plan', CatalogueItemType::SubscriptionPlan, 'Balanced plan', 'الخطة المتوازنة', $creator);

        SubscriptionPlanProfile::withoutTenancy()->updateOrCreate(
            ['catalogue_item_id' => $plan->getKey()],
            [
                'organisation_id' => $verdant->getKey(),
                'plan_type' => PlanType::Both,
                'pricing_basis' => PlanPricingBasis::PerDay,
                'allows_free_selection' => false,
                'skip_allowed' => true,
                'pause_allowed' => true,

                // The 24 h rule, which both source systems state from opposite
                // directions and the merge preserves as one column.
                'change_cutoff_hours' => 24,
                'summary_en' => 'Two meals a day, portioned to a calorie band.',
                'summary_ar' => 'وجبتان يومياً بحسب نطاق السعرات.',
            ],
        );

        // Codes match what PlanVariantService derives for these coordinates, so
        // the demo data and the API agree about identity.
        $standard = $this->planConfiguration($plan, $verdant, $lunchDinner, $lowerBand, ServiceTier::Standard, 2, 0, '2 meals · 1200–1500 kcal', $creator);
        $premium = $this->planConfiguration($plan, $verdant, $fullDay, $upperBand, ServiceTier::Premium, 3, 1, '3 meals + snack · 1500–1800 kcal', $creator);

        $this->planDurationAssignment($verdant, $standard, $oneOff, null, $creator);
        $this->planDurationAssignment($verdant, $standard, $twentyEightDays, null, $creator);
        $this->planDurationAssignment($verdant, $premium, $twentyEightDays, '10.00', $creator);

        $this->seedVerdantPlanTariff($verdant, $plan, $standard, $creator);
    }

    /**
     * Rename the marketplace plan the API demo carried before the customer
     * prototype's fixture set the slug.
     *
     * The prototype and this seeder were describing the same product under two
     * names — `marketplace-balanced-plan` here, `balanced-week` there — and
     * `MarketplacePlansSeeder` now re-authors its matrix from the fixture, so
     * the slug has to be the fixture's. Renamed rather than dropped: prices,
     * configurations and channel assignments all point at that row, and a
     * delete would take a published plan's history with it. The one case that
     * cannot be renamed — a `balanced-week` already existing beside it — leaves
     * the legacy row alone, because merging two published plans is not a
     * seeder's decision to make.
     */
    private function renameLegacyMarketplacePlan(Organisation $verdant): void
    {
        $legacy = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('slug', 'marketplace-balanced-plan')
            ->first();

        if (! $legacy instanceof CatalogueItem) {
            return;
        }

        $taken = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('slug', 'balanced-week')
            ->exists();

        if ($taken) {
            return;
        }

        $legacy->forceFill([
            'slug' => 'balanced-week',
            'name_en' => 'Balanced Week',
            'name_ar' => 'الأسبوع المتوازن',
        ])->save();
    }

    /**
     * A fully priced, published subscription plan assigned to the web shop —
     * the smallest complete world in which `GET /marketplace/meal-plans`
     * returns something real, while `balanced-plan` stays deliberately
     * unpublishable as the gate demo.
     *
     * The slug is the customer prototype's (`balanced-week`): the fixture and
     * this seeder describe one product, and `MarketplacePlansSeeder` re-authors
     * this plan's matrix from that fixture when the preview world is seeded.
     */
    private function seedMarketplacePlan(Organisation $verdant, SalesChannel $webShop, User $creator): void
    {
        $this->renameLegacyMarketplacePlan($verdant);

        $catalogue = Catalogue::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'default')
            ->sole();

        $lunchDinner = MealCombinationOption::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'lunch-dinner')
            ->sole();
        $fullDay = MealCombinationOption::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'full-day')
            ->sole();

        $lowerBand = EnergyBand::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'kcal-1200-1500')
            ->sole();
        $upperBand = EnergyBand::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'kcal-1500-1800')
            ->sole();

        $oneOff = PlanDuration::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'one-off')
            ->sole();
        $twentyEightDays = PlanDuration::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'days-28')
            ->sole();

        $plan = $this->catalogueItem(
            $verdant,
            $catalogue,
            'balanced-week',
            CatalogueItemType::SubscriptionPlan,
            'Balanced Week',
            'الأسبوع المتوازن',
            $creator,
        );

        SubscriptionPlanProfile::withoutTenancy()->updateOrCreate(
            ['catalogue_item_id' => $plan->getKey()],
            [
                'organisation_id' => $verdant->getKey(),
                'plan_type' => PlanType::Both,
                'pricing_basis' => PlanPricingBasis::PerDay,
                'allows_free_selection' => false,
                'skip_allowed' => true,
                'pause_allowed' => true,
                'change_cutoff_hours' => 24,
                'summary_en' => 'Two meals a day, portioned to a calorie band.',
                'summary_ar' => 'وجبتان يومياً بحسب نطاق السعرات.',
            ],
        );

        $standard = $this->planConfiguration($plan, $verdant, $lunchDinner, $lowerBand, ServiceTier::Standard, 2, 0, '2 meals · 1200–1500 kcal', $creator);
        $premium = $this->planConfiguration($plan, $verdant, $fullDay, $upperBand, ServiceTier::Premium, 3, 1, '3 meals + snack · 1500–1800 kcal', $creator);

        $this->planDurationAssignment($verdant, $standard, $oneOff, null, $creator);
        $this->planDurationAssignment($verdant, $standard, $twentyEightDays, null, $creator);
        $this->planDurationAssignment($verdant, $premium, $twentyEightDays, '10.00', $creator);

        $tariff = PriceList::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => 'verdant-marketplace-plans-usd'],
            [
                'name_en' => 'Marketplace subscription plans',
                'name_ar' => 'خطط الاشتراك في المتجر',
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::PublicTariff,
                'status' => PriceListStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        $this->price($tariff, (string) $plan->getKey(), $standard->getKey(), null, 5500, PriceStatus::Confirmed, $creator);
        $this->price($tariff, (string) $plan->getKey(), $premium->getKey(), null, 7200, PriceStatus::Confirmed, $creator);

        ChannelPriceList::withoutTenancy()->updateOrCreate(
            ['sales_channel_id' => $webShop->getKey(), 'price_list_id' => $tariff->getKey()],
            ['organisation_id' => $verdant->getKey(), 'priority' => 0, 'created_by' => $creator->getKey()],
        );

        $plan->refresh();

        $readiness = App::make(CatalogueItemReadiness::class);
        $reasons = $readiness->reasons($plan);

        if ($reasons !== []) {
            throw new RuntimeException(sprintf(
                'The marketplace plan is not ready to publish: %s.',
                implode(', ', array_column($reasons, 'code')),
            ));
        }

        $plan->forceFill(['status' => CatalogueItemStatus::Published])->save();
    }

    /**
     * An **active** USD tariff carrying one confirmed plan price — and assigned
     * to no channel at all.
     *
     * Both halves are deliberate. Active, because the publish gate only counts
     * confirmed rows on an active list: a draft tariff prices nothing, which is
     * what draft means, and seeding a draft one here would block the plan on
     * *both* configurations and destroy the fixture. Unassigned, because
     * `PriceResolver` walks from a channel to its lists, so a tariff no channel
     * names quotes nothing to anybody — which keeps the seeded numbers out of
     * every customer-facing path while still being real enough for the gate to
     * read. "Agreed, not yet on sale" is an ordinary state for a tariff, not a
     * contrivance.
     *
     * Separate from `verdant-web-usd` rather than folded into it, because that
     * one is deliberately a draft demonstrating the price-list publish gate, and
     * one list cannot be a draft and active at once.
     */
    private function seedVerdantPlanTariff(Organisation $verdant, CatalogueItem $plan, CatalogueItemVariant $standard, User $creator): void
    {
        $tariff = PriceList::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => 'verdant-plans-usd'],
            [
                'name_en' => 'Subscription plans tariff',
                'name_ar' => 'تعرفة خطط الاشتراك',
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::PublicTariff,
                'status' => PriceListStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        // 55.00 USD a day for the standard configuration — and nothing at all
        // for the premium one, which is what leaves the plan unpublishable.
        $this->price($tariff, $plan->getKey(), $standard->getKey(), null, 5500, PriceStatus::Confirmed, $creator);
    }

    private function combination(
        Organisation $organisation,
        string $code,
        string $nameEn,
        string $nameAr,
        bool $breakfast,
        bool $lunch,
        bool $dinner,
        int $mealsPerDay,
        int $displayOrder,
        User $creator,
    ): MealCombinationOption {
        return MealCombinationOption::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'includes_breakfast' => $breakfast,
                'includes_lunch' => $lunch,
                'includes_dinner' => $dinner,
                'meals_per_day' => $mealsPerDay,
                'display_order' => $displayOrder,
                'is_active' => true,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    private function energyBand(
        Organisation $organisation,
        string $code,
        string $nameEn,
        string $nameAr,
        int $minKcal,
        int $maxKcal,
        int $displayOrder,
        User $creator,
    ): EnergyBand {
        return EnergyBand::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'min_kcal' => $minKcal,
                'max_kcal' => $maxKcal,
                'display_order' => $displayOrder,
                'is_active' => true,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    private function planDuration(
        Organisation $organisation,
        string $code,
        PlanDurationKind $kind,
        ?int $days,
        string $nameEn,
        string $nameAr,
        int $displayOrder,
        User $creator,
    ): PlanDuration {
        return PlanDuration::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'duration_kind' => $kind,
                'duration_days' => $days,
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'display_order' => $displayOrder,
                'is_active' => true,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * One matrix cell: the variant a price points at, plus the profile that
     * says which cell it is. Written as a pair, because that is what the pair
     * means.
     */
    private function planConfiguration(
        CatalogueItem $plan,
        Organisation $organisation,
        MealCombinationOption $combination,
        EnergyBand $band,
        ServiceTier $tier,
        int $mealsPerDay,
        int $snacksPerDay,
        string $nameEn,
        User $creator,
    ): CatalogueItemVariant {
        $code = $combination->code.'-'.$tier->value.'-'.$band->code;

        $variant = CatalogueItemVariant::withoutTenancy()->updateOrCreate(
            ['catalogue_item_id' => $plan->getKey(), 'code' => $code],
            [
                'organisation_id' => $organisation->getKey(),
                'variant_type' => VariantType::PlanConfiguration,
                'name_en' => $nameEn,
                'name_ar' => null,
                'is_default' => false,
                'status' => VariantStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        PlanVariantProfile::withoutTenancy()->updateOrCreate(
            ['catalogue_item_variant_id' => $variant->getKey()],
            [
                'organisation_id' => $organisation->getKey(),
                'catalogue_item_id' => $plan->getKey(),
                'meal_combination_option_id' => $combination->getKey(),
                'energy_band_id' => $band->getKey(),
                'service_tier' => $tier,
                'includes_snacks' => $snacksPerDay > 0,
                'meals_per_day' => $mealsPerDay,
                'snacks_per_day' => $snacksPerDay,
            ],
        );

        return $variant;
    }

    /**
     * `$discountPercent` is NULL for all but one assignment, and that is the
     * honest default: the source sheets have empty discount cells, and NULL
     * says "nobody has stated one" where `0.00` would say "there is none".
     */
    private function planDurationAssignment(
        Organisation $organisation,
        CatalogueItemVariant $variant,
        PlanDuration $duration,
        ?string $discountPercent,
        User $creator,
    ): void {
        PlanVariantDuration::withoutTenancy()->updateOrCreate(
            ['catalogue_item_variant_id' => $variant->getKey(), 'plan_duration_id' => $duration->getKey()],
            [
                'organisation_id' => $organisation->getKey(),
                'discount_percent' => $discountPercent,
                'is_available' => true,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * A draft USD tariff for the demonstration kitchen, and the two listings it
     * prices (K1.5).
     *
     * **USD.** Verdant's demo default currency is USD (platform demo policy).
     * The currency lives on the list and must match the organisation default.
     *
     * **Draft, not active.** Nothing here has been reviewed by anybody, and a
     * seeded tariff that priced a live channel would be exactly the "synthetic
     * data presented as authoritative" the programme forbids. Activating it is
     * one API call, which is the point — the demo exists so the gate can be
     * exercised, not bypassed.
     *
     * The three entries are chosen to make the whole design visible in one
     * fixture: a base price on a pack, a **quantity tier** above it, and a
     * **placeholder** on the meal. The placeholder is the important one. It is
     * what an honest "we have not priced this yet" looks like — a row with a
     * status and no amount — and a demo without one would leave every surface
     * built against this data believing every price is real.
     */
    private function seedVerdantTariff(Organisation $verdant, SalesChannel $webShop, User $creator): void
    {
        $catalogue = Catalogue::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => 'default'],
            [
                'name_en' => 'Default catalogue',
                'name_ar' => 'الكتالوج الافتراضي',
                'status' => CatalogueStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        $harissa = $this->catalogueItem($verdant, $catalogue, 'harissa-paste', CatalogueItemType::Product, 'Harissa paste', 'معجون الهريسة', $creator);
        $bowl = $this->catalogueItem($verdant, $catalogue, 'chicken-freekeh-bowl', CatalogueItemType::Meal, 'Chicken freekeh bowl', 'وعاء الفريكة بالدجاج', $creator);

        $jar = CatalogueItemVariant::withoutTenancy()->updateOrCreate(
            ['catalogue_item_id' => $harissa->getKey(), 'code' => 'jar-250g'],
            [
                'organisation_id' => $verdant->getKey(),
                'variant_type' => VariantType::Pack,
                'name_en' => '250 g jar',
                'name_ar' => 'برطمان ٢٥٠ غرام',
                'is_default' => true,
                'status' => VariantStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        $tariff = PriceList::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => 'verdant-web-usd'],
            [
                'name_en' => 'Web shop tariff',
                'name_ar' => 'تعرفة المتجر الإلكتروني',
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::PublicTariff,
                'status' => PriceListStatus::Draft,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        // 22.00 USD a jar, 19.00 from a dozen, and a meal nobody has priced.
        $this->price($tariff, $harissa->getKey(), $jar->getKey(), null, 2200, PriceStatus::Confirmed, $creator);
        $this->price($tariff, $harissa->getKey(), $jar->getKey(), '12.0000', 1900, PriceStatus::Confirmed, $creator);
        $this->price($tariff, $bowl->getKey(), null, null, null, PriceStatus::Placeholder, $creator);

        ChannelPriceList::withoutTenancy()->updateOrCreate(
            ['sales_channel_id' => $webShop->getKey(), 'price_list_id' => $tariff->getKey()],
            ['organisation_id' => $verdant->getKey(), 'priority' => 0, 'created_by' => $creator->getKey()],
        );
    }

    /**
     * The demonstration kitchen's **published** menu — three hand-authored
     * meals that reach the public marketplace end to end (M1), plus the eleven
     * customer-preview meals the fixture assigns to this kitchen.
     *
     * Everything above this method is structure: a catalogue with nothing on
     * sale, a draft tariff demonstrating the price-list publish gate, a plan
     * deliberately left unpublishable. That is the right shape for testing
     * gates and the wrong shape for testing a marketplace, which answers with
     * an empty page and proves nothing. These three meals are the smallest
     * complete world in which `GET /marketplace/meals` returns something real.
     *
     * **Complete means all four conditions, none of them shortcut:**
     *
     * 1. **An allergen basis.** Each meal lists its own ingredients, and the
     *    ingredients carry *verified* allergen mappings — freekeh contains
     *    gluten, tahini contains sesame. The derivation reads those mappings, so
     *    the allergen list a customer filters on is computed from a kitchen's
     *    declaration rather than typed into a fixture.
     * 2. **Both languages.** Arabic names and descriptions, because the
     *    readiness gate refuses a half-translated listing and an Arabic customer
     *    reading English is exactly what that gate exists to prevent.
     * 3. **A confirmed price on an active tariff assigned to a consumer
     *    channel.** A separate list from `verdant-web-usd`, which is a draft on
     *    purpose and must stay one — a single list cannot be a draft and active
     *    at once, and the draft is the fixture the price-list publish gate is
     *    tested against.
     * 4. **Channel availability.** A published, priced meal that no channel
     *    offers is not on sale, and the marketplace query says so.
     *
     * **The readiness evaluator decides, not this seeder.** Each meal is passed
     * to `CatalogueItemReadiness` and published only if it reports no reasons at
     * all; a meal that is not ready aborts the seed with its reasons rather than
     * being published anyway. A seeder that quietly wrote `status = published`
     * would be manufacturing exactly the state the whole publication apparatus
     * exists to make impossible.
     *
     * `chicken-freekeh-bowl` above is untouched and stays a draft with a
     * placeholder price: it is the control. Every marketplace test can assert
     * that a kitchen's unfinished work is invisible by naming a row that really
     * is unfinished.
     */
    private function seedVerdantMenu(Organisation $verdant, SalesChannel $webShop, User $creator): void
    {
        $catalogue = Catalogue::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'default')
            ->sole();

        $gram = MeasurementUnit::query()->where('code', 'g')->sole();

        $freekeh = $this->demoIngredient($verdant, 'freekeh', 'Freekeh', 'فريكة', $gram, 'gluten', $creator);
        $tahini = $this->demoIngredient($verdant, 'tahini', 'Tahini', 'طحينة', $gram, 'sesame', $creator);
        $chicken = $this->demoIngredient($verdant, 'chicken-breast', 'Chicken breast', 'صدر دجاج', $gram, null, $creator);
        $lentils = $this->demoIngredient($verdant, 'red-lentils', 'Red lentils', 'عدس أحمر', $gram, null, $creator);

        $previewComposition = $this->demoIngredient(
            $verdant,
            'preview-meal-composition',
            'Preview meal composition',
            'مكونات وجبة تجريبية',
            $gram,
            null,
            $creator,
        );

        $menu = PriceList::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => 'verdant-menu-usd'],
            [
                'name_en' => 'Web shop menu',
                'name_ar' => 'قائمة المتجر الإلكتروني',
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::PublicTariff,
                'status' => PriceListStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        ChannelPriceList::withoutTenancy()->updateOrCreate(
            ['sales_channel_id' => $webShop->getKey(), 'price_list_id' => $menu->getKey()],
            ['organisation_id' => $verdant->getKey(), 'priority' => 1, 'created_by' => $creator->getKey()],
        );

        $menuItems = [
            [
                'slug' => 'grilled-chicken-freekeh',
                'name_en' => 'Grilled chicken and freekeh',
                'name_ar' => 'دجاج مشوي مع الفريكة',
                'description_en' => 'Grilled chicken breast, cracked freekeh and a lemon dressing.',
                'description_ar' => 'صدر دجاج مشوي مع الفريكة المجروشة وصلصة الليمون.',
                'ingredients' => [$chicken, $freekeh],
                'amount_minor' => 4200,
                'diets' => ['high_protein'],
                'nutrition_facts' => $this->previewNutritionFacts(
                    servingLabel: '1 bowl',
                    grams: 340,
                    amounts: [
                        ['nutrient_id' => 'energy', 'unit' => 'kcal', 'value' => 500],
                        ['nutrient_id' => 'protein', 'unit' => 'g', 'value' => 50.0],
                        ['nutrient_id' => 'carbohydrate', 'unit' => 'g', 'value' => 32.0],
                        ['nutrient_id' => 'fat', 'unit' => 'g', 'value' => 17.0],
                        ['nutrient_id' => 'fibre', 'unit' => 'g', 'value' => 6.0],
                        ['nutrient_id' => 'saturated_fat', 'unit' => 'g', 'value' => 2.8],
                        ['nutrient_id' => 'sodium', 'unit' => 'mg', 'value' => 110],
                    ],
                    notes: [
                        'Preview estimate for 140 g cooked chicken breast, 50 g dry freekeh before cooking, lemon dressing and vegetables.',
                        'Component references: USDA FoodData Central 171477 (roasted chicken breast) and 2476063 (freekeh).',
                    ],
                ),
            ],
            [
                'slug' => 'mezze-plate',
                'name_en' => 'Mezze plate',
                'name_ar' => 'صحن مقبلات',
                'description_en' => 'Hummus, muhammara and a tahini dressing with warm bread.',
                'description_ar' => 'حمص ومحمرة وصلصة الطحينة مع الخبز الدافئ.',
                'ingredients' => [$tahini],
                'amount_minor' => 3800,
                'diets' => ['vegetarian'],
                'nutrition_facts' => $this->previewNutritionFacts(
                    servingLabel: '1 mezze plate',
                    grams: 300,
                    amounts: [
                        ['nutrient_id' => 'energy', 'unit' => 'kcal', 'value' => 480],
                        ['nutrient_id' => 'protein', 'unit' => 'g', 'value' => 14.0],
                        ['nutrient_id' => 'carbohydrate', 'unit' => 'g', 'value' => 44.0],
                        ['nutrient_id' => 'fat', 'unit' => 'g', 'value' => 29.0],
                        ['nutrient_id' => 'fibre', 'unit' => 'g', 'value' => 6.5],
                        ['nutrient_id' => 'saturated_fat', 'unit' => 'g', 'value' => 5.0],
                        ['nutrient_id' => 'sodium', 'unit' => 'mg', 'value' => 500],
                    ],
                    notes: [
                        'Preview estimate for hummus, muhammara, tahini dressing, warm pita and raw vegetables.',
                        'Component references: USDA FoodData Central 321358 (commercial hummus), 2707587 (tahini) and 2707616 (pita bread).',
                    ],
                ),
            ],
            [
                'slug' => 'red-lentil-soup',
                'name_en' => 'Red lentil soup',
                'name_ar' => 'شوربة العدس الأحمر',
                'description_en' => 'Red lentils simmered with cumin and finished with lemon.',
                'description_ar' => 'عدس أحمر مطهو مع الكمون ويقدّم مع الليمون.',
                'ingredients' => [$lentils],
                'amount_minor' => 2600,
                'diets' => ['vegan', 'vegetarian'],
                'nutrition_facts' => $this->previewNutritionFacts(
                    servingLabel: '1 bowl',
                    grams: 350,
                    amounts: [
                        ['nutrient_id' => 'energy', 'unit' => 'kcal', 'value' => 310],
                        ['nutrient_id' => 'protein', 'unit' => 'g', 'value' => 17.0],
                        ['nutrient_id' => 'carbohydrate', 'unit' => 'g', 'value' => 47.0],
                        ['nutrient_id' => 'fat', 'unit' => 'g', 'value' => 7.5],
                        ['nutrient_id' => 'fibre', 'unit' => 'g', 'value' => 14.0],
                        ['nutrient_id' => 'saturated_fat', 'unit' => 'g', 'value' => 1.0],
                        ['nutrient_id' => 'sodium', 'unit' => 'mg', 'value' => 620],
                    ],
                    notes: [
                        'Preview estimate for a 350 g red-lentil, vegetable, cumin and lemon soup with olive oil.',
                        'Cross-checked against USDA FoodData Central 171549 (ready-to-serve lentil soup); recipe composition and seasoning remain provisional.',
                    ],
                ),
            ],
        ];

        /** @var list<array{slug: string, kitchen_slug: string, name: string, description: string, diets: list<string>, amount_minor: int, serving_label: string, grams: int|float|null, amounts: array<string, int|float>, note: string}> $prototypeMeals */
        $prototypeMeals = require database_path('seeders/fixtures/prototype_marketplace_meals.php');

        foreach ($prototypeMeals as $prototypeMeal) {
            // Only the rows this kitchen cooks. The fixture names an owning
            // kitchen per meal, and the other twenty-six belong to the preview
            // kitchens `MarketplaceKitchensSeeder` seeds — a copy of each under
            // Verdant would put the same dish on the marketplace twice, under
            // two different kitchens' names.
            if ($prototypeMeal['kitchen_slug'] !== 'verdant-kitchen') {
                continue;
            }

            $menuItems[] = [
                'slug' => $prototypeMeal['slug'],
                'name_en' => $prototypeMeal['name'],
                // The prototype supplied English display copy only. A non-empty
                // marker keeps the menu publishable while making remaining
                // localisation work obvious in Arabic preview mode.
                'name_ar' => 'وجبة تجريبية: '.$prototypeMeal['name'],
                'description_en' => $prototypeMeal['description'],
                'description_ar' => 'وصف تجريبي — تحتاج هذه الوجبة إلى وصف عربي مراجع.',
                // The full recipes live only in the customer mock. This neutral
                // fixture row gives the API demo menu the required allergen basis
                // without claiming a temporary preview is an ingredient-level
                // recipe declaration.
                'ingredients' => [$previewComposition],
                'amount_minor' => $prototypeMeal['amount_minor'],
                'diets' => $prototypeMeal['diets'],
                'nutrition_facts' => $this->mockPreviewNutritionFacts($prototypeMeal),
            ];
        }

        $readiness = App::make(CatalogueItemReadiness::class);

        foreach ($menuItems as $definition) {
            $meal = $this->catalogueItem(
                $verdant,
                $catalogue,
                $definition['slug'],
                CatalogueItemType::Meal,
                $definition['name_en'],
                $definition['name_ar'],
                $creator,
            );

            $meal->forceFill([
                'description_en' => $definition['description_en'],
                'description_ar' => $definition['description_ar'],
                'image_placeholder_id' => 'meal-'.$definition['slug'],
                'nutrition_facts' => $definition['nutrition_facts'],
            ])->save();

            foreach ($definition['ingredients'] as $order => $ingredient) {
                CatalogueItemIngredient::withoutTenancy()->updateOrCreate(
                    ['catalogue_item_id' => $meal->getKey(), 'ingredient_id' => $ingredient->getKey()],
                    [
                        'organisation_id' => $verdant->getKey(),
                        'is_representative' => true,
                        'display_order' => $order + 1,
                        'created_by' => $creator->getKey(),
                    ],
                );
            }

            foreach ($definition['diets'] as $code) {
                $classification = DietClassification::query()->where('code', $code)->sole();

                CatalogueItemDietClassification::withoutTenancy()->updateOrCreate(
                    [
                        'catalogue_item_id' => $meal->getKey(),
                        'diet_classification_id' => $classification->getKey(),
                    ],
                    ['organisation_id' => $verdant->getKey()],
                );
            }

            $this->price($menu, (string) $meal->getKey(), null, null, $definition['amount_minor'], PriceStatus::Confirmed, $creator);

            ChannelCatalogueItem::withoutTenancy()->updateOrCreate(
                [
                    'sales_channel_id' => $webShop->getKey(),
                    'catalogue_item_id' => $meal->getKey(),
                    'catalogue_item_variant_id' => null,
                ],
                [
                    'organisation_id' => $verdant->getKey(),
                    'is_available' => true,
                    'available_from' => null,
                    'available_to' => null,
                    'created_by' => $creator->getKey(),
                ],
            );

            // Re-read: the readiness evaluator queries by identifier, and the
            // in-memory model is stale about the rows just written beneath it.
            $meal->refresh();

            $reasons = $readiness->reasons($meal);

            if ($reasons !== []) {
                throw new RuntimeException(sprintf(
                    'The demo menu item %s is not ready to publish: %s. A seeder must never publish past the gate.',
                    $definition['slug'],
                    implode(', ', array_column($reasons, 'code')),
                ));
            }

            $meal->forceFill(['status' => CatalogueItemStatus::Published])->save();
        }
    }

    /**
     * Preview-only per-serving facts for the small API demonstration menu.
     *
     * These are explicitly synthetic estimates, not a kitchen declaration or
     * laboratory analysis.  The complete payload lives with the menu item so
     * it can later be replaced atomically by a verified source.
     *
     * @param  list<array{nutrient_id: string, unit: string, value: float|int}>  $amounts
     * @param  list<string>  $notes
     * @return array<string, mixed>
     */
    private function previewNutritionFacts(string $servingLabel, int $grams, array $amounts, array $notes): array
    {
        $withKind = array_map(
            static fn (array $amount): array => [...$amount, 'kind' => 'planned', 'tolerance' => null],
            $amounts,
        );

        return [
            'basis' => 'per_serving',
            'kind' => 'planned',
            'serving' => [
                'label' => $servingLabel,
                'quantity' => 1,
                'unit' => 'portion',
                'grams' => $grams,
                'millilitres' => null,
                'household_measure' => null,
            ],
            'total_grams' => $grams,
            'amounts' => $withKind,
            'source' => [
                'kind' => 'synthetic_prototype',
                'label' => 'USDA FoodData Central component estimate — preview only',
                'version' => 'USDA FDC, accessed 2026-08-10',
                'calculated_at' => '2026-08-10T00:00:00+00:00',
            ],
            'calculation' => [
                'method' => 'seed.preview_component_estimate',
                'basis' => 'per_serving',
                'calculated_at' => '2026-08-10T00:00:00+00:00',
                'prototype' => true,
                'rounding' => 'Energy rounded to the nearest 10 kcal; grams to one decimal place; sodium to the nearest 10 mg.',
                'notes' => $notes,
            ],
        ];
    }

    /**
     * Converts the existing customer mock's per-serving facts into the API
     * record shape. The mock is deliberately marked synthetic; it is present
     * solely so API-mode previews match the 40 photographed customer meals —
     * fourteen of them here, the other twenty-six under the preview kitchens
     * `MarketplaceKitchensSeeder` seeds.
     *
     * @param  array{serving_label: string, grams: int|float|null, amounts: array<string, int|float>, note: string}  $meal
     * @return array<string, mixed>
     */
    private function mockPreviewNutritionFacts(array $meal): array
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

        foreach ($meal['amounts'] as $nutrientId => $value) {
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
     * One demonstration ingredient, with a verified allergen mapping when it
     * carries an allergen at all.
     *
     * `verified` rather than `unverified` because these stand in for a kitchen
     * that has done the work: the derivation reads the mapping either way, and
     * seeding an unverified one would put the demo world in the state K1.8's
     * review queue exists to clear rather than in the state a published menu
     * requires.
     */
    private function demoIngredient(
        Organisation $organisation,
        string $slug,
        string $nameEn,
        string $nameAr,
        MeasurementUnit $unit,
        ?string $allergenCode,
        User $creator,
    ): Ingredient {
        $ingredient = Ingredient::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'slug' => $slug],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'default_unit_id' => $unit->getKey(),
                'status' => IngredientStatus::Active,
                'verification_status' => IngredientVerificationStatus::Verified,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );

        if ($allergenCode !== null) {
            IngredientAllergen::withoutTenancy()->updateOrCreate(
                [
                    'ingredient_id' => $ingredient->getKey(),
                    'organisation_id' => $organisation->getKey(),
                    'allergen_code' => $allergenCode,
                    'market_scope' => AllergenMarketScope::All,
                ],
                [
                    'containment' => AllergenContainment::Contains,
                    'source' => AllergenMappingSource::KitchenDeclared,
                    'verification_status' => AllergenVerificationStatus::Verified,
                    'created_by' => $creator->getKey(),
                ],
            );
        }

        return $ingredient;
    }

    private function catalogueItem(
        Organisation $organisation,
        Catalogue $catalogue,
        string $slug,
        CatalogueItemType $type,
        string $nameEn,
        string $nameAr,
        User $creator,
    ): CatalogueItem {
        return CatalogueItem::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'slug' => $slug],
            [
                'catalogue_id' => $catalogue->getKey(),
                'item_type' => $type,
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'status' => CatalogueItemStatus::Draft,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * One standing price row, idempotent on the pricing point.
     *
     * Keyed on the point rather than blindly inserted, because a seeder that
     * ran twice would otherwise hit the partial unique index that permits one
     * standing row per point — the constraint working exactly as intended, and
     * an unhelpful way to discover it.
     */
    private function price(
        PriceList $priceList,
        string $catalogueItemId,
        ?string $variantId,
        ?string $minQuantity,
        ?int $amountMinor,
        PriceStatus $status,
        User $creator,
    ): void {
        $this->forOrganisation((string) $priceList->organisation_id, fn () => PriceListItem::withoutTenancy()->updateOrCreate(
            [
                'price_list_id' => $priceList->getKey(),
                'catalogue_item_id' => $catalogueItemId,
                'catalogue_item_variant_id' => $variantId,
                'min_quantity' => $minQuantity,
                'effective_to' => null,
            ],
            [
                'organisation_id' => $priceList->organisation_id,
                'unit_amount_minor' => $amountMinor,
                'price_status' => $status,
                'effective_from' => now()->toDateString(),
                'created_by' => $creator->getKey(),
            ],
        ));
    }

    /**
     * The platform operator's own workspace, and the only supported way to
     * hold a platform permission.
     */
    private function seedPlatformOperator(): void
    {
        $ops = $this->user('ops@healthy360.test', 'Yara', 'Deeb', 'en', 'LB');

        $platform = $this->organisation('Healthy360 Operations', 'healthy360-operations', 'platform_operator', 'LB', 'USD', 'en', $ops);

        $this->membership($platform, $ops, null, 'member', $ops);

        // A bespoke, organisation-scoped role — deliberately not a template.
        // Template roles are built from organisationPermissions() alone, so no
        // template can ever carry a platform code; this is what "granted
        // deliberately, one organisation at a time" looks like in practice.
        $role = $this->forOrganisation((string) $platform->getKey(), fn (): Role => Role::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $platform->getKey(), 'code' => 'reference_editor'],
            [
                'name_en' => 'Reference editor',
                'name_ar' => 'محرّر البيانات المرجعية',
                'is_system' => false,
                'created_by' => $ops->getKey(),
            ],
        ));

        foreach (array_keys(PermissionRegistry::platformPermissions()) as $code) {
            $permission = Permission::query()->where('code', $code)->firstOrFail();

            RolePermission::withoutTenancy()->updateOrCreate(
                ['role_id' => $role->getKey(), 'permission_id' => $permission->getKey()],
                ['organisation_id' => $platform->getKey()],
            );
        }

        // Platform operators also curate the shared ingredient library and can
        // exercise the kitchen operating surface, both organisation-scoped
        // capabilities like any other. INV1.0 moved that surface onto its own
        // `inventory.*` domain, so the bespoke role gains the three inventory
        // codes alongside the catalogue pair to keep the demo consistent.
        foreach ([
            'catalogue.view_organisation',
            'catalogue.manage_organisation',
            'inventory.view_organisation',
            'inventory.manage_organisation',
            'inventory.view_costs_organisation',
        ] as $code) {
            $permission = Permission::query()->where('code', $code)->firstOrFail();

            RolePermission::withoutTenancy()->updateOrCreate(
                ['role_id' => $role->getKey(), 'permission_id' => $permission->getKey()],
                ['organisation_id' => $platform->getKey()],
            );
        }

        $this->forOrganisation((string) $platform->getKey(), function () use ($platform, $ops, $role): void {
            $membership = OrganisationMembership::withoutTenancy()
                ->where('organisation_id', $platform->getKey())
                ->where('user_id', $ops->getKey())
                ->firstOrFail();

            MembershipRole::withoutTenancy()->updateOrCreate(
                ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
                ['organisation_id' => $platform->getKey(), 'created_by' => $ops->getKey()],
            );
        });
    }

    /**
     * Add a second template role to an existing membership.
     */
    private function addRole(Organisation $organisation, User $user, string $templateRoleCode, User $creator): void
    {
        $this->forOrganisation((string) $organisation->getKey(), function () use ($organisation, $user, $templateRoleCode, $creator): void {
            $membership = OrganisationMembership::withoutTenancy()
                ->where('organisation_id', $organisation->getKey())
                ->where('user_id', $user->getKey())
                ->firstOrFail();

            $role = Role::withoutTenancy()
                ->whereNull('organisation_id')
                ->where('code', $templateRoleCode)
                ->firstOrFail();

            MembershipRole::withoutTenancy()->updateOrCreate(
                ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
                ['organisation_id' => $organisation->getKey(), 'created_by' => $creator->getKey()],
            );
        });
    }

    /**
     * A demonstration account with two-factor authentication **fully enrolled**
     * against a fixed, published secret.
     *
     * The secret is `JBSWY3DPEHPK3PXP` — the canonical RFC 4648 base32 test
     * vector, written here on purpose so an end-to-end suite can compute a
     * valid TOTP for this account without scraping one out of the database.
     * It is safe precisely because it is public: this seeder never runs outside
     * `local` and `testing`, and every account it creates already shares one
     * well-known password.
     *
     * Enrolment is written the way Fortify writes it, not approximated:
     * `two_factor_secret` and `two_factor_recovery_codes` hold ciphertext from
     * Fortify's own encrypter (the columns are not Eloquent casts — see
     * {@see User}), the recovery codes are a JSON list in the same shape
     * `EnableTwoFactorAuthentication` produces, and `two_factor_confirmed_at`
     * is stamped because this account is past the two-step enrolment rather
     * than half-way through it. `POST /auth/tokens` challenges it, so a client
     * that omits `two_factor_code` gets `auth.two_factor_required`.
     */
    private function enrolTwoFactor(User $user): void
    {
        $user->forceFill([
            'two_factor_secret' => Fortify::currentEncrypter()->encrypt(self::DEMO_TOTP_SECRET),
            'two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt((string) json_encode([
                'h360demo01-recovery01',
                'h360demo02-recovery02',
                'h360demo03-recovery03',
                'h360demo04-recovery04',
                'h360demo05-recovery05',
                'h360demo06-recovery06',
                'h360demo07-recovery07',
                'h360demo08-recovery08',
            ])),
            'two_factor_confirmed_at' => now(),
        ])->save();
    }

    private function user(string $email, string $givenName, string $familyName, string $languageCode, string $countryCode): User
    {
        $user = User::query()->firstOrNew(['email' => $email]);
        $user->password = self::DEMO_PASSWORD;
        $user->email_verified_at = now();
        $user->save();

        UserProfile::query()->updateOrCreate(
            ['user_id' => $user->getKey()],
            [
                'given_name' => $givenName,
                'family_name' => $familyName,
                'preferred_language_code' => $languageCode,
                'country_code' => $countryCode,
                'timezone' => $countryCode === 'AE' ? 'Asia/Dubai' : 'Asia/Beirut',
                'numbering_system' => 'latn',
                'created_by' => $user->getKey(),
            ],
        );

        return $user;
    }

    private function organisation(
        string $name,
        string $slug,
        string $typeCode,
        string $countryCode,
        string $currencyCode,
        string $languageCode,
        User $creator,
    ): Organisation {
        $type = OrganisationType::query()->where('code', $typeCode)->firstOrFail();

        return Organisation::query()->updateOrCreate(
            ['slug' => $slug],
            [
                'organisation_type_id' => $type->getKey(),
                'name' => $name,
                'country_code' => $countryCode,
                'default_currency_code' => $currencyCode,
                'default_language_code' => $languageCode,
                'status' => OrganisationStatus::Active,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * Publish an organisation to the database session for one write, so
     * row-level security admits it on the RLS-subject application connection —
     * the local default (`healthy360_app`). This is the database-session half
     * of the `withoutTenancy()` these writes already carry at the Eloquent
     * layer: seeding is an explicit, auditable cross-tenant path, and each
     * organisation_id is declared from the row being created rather than an
     * ambient request context. On the schema-owning connection the test suite
     * and `--database=pgsql_migrations` use, the write bypasses RLS by
     * ownership regardless, so the declaration is simply harmless there.
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

    private function branch(Organisation $organisation, string $name, string $city, string $timezone, User $creator): OrganisationBranch
    {
        return $this->forOrganisation((string) $organisation->getKey(), fn (): OrganisationBranch => OrganisationBranch::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'name' => $name],
            [
                'country_code' => $organisation->country_code,
                'city' => $city,
                'timezone' => $timezone,
                'status' => BranchStatus::Active,
                'created_by' => $creator->getKey(),
            ],
        ));
    }

    /**
     * A route to market for a demonstration kitchen.
     *
     * `updateOrCreate` rather than the reference seeders' insert-if-absent:
     * this is demo scaffolding in a `local`/`testing`-only seeder, not curated
     * platform data somebody edits and expects to keep.
     */
    private function salesChannel(
        Organisation $organisation,
        string $code,
        string $kind,
        string $nameEn,
        string $nameAr,
        ?string $orderSource,
        User $creator,
    ): SalesChannel {
        return SalesChannel::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'channel_kind' => $kind,
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'order_source' => $orderSource,
                'status' => SalesChannelStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );
    }

    private function capability(Organisation $organisation, string $capability, User $creator): void
    {
        OrganisationCapability::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'capability' => $capability],
            ['is_enabled' => true, 'created_by' => $creator->getKey()],
        );
    }

    private function membership(
        Organisation $organisation,
        User $user,
        ?OrganisationBranch $branch,
        string $templateRoleCode,
        User $creator,
    ): OrganisationMembership {
        $membership = $this->forOrganisation((string) $organisation->getKey(), fn (): OrganisationMembership => OrganisationMembership::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'user_id' => $user->getKey()],
            [
                'branch_id' => $branch?->getKey(),
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $creator->getKey(),
            ],
        ));

        $role = Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', $templateRoleCode)
            ->firstOrFail();

        MembershipRole::withoutTenancy()->updateOrCreate(
            ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
            ['organisation_id' => $organisation->getKey(), 'created_by' => $creator->getKey()],
        );

        return $membership;
    }
}
