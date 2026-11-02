<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Kitchens\Import\Parsers\ProductListParser;
use Healthy360\Kitchens\Import\Runtime\DesignationDictionary;
use Healthy360\Kitchens\Import\Runtime\DesignationResolver;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\KitchenWorkbookWorld;
use Healthy360\Kitchens\Import\Runtime\ProductWriter;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Loads Verdant's sellable product sheet into the demonstration kitchen.
 *
 * Uses the same {@see ProductListParser} / {@see ProductWriter} path as
 * `kitchen:import-workbook`, but:
 *
 * - targets Verdant's existing `web-shop` / `wholesale` channels;
 * - writes onto **active** public tariffs (demo must be buyable);
 * - gives each product its Arabic name, which the sheet does not carry;
 * - publishes every product that passes readiness, assessed by the owner.
 *
 * The fixture is a committed copy of the Phase-1 product list (names, packs,
 * B2C/B2B amounts) — not recipes or formulations.
 */
final class VerdantProductCatalogueSeeder extends Seeder
{
    public const string SOURCE_SYSTEM = 'demo-verdant-products';

    public const string FIXTURE = 'verdant-product-list.md';

    public const string PRICE_LIST_B2C = 'verdant-products-b2c-usd';

    public const string PRICE_LIST_B2B = 'verdant-products-b2b-usd';

    /**
     * The product sheet is English-only, and the publish gate refuses English
     * copied into the Arabic column, so the demo carries its own translations:
     * without them nothing on the sheet could go on sale.
     *
     * @var array<string, string> sheet name → Arabic name
     */
    private const array ARABIC_NAMES = [
        'Marinated Chicken Breast' => 'صدر دجاج متبّل',
        'White Chicken Taouk' => 'طاووق دجاج أبيض',
        'Red Chicken Taouk' => 'طاووق دجاج أحمر',
        'Americain Beef Patty' => 'قرص لحم بقر أميركي',
        'Smash Burger' => 'سماش برغر',
        'Lebanese Beef Patty' => 'قرص لحم بقر لبناني',
        'Mozzarella Sticks' => 'أصابع موزاريلا',
        'Honey Mustard Sauce' => 'صلصة الخردل بالعسل',
        'Classic Beef Sauce' => 'صلصة اللحم الكلاسيكية',
        'Mushroom Sauce' => 'صلصة الفطر',
        'Truffle Sauce' => 'صلصة الكمأة',
        'Ranch Sauce' => 'صلصة رانش',
        'Caesar Sauce' => 'صلصة سيزر',
        'BBq Dip Sauce' => 'صلصة باربيكيو للتغميس',
        'Buffalo Dip Sauce' => 'صلصة بافالو للتغميس',
        'Steak Sauce' => 'صلصة الستيك',
        'Aioli Sauce' => 'صلصة أيولي',
        'Guacamole' => 'غواكامولي',
        'Sour Cream' => 'قشدة حامضة',
        'Sweet & Sour Sauce' => 'صلصة حلوة وحامضة',
        'Pesto Saue' => 'صلصة بيستو',
        'Pesto Mayo Sauce' => 'صلصة مايونيز بالبيستو',
        'Thousand Islands' => 'صلصة ثاوزند آيلاند',
        'Garlic Mayo Sauce' => 'صلصة مايونيز بالثوم',
        'Caramelised Onion' => 'بصل مكرمل',
        'Sunflower Oil' => 'زيت دوار الشمس',
        'Turkey Bacon' => 'لحم ديك رومي مقدد',
        'Turkey Breast' => 'صدر ديك رومي',
        'Filet Steak' => 'ستيك فيليه',
        'Mozzarella Patty' => 'قرص موزاريلا',
        'Mozzarella Bricks' => 'قوالب موزاريلا',
        'Cheddar Patty' => 'قرص شيدر',
        'Cheese Balls' => 'كرات الجبن',
        'Jalapenos Bites' => 'لقيمات هالبينو',
        'Shortening Oil' => 'زيت القلي النباتي',
        'Olive Oil' => 'زيت زيتون',
        'Mayonnaise' => 'مايونيز',
        'Ketchup' => 'كاتشب',
        'BBq' => 'باربيكيو',
        'Cheddar Sauce' => 'صلصة شيدر',
        'Dill Pickles' => 'مخلل الخيار بالشبت',
        'Jalapenos Pickles' => 'مخلل هالبينو',
        'Yellow Mustard' => 'خردل أصفر',
        'Dijon Mustard' => 'خردل ديجون',
        'Sriracha' => 'سريراتشا',
        'Worcestershire Sauce' => 'صلصة ورسيستر',
        'Soy Sauce' => 'صلصة الصويا',
        'Burger Bun' => 'خبز برغر',
        'Tortilla bread' => 'خبز تورتيلا',
        'Cheddar Bloc' => 'قالب شيدر',
        'Swiss Bloc' => 'قالب جبن سويسري',
        'Parmesan Cheese' => 'جبن بارميزان',
        'Mozzarella Shredded' => 'موزاريلا مبشورة',
        'Fresh Cream' => 'قشدة طازجة',
        'Butter' => 'زبدة',
        'Cucumber, Tomato, Onion, carrot, White Cabbage, Red Cabbage…....( All Kinds)' => 'خيار، بندورة، بصل، جزر، ملفوف أبيض، ملفوف أحمر (جميع الأنواع)',
        'Iceberg, Rocket Leaves, Parsley, Coriander…. (all Kinds)' => 'خس آيسبرغ، جرجير، بقدونس، كزبرة (جميع الأنواع)',
        'Chicken Crispy' => 'دجاج مقرمش',
        'Chicken Zinger' => 'دجاج زنجر',
        'Chicken Wings' => 'أجنحة دجاج',
        'Chicken Escalope' => 'إسكالوب دجاج',
        'Chicken Strips' => 'شرائح دجاج',
        'Chicken Nuggets' => 'ناغتس دجاج',
        'Chicken Burger' => 'برغر دجاج',
    ];

    public function run(): void
    {
        $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->first();

        if (! $verdant instanceof Organisation) {
            throw new RuntimeException('Verdant Kitchen must exist before its product catalogue is seeded.');
        }

        $webShop = SalesChannel::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'web-shop')
            ->sole();
        $wholesale = SalesChannel::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'wholesale')
            ->sole();

        $creator = User::query()->where('email', 'owner@verdant.test')->first();

        if (! $creator instanceof User) {
            throw new RuntimeException("Verdant's owner (owner@verdant.test) must exist before its product catalogue is seeded.");
        }

        $catalogue = Catalogue::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'default')
            ->sole();

        $b2cList = $this->activeTariff(
            $verdant,
            self::PRICE_LIST_B2C,
            'Verdant product retail (USD)',
            'أسعار منتجات فيردانت للتجزئة (دولار)',
            $creator,
        );
        $b2bList = $this->activeTariff(
            $verdant,
            self::PRICE_LIST_B2B,
            'Verdant product wholesale (USD)',
            'أسعار منتجات فيردانت للجملة (دولار)',
            $creator,
        );

        ChannelPriceList::withoutTenancy()->updateOrCreate(
            ['sales_channel_id' => $webShop->getKey(), 'price_list_id' => $b2cList->getKey()],
            ['organisation_id' => $verdant->getKey(), 'priority' => 2, 'created_by' => $creator->getKey()],
        );
        ChannelPriceList::withoutTenancy()->updateOrCreate(
            ['sales_channel_id' => $wholesale->getKey(), 'price_list_id' => $b2bList->getKey()],
            ['organisation_id' => $verdant->getKey(), 'priority' => 1, 'created_by' => $creator->getKey()],
        );

        $fixture = database_path('seeders/fixtures/'.self::FIXTURE);

        if (! is_file($fixture)) {
            throw new RuntimeException('Missing product catalogue fixture at '.$fixture);
        }

        $parsed = ProductListParser::parse((string) file_get_contents($fixture));

        // Full sheet in local demos; a short slice under PHPUnit so the suite
        // stays within RefreshDatabase transaction budgets. Gate on
        // runningUnitTests(), not APP_ENV=testing alone — a polluted shell
        // env must not truncate the demo kitchen catalogue.
        if (app()->runningUnitTests() && count($parsed['rows']) > 8) {
            $parsed['rows'] = array_slice($parsed['rows'], 0, 8);
        }

        $options = new ImportOptions(
            sourceDirectory: database_path('seeders/fixtures'),
            organisationSlug: 'verdant-kitchen',
        );
        $report = new ImportReport($options, (string) app()->environment());

        $organisationId = (string) $verdant->getKey();

        // Measurement-unit ids are cached statically; RefreshDatabase rolls the
        // reference rows back between tests, so a stale map would write FK
        // violations that abort the PostgreSQL transaction for every later test.
        UnitMap::forget();

        app(DatabaseTenantContext::class)->during(null, $organisationId, null, function () use (
            $parsed,
            $organisationId,
            $catalogue,
            $webShop,
            $wholesale,
            $b2cList,
            $b2bList,
            $report,
        ): void {
            $dictionary = DesignationDictionary::load();
            $resolver = new DesignationResolver($dictionary, $organisationId);
            $resolver->refresh();

            // ProductWriter looks up lists/channels by the workbook world's keys.
            (new ProductWriter($dictionary, $resolver, self::SOURCE_SYSTEM))->write(
                $parsed,
                $organisationId,
                $catalogue,
                [
                    KitchenWorkbookWorld::CHANNEL_B2C => $webShop,
                    KitchenWorkbookWorld::CHANNEL_B2B => $wholesale,
                ],
                [
                    KitchenWorkbookWorld::PRICE_LIST_B2C => $b2cList,
                    KitchenWorkbookWorld::PRICE_LIST_B2B => $b2bList,
                ],
                $report,
            );
        });

        $this->publishReadyProducts($organisationId, (string) $creator->getKey());
    }

    private function activeTariff(
        Organisation $verdant,
        string $code,
        string $nameEn,
        string $nameAr,
        User $creator,
    ): PriceList {
        return PriceList::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $verdant->getKey(), 'code' => $code],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::PublicTariff,
                'status' => PriceListStatus::Active,
                'created_by' => $creator->getKey(),
                'updated_by' => $creator->getKey(),
            ],
        );
    }

    private function publishReadyProducts(string $organisationId, string $ownerId): void
    {
        $readiness = app(CatalogueItemReadiness::class);

        $drafts = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', self::SOURCE_SYSTEM)
            ->where('item_type', CatalogueItemType::Product->value)
            ->where('status', CatalogueItemStatus::Draft->value)
            ->get();

        $published = 0;

        foreach ($drafts as $item) {
            if ($item->name_ar === $item->name_en && isset(self::ARABIC_NAMES[$item->name_en])) {
                $item->forceFill(['name_ar' => self::ARABIC_NAMES[$item->name_en]])->save();
            }

            $reasons = $readiness->reasons($item);

            if ($reasons !== []) {
                // Day-rate produce and incomplete packs stay draft — visible only
                // where a confirmed price exists after a human finishes pricing.
                continue;
            }

            // The owner's press of "Assessed: contains none of these". A sheet
            // of bought-in goods has no recipe to answer for it, and an
            // unassessed product is off sale. Demo world only: a real import
            // leaves this for a person, and these rows are not real food data.
            $item->forceFill([
                'status' => CatalogueItemStatus::Published,
                'allergens_assessed_at' => now(),
                'allergens_assessed_by' => $ownerId,
            ])->save();
            $published++;
        }

        $alreadyLive = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', self::SOURCE_SYSTEM)
            ->where('item_type', CatalogueItemType::Product->value)
            ->where('status', CatalogueItemStatus::Published->value)
            ->count();

        if ($published === 0 && $alreadyLive === 0) {
            throw new RuntimeException('Verdant product catalogue seeded no publishable products.');
        }
    }
}
