<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Account closure messages (en)
|--------------------------------------------------------------------------
|
| Server-side because, like the passcode message, this one is composed in a
| queue worker with no request behind it — and unlike the passcode message, by
| the time it renders the recipient's profile has already been redacted. The
| language is therefore read *before* the erasure and travels with the job.
|
| Deliberately short, and deliberately impersonal. There is no greeting by name
| here and there never will be: addressing somebody by a name the platform has
| just promised to forget would be both absurd and a small breach of the
| promise itself.
|
*/

return [

    'closed' => [

        'subject' => 'Your :app account has been closed',

        'intro' => 'Your account has been closed and your personal details have been deleted from :app.',

        /*
         * The one substantive fact in the message. "You have been forgotten"
         * and "we still hold seven invoices" must not be two separate
         * discoveries, so the retention is stated here rather than left for
         * somebody to find out later.
         */
        'orders_retained' => 'We have kept :count past order records, as tax and accounting law requires. The delivery address on them has been removed.',

        'orders_none' => 'No order records were kept.',

        /*
         * The real purpose of the whole message: a tripwire for somebody who
         * did not ask for this. Once the login stops working this is the only
         * channel left, so the instruction has to be here and has to be
         * plain.
         */
        'unexpected' => 'If you did not ask for this, contact us immediately — this is the last message we can send to this address.',

        'signoff' => 'Thank you for having been with us.',
    ],
];
