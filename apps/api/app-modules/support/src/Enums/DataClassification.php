<?php

declare(strict_types=1);

namespace Healthy360\Support\Enums;

/**
 * The single data-classification vocabulary (plan §12,
 * 06-security-privacy-and-audit.md §1). Redaction, encryption and
 * purpose-of-use rules key off this one concept instead of ad-hoc lists.
 *
 * Levels are ordered least to most restricted; `special_category` is the
 * health-data tier that will carry the strictest handling once clinical
 * modules exist.
 *
 * Phase 6 delivers the vocabulary and its application to the obviously
 * sensitive attributes. Automated enforcement — deriving redaction rules and
 * field encryption from the declarations — is deliberately deferred; see
 * docs/architecture/notes/rls-implementation.md.
 */
enum DataClassification: string
{
    /** Reference data and published catalogue content. No restriction. */
    case Public = 'public';

    /** Organisation configuration. Tenant-scoped access only. */
    case Internal = 'internal';

    /** Personal data: name, email, phone, device metadata. Redacted in logs. */
    case Confidential = 'confidential';

    /** Credentials and keys. Never logged, never audited as content, never returned by an API. */
    case Restricted = 'restricted';

    /** Health, clinical and consent data. Purpose-of-use required on access. */
    case SpecialCategory = 'special_category';

    /**
     * Whether an access to data at this level must record a purpose of use on
     * its audit event (06-security-privacy-and-audit.md §3.3).
     */
    public function requiresPurposeOfUse(): bool
    {
        return $this === self::SpecialCategory;
    }
}
