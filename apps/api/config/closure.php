<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Grace
    |--------------------------------------------------------------------------
    |
    | How long a proven closure waits before it becomes irreversible.
    |
    | **Zero by default, and that is a product decision.** A person who has
    | decided to be forgotten should not be told to come back in a week. The
    | "cooling-off period" is, more often than not, a retention tactic wearing a
    | safety argument, and this platform does not ship one by default.
    |
    | It is configuration rather than a constant because the argument genuinely
    | runs the other way in two cases: a jurisdiction that requires a reflection
    | period, and an operator who has just been through a wave of account
    | takeovers and wants a window in which a hijacked account's real owner can
    | cancel. Neither should need a deploy.
    |
    | A zero-length window is not a separate code path: the request still passes
    | through `scheduled`, and `FinaliseAccountClosure` is dispatched with a
    | delay of zero. A window that changed the shape of the journey would mean
    | the positive case was the one nobody tested.
    |
    */

    'grace' => [

        /**
         * Hours between verification and finalisation. Clamped at zero.
         */
        'hours' => (int) env('CLOSURE_GRACE_HOURS', 0),
    ],

    /*
    |--------------------------------------------------------------------------
    | Retention
    |--------------------------------------------------------------------------
    |
    | PROVISIONAL, pending the retention decision (OQ-002 / OQ-029). Named as
    | configuration here so nothing downstream can present it as a settled legal
    | period.
    |
    */

    'retention' => [

        /**
         * How long a completed or cancelled closure request row is kept.
         *
         * Nothing reads this yet — no sweep deletes these rows, and writing one
         * before the retention decision exists would be fabricating the
         * decision. The setting exists so the number has one home when the
         * answer arrives.
         *
         * Note what the row still contains at that point: identifiers, a reason
         * code and timestamps. `reason_note` — the only free text — is nulled
         * at finalisation, so this window governs metadata about a closure
         * rather than anything about a person.
         */
        'request_rows_days' => (int) env('CLOSURE_REQUEST_RETENTION_DAYS', 365),
    ],

    /*
    |--------------------------------------------------------------------------
    | Confirmation
    |--------------------------------------------------------------------------
    */

    'confirmation' => [

        /**
         * Whether the closure confirmation message is sent.
         *
         * On, and it should stay on. The message is the only channel left once
         * the login has stopped working, which makes it the sole tripwire for a
         * closure somebody did not ask for — a hijacked session, or a
         * support-initiated closure aimed at the wrong account.
         *
         * The switch exists for the one legitimate case: a deployment with no
         * outbound mail at all, where queueing a message that cannot be
         * delivered only fills a failed-jobs table.
         */
        'enabled' => (bool) env('CLOSURE_CONFIRMATION_ENABLED', true),
    ],
];
