<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * What a document is supposed to prove.
 *
 * The kind is the applicant's claim about a file, and it is what makes the
 * required-documents rule expressible at all: "we need proof you are
 * registered" is a statement about kinds, not about filenames.
 *
 * **Which kinds are required is decided by the server** (master plan v2 Phase
 * B1). `requiredForB2bSubmission()` is the definition, and
 * `ApplicationService::submit()` reads it rather than trusting a client to
 * have enforced a checklist. A UI that shows the same list is a convenience;
 * a UI that is the only thing enforcing it is a hole.
 *
 * `signed_agreement` is here rather than in a table of its own because a
 * countersigned MSA is exactly the same kind of object as a trade licence —
 * private bytes, a digest, a retention window — and `b2b_agreements` points at
 * it by `signature_document_sha256` rather than by owning a second copy.
 *
 * `other` exists because reviewers ask for things nobody anticipated, and the
 * alternative to an `other` kind is an applicant mislabelling a document as
 * something it is not.
 */
enum DocumentKind: string
{
    case CommercialRegistration = 'commercial_registration';

    case TaxCertificate = 'tax_certificate';

    case TradeLicence = 'trade_licence';

    case SignatoryIdentification = 'signatory_identification';

    case AuthorisationLetter = 'authorisation_letter';

    case ProofOfAddress = 'proof_of_address';

    case FoodSafetyCertificate = 'food_safety_certificate';

    case InsuranceCertificate = 'insurance_certificate';

    case SignedAgreement = 'signed_agreement';

    case Other = 'other';

    /**
     * The kinds a B2B application must carry before it may be submitted.
     *
     * Two, not eight. A registration document says the company exists; an
     * identity document says the signatory is a real person who can be held to
     * what they sign. Everything else — insurance, food safety, proof of
     * address — is something a reviewer asks for when the case calls for it,
     * through the information-request loop, and demanding all of it up front
     * would turn a five-minute form into a fortnight and produce worse
     * documents rather than more.
     *
     * @return list<self>
     */
    public static function requiredForB2bSubmission(): array
    {
        return [self::CommercialRegistration, self::SignatoryIdentification];
    }

    /**
     * Whether this kind may be uploaded by the applicant.
     *
     * A countersigned agreement is produced by the signing flow, not posted to
     * the document endpoint — accepting one from a client would let an
     * applicant supply their own idea of what they signed.
     */
    public function isApplicantUploadable(): bool
    {
        return $this !== self::SignedAgreement;
    }

    /** Whether an expiry date is meaningful for this kind. */
    public function expires(): bool
    {
        return match ($this) {
            self::TradeLicence,
            self::SignatoryIdentification,
            self::FoodSafetyCertificate,
            self::InsuranceCertificate => true,
            default => false,
        };
    }
}
