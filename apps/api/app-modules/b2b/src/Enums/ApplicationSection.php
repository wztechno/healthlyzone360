<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The sheet-4 field groups, as the wizard steps a client PATCHes one at a time.
 *
 * A section is the unit of writing. `ApplicationService::updateSection()` takes
 * one of these plus a payload and refuses any key the section does not own —
 * refuses rather than ignores, because a client that sent `legal_name` to the
 * logistics step believed it was writing something, and a silent drop is a
 * bug report six weeks later about data that "didn't save".
 *
 * The section also decides two other things:
 *
 *  * **What submission requires.** `requiredFields()` is the server's
 *    definition of complete, and it is deliberately not derived from
 *    `completed_sections` — that column is the applicant's claim about their
 *    own progress, and a claim is not a check.
 *  * **What a reviewer can reopen.** An information request names sections,
 *    so "we need your trade terms again" reopens exactly those fields rather
 *    than the whole form.
 *
 * Documents are not a section. They live in `kyc_documents` with their own
 * lifecycle and their own review, and folding them into a field group would
 * mean a PATCH of a text box and an upload of a passport travelling the same
 * code path.
 */
enum ApplicationSection: string
{
    case Company = 'company';

    case Signatory = 'signatory';

    case TradeTerms = 'trade_terms';

    case Logistics = 'logistics';

    /**
     * Every column this section owns. The allowlist a section PATCH is checked
     * against — nothing outside it can be written through this route.
     *
     * @return list<string>
     */
    public function fields(): array
    {
        return match ($this) {
            self::Company => [
                'legal_name',
                'legal_name_ar',
                'trading_name',
                'business_type',
                'country_code',
                'commercial_registration_number',
                'tax_registration_number',
                'incorporated_on',
                'website',
            ],
            self::Signatory => [
                'signatory_name',
                'signatory_title',
                'signatory_email',
                'signatory_phone',
            ],
            self::TradeTerms => [
                'requested_payment_terms',
                'requested_credit_limit_minor',
                'currency_code',
                'expected_volume_band',
                'expected_order_frequency',
                'product_categories',
            ],
            self::Logistics => [
                'preferred_delivery_window',
                'lead_time_days',
                'requires_invoice_per_location',
                'delivery_notes',
            ],
        };
    }

    /**
     * What must be present before the application may be submitted.
     *
     * Narrow on purpose. The platform can decline an application for being
     * thin, and a reviewer reading a half-filled form learns something a
     * validator refusing it would have hidden. What is required here is only
     * what makes the application *identifiable*: which company, which person
     * speaks for it, and where the food goes. Everything else is a
     * conversation.
     *
     * `requested_credit_limit_minor` is pointedly not required: an applicant
     * asking for nothing is asking to pay up front, which is a complete answer.
     *
     * @return list<string>
     */
    public function requiredFields(): array
    {
        return match ($this) {
            self::Company => ['legal_name', 'country_code', 'commercial_registration_number'],
            self::Signatory => ['signatory_name', 'signatory_title', 'signatory_email'],
            self::TradeTerms => ['requested_payment_terms'],
            self::Logistics => [],
        };
    }

    /**
     * The sections whose required fields must all be present at submission.
     *
     * @return list<self>
     */
    public static function requiredForSubmission(): array
    {
        return [self::Company, self::Signatory, self::TradeTerms];
    }

    /**
     * Which section owns a column, or null if nothing does — used to tell a
     * client *why* a key was refused rather than only that it was.
     */
    public static function owning(string $field): ?self
    {
        foreach (self::cases() as $section) {
            if (in_array($field, $section->fields(), true)) {
                return $section;
            }
        }

        return null;
    }
}
