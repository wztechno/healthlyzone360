<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Organisation invitation messages (en)
|--------------------------------------------------------------------------
|
| Server-side for the same reason the passcode and closure copy is: the
| recipient has no account on this platform yet, so there is no client to
| render anything and no stored preference to render it in. The language comes
| from the kitchen the person is being handed, which is the best guess
| available and a better one than the operator's own locale.
|
| Deliberately plain. This message asks somebody to click a link that gives
| them control of a business, and the only thing that makes that safe is that
| it reads like exactly what it is.
|
*/

return [

    'owner' => [

        'subject' => 'You have been invited to run :kitchen',

        'heading' => 'Join :kitchen',

        'kitchen_label' => 'Kitchen',
        'role_label' => 'Role',
        'role' => 'Owner',

        'greeting' => 'Hello,',
        'greeting_named' => 'Hello :name,',

        'intro' => 'You have been invited to be the owner of :kitchen on :app. Accepting gives you full control of the kitchen — its menu, its prices, its branches and the people who work in it.',

        'action' => 'Accept the invitation',

        'fallback' => 'If the button does not work, open this link:',

        'expiry' => 'The invitation expires in a few days. Accepting it requires signing in with this email address; if you do not have an account yet, you can create one first.',

        'signoff' => 'If you were not expecting this, you can ignore it — nothing happens until you accept.',

    ],

    // The invitation an organisation's own administrator sends from Add user.
    'member' => [

        'subject' => 'You have been invited to join :organisation',

        'heading' => 'Join :organisation',

        'organisation_label' => 'Organisation',
        'role_label' => 'Role',

        'greeting' => 'Hello,',

        'intro' => 'You have been invited to join :organisation on :app as :role. Accepting lets you sign in and do the work that role allows.',

        'action' => 'Accept the invitation',

        'fallback' => 'If the button does not work, open this link:',

        'expiry' => 'The invitation expires in a few days. Accepting it requires signing in with this email address; if you do not have an account yet, you can create one first.',

        'signoff' => 'If you were not expecting this, you can ignore it — nothing happens until you accept.',

    ],

];
