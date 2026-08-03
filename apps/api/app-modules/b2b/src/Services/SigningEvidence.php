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
 * **`$otpVerified` is not something a caller may assert.** It is `false` on
 * every instance a caller constructs, and becomes true only through `proved()`,
 * which `AgreementService::sign()` calls after it has found a consumed
 * `b2b_signatory` challenge belonging to the person signing. A flag the caller
 * could set would record its own claim rather than an observation, which is
 * the opposite of what this type is for.
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

    /**
     * The same evidence, with the passcode proof the service has just
     * confirmed. Only `AgreementService::sign()` calls this.
     */
    public function proved(string $otpChallengeId): self
    {
        return new self(
            documentSha256: $this->documentSha256,
            signatoryName: $this->signatoryName,
            signatoryTitle: $this->signatoryTitle,
            consentStatement: $this->consentStatement,
            ipHash: $this->ipHash,
            userAgentHash: $this->userAgentHash,
            otpChallengeId: $otpChallengeId,
            otpVerified: true,
        );
    }
}
