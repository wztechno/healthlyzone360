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
 *
 * ## The J1 additions
 *
 * Four consumer texts join the three platform ones, taking the catalogue to
 * seven. Each carries an **audience** and an **is_required** flag, which is
 * what stops the consumer set from being shown to a kitchen's chef and what
 * lets the customer activation evaluator ask the catalogue — rather than a
 * hard-coded list in another module — which consents gate activation.
 *
 * **Marketing is not required and defaults to off.** Two separate texts, one
 * per channel, because consenting to email is not consenting to WhatsApp and a
 * single "marketing" grant would quietly claim otherwise.
 *
 * **The Arabic bodies of the new texts carry an explicit awaiting-authoring
 * marker** rather than a translation (OQ-033, master plan v2 §4.18). Legal and
 * regulatory text is never machine-translated, and an Arabic body that *looked*
 * like authored copy would be granted against — creating a consent record
 * whose Arabic text nobody ever approved. The marker is visible, is impossible
 * to mistake for finished copy, and is replaced by a new version when a
 * reviewer supplies the real text. The three original definitions keep their
 * existing Arabic, which was authored with them.
 */
class ConsentDefinitionSeeder extends Seeder
{
    private const string DRAFT_NOTICE_EN = 'Draft pending legal review.';

    private const string DRAFT_NOTICE_AR = 'مسودة بانتظار المراجعة القانونية.';

    /**
     * The placeholder that stands where authored Arabic will go. Deliberately
     * conspicuous: a reviewer scanning the catalogue must be able to see at a
     * glance which texts are not yet real.
     */
    private const string AR_PENDING = '[AR PENDING — نص بانتظار الصياغة العربية المعتمدة (OQ-033)]';

    /**
     * @var list<array{code: string, purpose: string, audience: string, is_required: bool, display_order: int, body_en: string, body_ar: string}>
     */
    private const array DEFINITIONS = [
        [
            'code' => 'consent.terms',
            'purpose' => 'platform_terms',
            'audience' => 'all',
            'is_required' => true,
            'display_order' => 1,
            'body_en' => 'You agree to the Healthy360 terms of service governing your use of the platform.',
            'body_ar' => 'أنت توافق على شروط خدمة Healthy360 التي تحكم استخدامك للمنصة.',
        ],
        [
            'code' => 'consent.privacy',
            'purpose' => 'privacy_notice',
            'audience' => 'all',
            'is_required' => true,
            'display_order' => 2,
            'body_en' => 'You acknowledge the Healthy360 privacy notice describing what personal data we hold, why, and for how long.',
            'body_ar' => 'أنت تقرّ بإشعار الخصوصية الخاص بـ Healthy360 الذي يوضّح البيانات الشخصية التي نحتفظ بها وسببها ومدتها.',
        ],
        [
            'code' => 'consent.health_data_processing',
            'purpose' => 'health_data_processing',
            'audience' => 'd2c',
            'is_required' => true,
            'display_order' => 3,
            'body_en' => 'You consent to Healthy360 processing your health data so that the clinics and kitchens you choose can deliver care and nutrition services to you.',
            'body_ar' => 'أنت توافق على قيام Healthy360 بمعالجة بياناتك الصحية لتتمكّن العيادات والمطابخ التي تختارها من تقديم خدمات الرعاية والتغذية لك.',
        ],
        [
            'code' => 'consent.age_confirmation',
            'purpose' => 'age_confirmation',
            'audience' => 'd2c',
            'is_required' => true,
            'display_order' => 4,
            'body_en' => 'You confirm that you are old enough to hold an account and to order under the law of the country you order from.',
            'body_ar' => self::AR_PENDING,
        ],
        [
            'code' => 'consent.allergen_declaration_accuracy',
            'purpose' => 'allergen_declaration_accuracy',
            'audience' => 'd2c',
            'is_required' => true,
            'display_order' => 5,
            'body_en' => 'You confirm that the allergies and dietary restrictions you declare are accurate and complete, and that you will keep them up to date. Kitchens prepare your food from this declaration.',
            'body_ar' => self::AR_PENDING,
        ],
        [
            'code' => 'consent.marketing_email',
            'purpose' => 'marketing_email',
            'audience' => 'd2c',
            'is_required' => false,
            'display_order' => 6,
            'body_en' => 'You agree to receive offers and product news by email. You can withdraw this at any time without affecting your account.',
            'body_ar' => self::AR_PENDING,
        ],
        [
            'code' => 'consent.marketing_whatsapp',
            'purpose' => 'marketing_whatsapp',
            'audience' => 'd2c',
            'is_required' => false,
            'display_order' => 7,
            'body_en' => 'You agree to receive offers and product news by WhatsApp. You can withdraw this at any time without affecting your account.',
            'body_ar' => self::AR_PENDING,
        ],
    ];

    public function run(): void
    {
        foreach (self::DEFINITIONS as $definition) {
            ConsentDefinition::query()->updateOrCreate(
                ['code' => $definition['code'], 'version' => 1],
                [
                    'purpose' => $definition['purpose'],
                    'audience' => $definition['audience'],
                    'is_required' => $definition['is_required'],
                    'display_order' => $definition['display_order'],
                    'body_en' => $definition['body_en'].' '.self::DRAFT_NOTICE_EN,
                    // The pending marker stands alone: appending a second
                    // notice to it would read as though there were draft
                    // Arabic copy to review, and there is none.
                    'body_ar' => $definition['body_ar'] === self::AR_PENDING
                        ? self::AR_PENDING
                        : $definition['body_ar'].' '.self::DRAFT_NOTICE_AR,
                    'is_active' => true,
                ],
            );
        }
    }
}
