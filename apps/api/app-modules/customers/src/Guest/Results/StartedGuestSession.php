<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Results;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * What `GuestSessionService::start()` hands back.
 *
 * `$token` is the plaintext, and this object is the only place it will ever
 * exist after the call returns — the row stores a digest. The property is named
 * for what it is rather than hidden behind a `credential`-ish euphemism, so a
 * reader grepping for "who sees a plaintext guest token" finds one answer, and
 * it is deliberately not on the model, so serialising a `GuestSession` cannot
 * leak it by accident.
 */
final readonly class StartedGuestSession
{
    public function __construct(
        public CustomerAccount $account,
        public GuestSession $session,
        public string $token,
        public GuestSessionGrade $grade,
        public CarbonImmutable $expiresAt,
        public CarbonImmutable $accountExpiresAt,
    ) {}
}
