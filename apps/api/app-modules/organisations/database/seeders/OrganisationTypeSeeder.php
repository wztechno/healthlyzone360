<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Database\Seeders;

use Healthy360\Organisations\Models\OrganisationType;
use Illuminate\Database\Seeder;

/**
 * The platform's organisation classifications. Every organisation Healthy360
 * onboards in the foundation phase is one of these twelve types; new types
 * are a data change, not a schema change.
 */
class OrganisationTypeSeeder extends Seeder
{
    /**
     * @var list<array{code: string, name_en: string, name_ar: string}>
     */
    private const array TYPES = [
        ['code' => 'clinic', 'name_en' => 'Clinic', 'name_ar' => 'عيادة'],
        ['code' => 'healthcare_centre', 'name_en' => 'Healthcare centre', 'name_ar' => 'مركز رعاية صحية'],
        ['code' => 'dietitian_practice', 'name_en' => 'Dietitian practice', 'name_ar' => 'عيادة تغذية'],
        ['code' => 'kitchen', 'name_en' => 'Kitchen', 'name_ar' => 'مطبخ'],
        ['code' => 'restaurant', 'name_en' => 'Restaurant', 'name_ar' => 'مطعم'],
        ['code' => 'fitness_centre', 'name_en' => 'Fitness centre', 'name_ar' => 'مركز لياقة بدنية'],
        ['code' => 'wellness_provider', 'name_en' => 'Wellness provider', 'name_ar' => 'مقدّم خدمات العافية'],
        ['code' => 'supplier', 'name_en' => 'Supplier', 'name_ar' => 'مورّد'],
        ['code' => 'delivery_provider', 'name_en' => 'Delivery provider', 'name_ar' => 'مقدّم خدمات التوصيل'],
        ['code' => 'corporate_customer', 'name_en' => 'Corporate customer', 'name_ar' => 'عميل مؤسسي'],
        ['code' => 'insurance_partner', 'name_en' => 'Insurance partner', 'name_ar' => 'شريك تأمين'],
        ['code' => 'platform_operator', 'name_en' => 'Platform operator', 'name_ar' => 'مشغّل المنصة'],
    ];

    public function run(): void
    {
        foreach (self::TYPES as $type) {
            OrganisationType::query()->updateOrCreate(
                ['code' => $type['code']],
                [
                    'name_en' => $type['name_en'],
                    'name_ar' => $type['name_ar'],
                    'is_active' => true,
                ],
            );
        }
    }
}
