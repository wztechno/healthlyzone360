<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The four people an applicant company names, one per slot.
 *
 * `signatory` overlaps the `signatory_*` columns on the application itself and
 * that is not a duplication to remove: the columns are the *declaration* the
 * applicant makes about who can bind the company, which submission validates
 * and a reviewer checks against the identity document. The contact row is
 * where to reach that person about the paperwork. A company whose CEO signs
 * and whose office manager chases the emails has one of each.
 */
enum ApplicationContactRole: string
{
    case Primary = 'primary';

    case Billing = 'billing';

    case Operations = 'operations';

    case Signatory = 'signatory';
}
