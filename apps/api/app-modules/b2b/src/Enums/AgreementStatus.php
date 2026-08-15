<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The life of a commercial agreement.
 *
 * `draft → pending_signature → active → suspended ⇄ active → terminated`.
 *
 * The transition that is *not* here is any route back into `draft` once terms
 * have been put in front of a counterparty. Changing what somebody was asked
 * to sign, in place, is the failure this whole table is shaped against; the
 * supported move is a new version that supersedes the old one, which is why
 * `pending_signature` can go back to `terminated` but never to `draft`.
 *
 * `suspended` is reversible and `terminated` is not. A suspension is a
 * commercial lever — an unpaid invoice, a credit review — and the relationship
 * survives it; termination ends it, and the record stays only as history.
 */
enum AgreementStatus: string
{
    case Draft = 'draft';

    case PendingSignature = 'pending_signature';

    case Active = 'active';

    case Suspended = 'suspended';

    case Terminated = 'terminated';

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Draft => [self::PendingSignature, self::Terminated],
            self::PendingSignature => [self::Active, self::Terminated],
            self::Active => [self::Suspended, self::Terminated],
            self::Suspended => [self::Active, self::Terminated],
            self::Terminated => [],
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }

    /**
     * Whether the terms may still be edited in place.
     *
     * Only a draft. The moment an agreement is `pending_signature` somebody
     * may already be reading it, and the digest recorded at signature has to
     * be the digest of what they read.
     */
    public function isEditable(): bool
    {
        return $this === self::Draft;
    }

    /** Whether this version is the one currently governing the relationship. */
    public function isInForce(): bool
    {
        return $this === self::Active;
    }
}
