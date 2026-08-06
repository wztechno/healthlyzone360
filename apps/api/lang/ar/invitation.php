<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Organisation invitation messages (ar)
|--------------------------------------------------------------------------
|
| Reviewed Arabic copy in the register the verification and closure namespaces
| use: formal, second person, no transliterated product jargon.
|
| The English file is the source of truth for the *set* of keys; a key present
| there and absent here falls back to English rather than to a blank, which is
| Laravel's behaviour and the right one for a message somebody is entitled to
| be able to read.
|
*/

return [

    'owner' => [

        'subject' => 'دعوة لإدارة :kitchen',

        'greeting' => 'مرحبًا،',
        'greeting_named' => 'مرحبًا :name،',

        'intro' => 'تلقّيت دعوة لتكون مالك :kitchen على :app. بقبول الدعوة تحصل على التحكّم الكامل بالمطبخ: القائمة والأسعار والفروع والعاملين فيه.',

        'action' => 'قبول الدعوة',

        'fallback' => 'إذا لم يعمل الزر، افتح هذا الرابط:',

        'expiry' => 'تنتهي صلاحية الدعوة خلال أيام قليلة. يتطلّب قبولها تسجيل الدخول بعنوان البريد الإلكتروني نفسه؛ وإذا لم يكن لديك حساب بعد، يمكنك إنشاؤه أولًا.',

        'signoff' => 'إذا لم تكن تتوقّع هذه الرسالة، يمكنك تجاهلها؛ لا يحدث أي شيء ما لم تقبل الدعوة.',

    ],

];
