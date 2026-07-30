<?php

declare(strict_types=1);

namespace Healthy360\Features\Database\Seeders;

use Healthy360\Features\Models\FeatureDefinition;
use Illuminate\Database\Seeder;

/**
 * The platform feature catalogue. Entitlement to these is granted per
 * organisation (feature_entitlements) and evaluated by
 * FeatureEntitlementChecker — never folded into the RBAC decision.
 */
class FeatureDefinitionSeeder extends Seeder
{
    /**
     * @var list<array{code: string, name_en: string, name_ar: string, description: string}>
     */
    private const array FEATURES = [
        [
            'code' => 'feature.two_factor_enforcement',
            'name_en' => 'Two-factor enforcement',
            'name_ar' => 'فرض المصادقة الثنائية',
            'description' => 'Require confirmed two-factor authentication from every member of the organisation.',
        ],
        [
            'code' => 'feature.multi_branch',
            'name_en' => 'Multiple branches',
            'name_ar' => 'تعدّد الفروع',
            'description' => 'Operate more than one branch under a single organisation.',
        ],
        [
            'code' => 'feature.api_access',
            'name_en' => 'API access',
            'name_ar' => 'الوصول إلى واجهة البرمجة',
            'description' => 'Call the Healthy360 API directly with organisation-issued tokens.',
        ],
        [
            'code' => 'feature.audit_export',
            'name_en' => 'Audit export',
            'name_ar' => 'تصدير سجل التدقيق',
            'description' => "Export the organisation's audit trail for external review.",
        ],
    ];

    public function run(): void
    {
        foreach (self::FEATURES as $feature) {
            FeatureDefinition::query()->updateOrCreate(
                ['code' => $feature['code']],
                [
                    'name_en' => $feature['name_en'],
                    'name_ar' => $feature['name_ar'],
                    'description' => $feature['description'],
                    'is_active' => true,
                ],
            );
        }
    }
}
