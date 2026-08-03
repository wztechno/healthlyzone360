<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * What one settlement check found.
 *
 * `not_applicable` exists so that a check can be honest about a module that
 * does not exist yet. The alternative — reporting `clear` because there are no
 * invoices to be outstanding — produces a settlement summary that is
 * indistinguishable from a real all-clear and that quietly stops being true
 * the day PAY1 lands. A reader of the manifest can tell the difference between
 * "we looked and found nothing owed" and "there is nothing here to look at",
 * and only the first is a statement about the company.
 *
 * Every `not_applicable` carries a reason string naming *why* — currently
 * `invoicing_module_absent` — so the gap is legible rather than implied.
 */
enum SettlementOutcome: string
{
    /** Looked, found nothing outstanding. */
    case Clear = 'clear';

    /** Looked, found something that has to be resolved or waived. */
    case Outstanding = 'outstanding';

    /** Nothing to look at: the module that would answer does not exist. */
    case NotApplicable = 'not_applicable';

    /** Whether this outcome blocks progress to sign-off. */
    public function blocks(): bool
    {
        return $this === self::Outstanding;
    }
}
