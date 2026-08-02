<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

/**
 * What was actually observed when somebody accepted an agreement.
 *
 * Every field here is evidence rather than assertion, and the type exists so
 * that a signature cannot be recorded by passing four loose strings in the
 * wrong order.
 *
 * `$otpVerified` is **false in B1, always**. The verification module is built
 * in parallel and this module cannot confirm a challenge was completed; the
 * flag is what lets a later reader tell a stepped-up signature from one that
 * was never stepped up, instead of inferring it from the presence of a
 * challenge identifier that nothing checked. `$otpChallengeId` is recorded if
 * the caller has one and is not validated against anything — see
 * `AgreementService::sign()`.
 *
 * `$ipHash` and `$userAgentHash` are hashes because their purpose is
 * corroboration — did the acceptance come from the same session as the rest of
 * the conversation — and a hash answers that without retaining the raw values.
 * The caller does the hashing, because it is the layer that holds the request.
 */
final readonly class SigningEvidence
{
    public function __construct(
        public string $documentSha256,
        public string $signatoryName,
        public string $signatoryTitle,
        public string $consentStatement,
        public ?string $ipHash = null,
        public ?string $userAgentHash = null,
        public ?string $otpChallengeId = null,
        public bool $otpVerified = false,
    ) {}
}
