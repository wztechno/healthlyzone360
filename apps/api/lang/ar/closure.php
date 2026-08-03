<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Account closure messages (ar)
|--------------------------------------------------------------------------
|
| Reviewed Arabic copy, matching the register the verification namespace uses:
| formal, second person, no transliterated product jargon.
|
| The English file is the source of truth for the *set* of keys; a key present
| there and absent here falls back to English rather than to a blank, which is
| Laravel's behaviour and is the right one for a message somebody is entitled
| to be able to read.
|
*/

return [

    'closed' => [

        'subject' => 'تم إغلاق حسابك في :app',

        'intro' => 'تم إغلاق حسابك وحذف بياناتك الشخصية من :app.',

        'orders_retained' => 'احتفظنا بسجلات :count من طلباتك السابقة وفقًا لما تقتضيه القوانين الضريبية والمحاسبية، وقد أُزيل عنوان التوصيل منها.',

        'orders_none' => 'لم يتم الاحتفاظ بأي سجلات طلبات.',

        'unexpected' => 'إذا لم تطلب ذلك، يرجى التواصل معنا فورًا — هذه آخر رسالة يمكننا إرسالها إلى هذا العنوان.',

        'signoff' => 'شكرًا لك على ثقتك بنا.',
    ],
];
