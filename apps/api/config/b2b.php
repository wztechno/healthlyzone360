<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | KYC documents
    |--------------------------------------------------------------------------
    |
    | The disk is the `private` entry in config/filesystems.php: an
    | S3-compatible bucket with no URL configured, so the only way to hand a
    | caller a document is a temporary signed URL.
    |
    | `retention_days` is a PLACEHOLDER pending the retention decision
    | (OQ-029), not a settled legal period, and nothing in the application may
    | present it as one. It is what `purge_after` is stamped with at upload,
    | and changing it does not retroactively move existing documents — each row
    | keeps the deadline it was given, so a policy change is deliberate rather
    | than sweeping.
    |
    | `max_bytes` mirrors the database CHECK on `kyc_documents.byte_size`. Two
    | places state ten megabytes and they must agree; the schema is the one
    | that cannot be bypassed, this one is what produces a readable error.
    |
    | `accepted_mime_types` is what the SNIFFER must find, not what the upload
    | may claim. Deliberately short: a scanned document is a PDF or a
    | photograph, and every additional format is another parser a reviewer's
    | browser has to survive while malware scanning is still gated (INT-008).
    |
    */

    'kyc' => [
        'disk' => env('B2B_KYC_DISK', 'private'),
        'path_prefix' => 'kyc',
        'retention_days' => (int) env('B2B_KYC_RETENTION_DAYS', 1825),
        'max_bytes' => 10485760,
        'temporary_url_ttl_minutes' => (int) env('B2B_KYC_TEMPORARY_URL_TTL_MINUTES', 5),
        'accepted_mime_types' => [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/heic',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Organisation invitations
    |--------------------------------------------------------------------------
    |
    | Seven days by default. Long enough to survive a holiday, short enough
    | that a mailbox compromised next month is not a way into an organisation.
    |
    */

    'invitations' => [
        'ttl_days' => (int) env('B2B_INVITATION_TTL_DAYS', 7),
        'token_bytes' => 32,
    ],

    /*
    |--------------------------------------------------------------------------
    | Applications
    |--------------------------------------------------------------------------
    |
    | The reference prefix is what a support ticket quotes. Kept configurable
    | because a second brand would need its own, and kept short because people
    | read these over the phone.
    |
    */

    'applications' => [
        'reference_prefix' => env('B2B_APPLICATION_REFERENCE_PREFIX', 'B2B'),
    ],

];
