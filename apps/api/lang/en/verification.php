<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Verification messages (en)
|--------------------------------------------------------------------------
|
| The first server-side translation namespace in the platform. It exists
| because a passcode message is composed in a queue worker with no request
| behind it — there is no Accept-Language header to negotiate against — so the
| recipient's own language, read from their profile, is applied explicitly at
| render time.
|
| Deliberately short. Only what a person actually receives lives here; error
| copy stays with the client, which is where it can be shown in context.
|
*/

return [

    'otp' => [

        'subject' => 'Your :app verification code',

        'greeting' => 'Hello,',

        'greeting_named' => 'Hello :name,',

        'intro' => 'Use this code to confirm your details with :app.',

        // Pluralised because the expiry is configuration and a five-minute
        // default is not a promise the copy may hard-code.
        'expiry' => 'The code expires in one minute.|The code expires in :minutes minutes.',

        'unexpected' => 'If you did not ask for this code, you can ignore this message — nothing has changed on your account.',
    ],

    'email_verification' => [

        'subject' => 'Confirm your :app email address',

        'greeting' => 'Hello,',

        'greeting_named' => 'Hello :name,',

        'intro' => 'Confirm this address to finish setting up your account.',

        'action' => 'Confirm email address',

        'code_intro' => 'Or enter this code in the app:',

        'expiry' => 'The link and the code expire in one minute.|The link and the code expire in :minutes minutes.',

        'unexpected' => 'If you did not create an account, you can ignore this message.',
    ],
];
