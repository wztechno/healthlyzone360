<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Windows
    |--------------------------------------------------------------------------
    |
    | Every number in this file is PROVISIONAL and blocked on OQ-030 (guest
    | data retention). They are configuration rather than constants for the
    | usual operational reason — an operator must be able to tighten a window
    | without a deploy — and they are named as placeholders here so nothing
    | downstream can present them as a settled legal period.
    |
    | Two windows, because they answer different questions. The *session*
    | window is how long one opaque token stays usable: it is a credential in
    | somebody's browser, so it is short. The *account* window is how long the
    | guest identity itself remains a live thing that can be resumed, upgraded
    | and ordered against. A session that outlived its account would be a token
    | that resolves to a dead party; an account that expired with its session
    | would break "finish the checkout you started this morning".
    |
    */

    'windows' => [

        /**
         * How long a freshly minted guest session token is accepted.
         *
         * 72 hours: long enough that a person who opened a basket on Friday
         * can pay for it on Sunday, short enough that a token copied out of a
         * shared browser is worthless by the time anybody finds it.
         */
        'session_hours' => 72,

        /**
         * How long the guest account itself stays live — `guest_expires_at`.
         *
         * 14 days is the plan's provisional figure (OQ-030). Stamped on the
         * row at creation and never recomputed, exactly like
         * `provisional_expires_at` on a self-service account: an account
         * opened under a 14-day window must not silently acquire a shorter one
         * because somebody edited this file.
         */
        'account_days' => 14,
    ],

    /*
    |--------------------------------------------------------------------------
    | Retention
    |--------------------------------------------------------------------------
    */

    'retention' => [

        /**
         * How long an expired guest account's personal data is kept before
         * `ExpireGuestData` purges it.
         *
         * 90 days from expiry, PROVISIONAL pending OQ-030. The window is not
         * zero because a guest order is a commercial and tax record: the
         * dispute arrives after the delivery, the refund after the dispute,
         * and the tax authority after both. What survives the purge is decided
         * by the purge itself (order rows are not touched here) — this number
         * only says when the identifying data stops being kept "just in case".
         */
        'purge_after_days' => 90,

        /**
         * How long a revoked or expired session row survives before
         * `PurgeExpiredGuestSessions` deletes it.
         *
         * The token stopped working the moment it expired, so this is not
         * caution about the credential — it is so "was this session revoked or
         * did it lapse" stays answerable for a day while an abuse report is
         * being read.
         */
        'session_rows_hours' => 24,
    ],

    /*
    |--------------------------------------------------------------------------
    | Token
    |--------------------------------------------------------------------------
    |
    | Guest tokens are opaque and are NOT Sanctum tokens (D-039). Sanctum's
    | model is a personal access token belonging to an authenticated user, and
    | a guest has no user by definition — issuing one would mean creating the
    | very `users` row the guest shape exists to avoid. What is wanted here is
    | a bearer secret with a capability grade attached and a lifetime measured
    | in hours, which is a smaller thing than Sanctum and is honest about being
    | smaller.
    |
    */

    'token' => [

        /**
         * Bytes of entropy per token, before base64url encoding.
         *
         * 48 bytes is 384 bits. That is far beyond the point where the stored
         * digest needs a pepper: `contact_points.value_hash` is peppered
         * because email addresses are a guessable space and a dump would
         * otherwise be a membership oracle, whereas nobody is dictionary
         * -attacking a 384-bit random string. So the digest here is a plain
         * SHA-256, and the difference is a deliberate one rather than an
         * inconsistency.
         */
        'entropy_bytes' => 48,
    ],

    /*
    |--------------------------------------------------------------------------
    | Deletion
    |--------------------------------------------------------------------------
    */

    'deletion' => [

        /**
         * Whether a deletion request must be proven with a passcode before
         * anything is erased.
         *
         * True, and there is no code path that skips it. "Delete everything
         * you hold about this address" is an unauthenticated request by
         * construction — the whole point is that the requester has no account —
         * so without a proof step it is a denial-of-service primitive aimed at
         * anybody whose email address you can guess.
         */
        'require_verification' => true,
    ],
];
