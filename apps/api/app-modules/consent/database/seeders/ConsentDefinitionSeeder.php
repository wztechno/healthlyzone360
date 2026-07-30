<?php

declare(strict_types=1);

namespace Healthy360\Consent\Database\Seeders;

use Healthy360\Consent\Models\ConsentDefinition;
use Illuminate\Database\Seeder;

/**
 * Version 1 of the platform consent texts.
 *
 * The bodies are placeholders and say so: they are explicitly marked as
 * drafts pending legal review, and must be replaced (as a new version — a
 * granted-against version is immutable) before any production launch.
 */
class ConsentDefinitionSeeder extends Seeder
{
    private const string DRAFT_NOTICE_EN = 'Draft pending legal review.';

    private const string DRAFT_NOTICE_AR = 'مسودة بانتظار المراجعة القانونية.';

    /**
     * @var list<array{code: string, purpose: string, body_en: string, body_ar: string}>
     */
    private const array DEFINITIONS = [
        [
            'code' => 'consent.terms',
            'purpose' => 'platform_terms',
            'body_en' => 'You agree to the Healthy360 terms of service governing your use of the platform.',
            'body_ar' => 'أنت توافق على شروط خدمة Healthy360 التي تحكم استخدامك للمنصة.',
        ],
        [
            'code' => 'consent.privacy',
            'purpose' => 'privacy_notice',
            'body_en' => 'You acknowledge the Healthy360 privacy notice describing what personal data we hold, why, and for how long.',
            'body_ar' => 'أنت تقرّ بإشعار الخصوصية الخاص بـ Healthy360 الذي يوضّح البيانات الشخصية التي نحتفظ بها وسببها ومدتها.',
        ],
        [
            'code' => 'consent.health_data_processing',
            'purpose' => 'health_data_processing',
            'body_en' => 'You consent to Healthy360 processing your health data so that the clinics and kitchens you choose can deliver care and nutrition services to you.',
            'body_ar' => 'أنت توافق على قيام Healthy360 بمعالجة بياناتك الصحية لتتمكّن العيادات والمطابخ التي تختارها من تقديم خدمات الرعاية والتغذية لك.',
        ],
    ];

    public function run(): void
    {
        foreach (self::DEFINITIONS as $definition) {
            ConsentDefinition::query()->updateOrCreate(
                ['code' => $definition['code'], 'version' => 1],
                [
                    'purpose' => $definition['purpose'],
                    'body_en' => $definition['body_en'].' '.self::DRAFT_NOTICE_EN,
                    'body_ar' => $definition['body_ar'].' '.self::DRAFT_NOTICE_AR,
                    'is_active' => true,
                ],
            );
        }
    }
}
