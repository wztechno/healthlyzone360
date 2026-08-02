<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | One-time passcodes
    |--------------------------------------------------------------------------
    |
    | The numbers below are the source journeys' own (appendix A): six digits,
    | five minutes, three attempts, a 45-second resend cooldown and at most
    | three resends. They live here rather than as constants because an
    | operator tightening a window during an incident must not need a deploy.
    |
    */

    'otp' => [

        'length' => 6,

        /** How long a challenge stays live. 300 s is the journey's five minutes. */
        'expires_after_seconds' => 300,

        /** The wait between a send and the next resend of the same challenge. */
        'resend_cooldown_seconds' => 45,

        /** Resends per challenge, after the first send. Four messages in total. */
        'max_resends' => 3,

        /** Wrong codes before the challenge is burned. */
        'max_attempts' => 3,

        /**
         * The HMAC key the stored code_hash is derived under.
         *
         * A pepper rather than a per-row salt on purpose: the hash has to be
         * *looked up* under load and compared in constant time, and the value
         * being protected is six digits — a salt in the same table would be no
         * defence at all against somebody who has the table. The pepper lives
         * outside the database, so a dump is not enough.
         *
         * Absent in local and testing, where APP_KEY stands in (see
         * OtpCodeHasher). Absent in production is a configuration error the
         * hasher refuses to guess its way past.
         */
        'pepper' => env('OTP_PEPPER'),

        /**
         * Failed verifications, across every channel of one contact point,
         * before that contact is locked out for `lockout_minutes`.
         *
         * Cross-channel by design: an attacker who exhausts three attempts on
         * a challenge and immediately requests a new one over SMS has not
         * earned three more, and the lockout is what says so.
         */
        'lockout_threshold' => 5,

        'lockout_minutes' => 15,

        /**
         * Return the plaintext code in the challenge result.
         *
         * A development affordance for the channels that do not really send
         * anything yet, and structurally impossible outside local and testing:
         * OtpService::exposesCodes() ANDs this flag with the environment, so a
         * production .env that sets it true still exposes nothing.
         */
        'expose_codes' => env('OTP_EXPOSE_CODES', false),

        /**
         * How long a finished challenge is kept before
         * PurgeExpiredOtpChallenges removes it. Long enough to investigate an
         * abuse report, short enough that a table of verification attempts is
         * not an archive.
         */
        'retain_finished_days' => 7,

        /**
         * A stable marker the mail carries so acceptance tests can find an OTP
         * message in Mailpit without parsing prose.
         */
        'message_marker' => 'X-Healthy360-Otp',
    ],

    /*
    |--------------------------------------------------------------------------
    | Contact points
    |--------------------------------------------------------------------------
    |
    | The HMAC key `contact_points.value_hash` is derived under. It lives in
    | this file rather than in one of identity's own, because the only reason
    | the hash exists is verification: it is what lets "has anybody already
    | *proven* this address" be answered without an index over plaintext
    | personal data. Reading a configuration key is not a module dependency —
    | identity imports nothing from verification.
    |
    | A separate key from the OTP pepper on purpose. They protect different
    | things with different lifetimes: rotating the OTP pepper invalidates
    | codes in flight (seconds of inconvenience), while rotating this one
    | invalidates every duplicate-detection hash on the table and needs a
    | backfill. Sharing one key would tie the cheap rotation to the expensive
    | one.
    |
    */

    'contact_pepper' => env('CONTACT_PEPPER'),

    /*
    |--------------------------------------------------------------------------
    | Channels
    |--------------------------------------------------------------------------
    |
    | `simulated` is the honesty flag (master plan v2 §3 #16, A-011). The mail
    | channel really delivers; SMS and WhatsApp are log drivers standing in for
    | a provider that has not been selected (OQ-008, INT-005/006). A simulated
    | channel is never offered to a production client — availableChannels()
    | filters on the environment, not on hope.
    |
    */

    'channels' => [

        'email' => [
            'driver' => 'mail',
            'simulated' => false,
            'enabled' => true,
        ],

        'sms' => [
            'driver' => 'log',
            'simulated' => true,
            'enabled' => true,
        ],

        'whatsapp' => [
            'driver' => 'log',
            'simulated' => true,
            'enabled' => true,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Step-up
    |--------------------------------------------------------------------------
    |
    | A passcode-confirmed step-up expires far sooner than a password-confirmed
    | one (config/auth.php `password_timeout`, three hours). Ten minutes is the
    | window in which the person holding the phone is still the person at the
    | keyboard; the actions behind it — closure, payment details, a B2B
    | signature — are the ones where that matters.
    |
    */

    'step_up' => [
        'otp_ttl_seconds' => 600,
    ],

    /*
    |--------------------------------------------------------------------------
    | Activation
    |--------------------------------------------------------------------------
    */

    /**
     * Whether a customer account must have a verified phone before it can
     * activate.
     *
     * **False, and false is the production value** (master plan v2 §3 #16,
     * gate A-011). Demanding phone verification while the SMS driver writes to
     * a log file would lock every real customer out of their own account. The
     * flag flips the day a provider is selected and integrated, and not before.
     */
    'phone_required_for_activation' => env('VERIFICATION_PHONE_REQUIRED', false),

    /**
     * How long a provisional account with no activity survives before
     * PurgeAbandonedProvisionalAccounts removes it.
     *
     * Thirty days is a placeholder pending the retention decision (OQ-029) and
     * is presented as configuration, never as a legally settled period.
     */
    'provisional_account_ttl_days' => 30,
];
