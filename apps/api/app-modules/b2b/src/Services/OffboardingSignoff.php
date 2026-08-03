<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

/**
 * What was observed when a signatory signed an organisation out.
 *
 * The same shape as `SigningEvidence`, and the same rule: **`$otpVerified` is
 * not something a caller may assert.** It is false on every instance a caller
 * constructs and becomes true only through `proved()`, which
 * `OffboardingService::signOff()` calls after it has found a consumed
 * `b2b_signatory` challenge belonging to the person signing. A flag a caller
 * could set would record its own claim rather than an observation.
 *
 * Two types rather than one shared parent, deliberately. Signing an agreement
 * and signing an organisation out are opposite acts on opposite sides of a
 * relationship, and a common base class would mean a change made for one
 * silently applied to the other. The duplication is nine properties; the
 * coupling would be a lifecycle.
 *
 * `$ipHash` and `$userAgentHash` are hashes because their purpose is
 * corroboration — did this come from the same session as the rest of the
 * conversation — and a hash answers that without retaining the raw values.
 * The caller does the hashing, keyed under the application key, because it is
 * the layer that holds the request.
 */
final readonly class OffboardingSignoff
{
    public function __construct(
        public string $signatoryName,
        public string $signatoryTitle,
        public string $consentStatement,
        public ?string $documentSha256 = null,
        public ?string $ipHash = null,
        public ?string $userAgentHash = null,
        public ?string $otpChallengeId = null,
        public bool $otpVerified = false,
    ) {}

    /**
     * The same evidence, with the passcode proof the service has confirmed.
     * Only `OffboardingService::signOff()` calls this.
     */
    public function proved(string $otpChallengeId): self
    {
        return new self(
            signatoryName: $this->signatoryName,
            signatoryTitle: $this->signatoryTitle,
            consentStatement: $this->consentStatement,
            documentSha256: $this->documentSha256,
            ipHash: $this->ipHash,
            userAgentHash: $this->userAgentHash,
            otpChallengeId: $otpChallengeId,
            otpVerified: true,
        );
    }
}
