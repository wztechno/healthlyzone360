<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * Why a reviewer turned a document down.
 *
 * A closed vocabulary rather than free text, because this is the half of a
 * rejection the applicant is shown, and "please re-upload, it was illegible"
 * is actionable in a way that a reviewer's internal note is not. The note
 * survives too — in `review_note`, which is internal and stays that way.
 */
enum DocumentRejectionReason: string
{
    /** The bytes could not be opened, or the image is unusable. */
    case Unreadable = 'unreadable';

    /** A real document, but not the kind it was filed under. */
    case WrongDocument = 'wrong_document';

    /** Valid once. `expires_on` says when it stopped being. */
    case Expired = 'expired';

    /** Pages missing, or a form only partly filled. */
    case Incomplete = 'incomplete';

    /** The details on it do not match what the application says. */
    case Mismatch = 'mismatch';

    case Other = 'other';
}
