<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Verification messages (ar)
|--------------------------------------------------------------------------
|
| Authored Arabic, not machine translation (master plan v2 §4.18, OQ-033).
| These are ordinary product strings — a greeting and an expiry notice — so
| they are written here directly; the rule that legal and regulatory text is
| never machine-translated applies with full force to the consent bodies, which
| is why those carry an explicit "awaiting authored Arabic" marker instead of a
| translation.
|
| The counted strings carry **all six Arabic plural forms** in Laravel's
| explicit-range syntax: {0} zero, {1} one, {2} two, [3,10] few, [11,99] many,
| [100,*] other. Arabic genuinely inflects differently in each, and a two-form
| string — the shape English needs — is wrong for four of the six.
|
*/

return [

    'otp' => [

        'subject' => 'رمز التحقق الخاص بك في :app',

        'greeting' => 'مرحباً،',

        'greeting_named' => 'مرحباً :name،',

        'intro' => 'استخدم هذا الرمز لتأكيد بياناتك لدى :app.',

        'expiry' => '{0} تنتهي صلاحية الرمز الآن.|{1} تنتهي صلاحية الرمز خلال دقيقة واحدة.|{2} تنتهي صلاحية الرمز خلال دقيقتين.|[3,10] تنتهي صلاحية الرمز خلال :minutes دقائق.|[11,99] تنتهي صلاحية الرمز خلال :minutes دقيقة.|[100,*] تنتهي صلاحية الرمز خلال :minutes دقيقة.',

        'unexpected' => 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة — لم يتغيّر شيء في حسابك.',
    ],

    'email_verification' => [

        'subject' => 'أكّد بريدك الإلكتروني في :app',

        'greeting' => 'مرحباً،',

        'greeting_named' => 'مرحباً :name،',

        'intro' => 'أكّد هذا العنوان لإكمال إعداد حسابك.',

        'action' => 'تأكيد البريد الإلكتروني',

        'code_intro' => 'أو أدخل هذا الرمز في التطبيق:',

        'expiry' => '{0} تنتهي صلاحية الرابط والرمز الآن.|{1} تنتهي صلاحية الرابط والرمز خلال دقيقة واحدة.|{2} تنتهي صلاحية الرابط والرمز خلال دقيقتين.|[3,10] تنتهي صلاحية الرابط والرمز خلال :minutes دقائق.|[11,99] تنتهي صلاحية الرابط والرمز خلال :minutes دقيقة.|[100,*] تنتهي صلاحية الرابط والرمز خلال :minutes دقيقة.',

        'unexpected' => 'إذا لم تنشئ حساباً، يمكنك تجاهل هذه الرسالة.',
    ],
];
