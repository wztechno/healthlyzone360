<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * A human's verdict on a document.
 *
 * `superseded` is not a verdict a reviewer gives — it is what happens to an
 * accepted document when a newer one of the same kind replaces it. Keeping the
 * old row rather than deleting it means the reviewer's decision trail survives
 * the applicant re-uploading, and the retention job removes both on the same
 * schedule.
 */
enum DocumentReviewStatus: string
{
    case Pending = 'pending';

    case Accepted = 'accepted';

    case Rejected = 'rejected';

    case Superseded = 'superseded';

    /**
     * Whether the document still counts towards the required-documents rule.
     *
     * `pending` counts. At submission nothing has been reviewed yet — review
     * is what happens *after* — so a rule that only accepted documents satisfy
     * would make submission unreachable. What the rule actually asks is
     * whether the applicant has supplied something of that kind that has not
     * been turned down.
     */
    public function satisfiesRequirement(): bool
    {
        return $this === self::Pending || $this === self::Accepted;
    }

    public function isDecided(): bool
    {
        return $this === self::Accepted || $this === self::Rejected;
    }
}
