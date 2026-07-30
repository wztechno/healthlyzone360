<?php

declare(strict_types=1);

namespace Healthy360\Audit\Enums;

/**
 * Why a sensitive record was accessed (plan §12,
 * 06-security-privacy-and-audit.md §3.3).
 *
 * The vocabulary is deliberately short and covers only the pathways the
 * foundation actually has. Clinical purposes (treatment, care coordination,
 * research) are added by the modules that introduce them, together with the
 * regulatory review that makes them meaningful; inventing them now would put
 * unused values in an audit trail people are expected to trust.
 *
 * This is a foundation for later clinical and regulatory work, not a legal
 * control by itself.
 */
enum PurposeOfUse: string
{
    /** Operating one's own organisation: workspace, branches, membership administration. */
    case OrganisationAdministration = 'organisation_administration';

    /** Acting on a user's own record — profile, devices, consents. */
    case SelfService = 'self_service';

    /** Responding to a support request raised by the data subject. */
    case Support = 'support';

    /** Investigating a security or abuse incident. */
    case SecurityInvestigation = 'security_investigation';
}
