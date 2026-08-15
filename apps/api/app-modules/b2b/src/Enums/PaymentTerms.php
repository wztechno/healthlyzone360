<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * How long a corporate buyer has to pay.
 *
 * The same four values appear on the application (what was *asked for*) and on
 * the agreement (what was *granted*). One enum for both, because the whole
 * point of the review is to compare them, and two vocabularies would make
 * "they asked for net 60 and we gave net 30" a string comparison.
 *
 * No invoicing exists yet — PAY1 is discovery-gated — so this is a term
 * recorded, not a term enforced. Nothing in the platform will chase a net-30
 * balance in B1, and the agreement surface must not imply otherwise.
 */
enum PaymentTerms: string
{
    case Prepaid = 'prepaid';

    case Net15 = 'net_15';

    case Net30 = 'net_30';

    case Net60 = 'net_60';

    /** Days of credit this term extends; zero for prepaid. */
    public function creditDays(): int
    {
        return match ($this) {
            self::Prepaid => 0,
            self::Net15 => 15,
            self::Net30 => 30,
            self::Net60 => 60,
        };
    }

    /**
     * Whether granting this term means extending credit — the thing a credit
     * limit and a KYC check exist to size.
     */
    public function extendsCredit(): bool
    {
        return $this !== self::Prepaid;
    }
}
