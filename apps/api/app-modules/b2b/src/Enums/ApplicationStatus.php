<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The seven states a B2B application passes through (appendix C, B.5).
 *
 * The transition table lives here rather than in the service because it is the
 * *definition* of the workflow, not a policy about it: a reviewer surface, a
 * status panel and a provisioning job all need to agree on what can follow
 * what, and three copies of that agreement would drift.
 *
 * `info_requested` is the one worth explaining. It is not a rejection and not
 * a pause — it hands editing rights back to the applicant for named sections
 * while the application keeps its place in the queue. Modelling it as a
 * separate state rather than a flag on `in_review` means the applicant's own
 * status panel can say something true and specific ("we need two things from
 * you") instead of the same "under review" it showed yesterday.
 *
 * `withdrawn` is the applicant's exit, distinct from `declined`, which is the
 * platform's. Collapsing them would make "how many did we turn down" an
 * unanswerable question.
 */
enum ApplicationStatus: string
{
    case Draft = 'draft';

    case Submitted = 'submitted';

    case InReview = 'in_review';

    case InfoRequested = 'info_requested';

    case Approved = 'approved';

    case Declined = 'declined';

    case Withdrawn = 'withdrawn';

    /**
     * The states that may follow this one.
     *
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Draft => [self::Submitted, self::Withdrawn],
            self::Submitted => [self::InReview, self::InfoRequested, self::Approved, self::Declined, self::Withdrawn],
            self::InReview => [self::InfoRequested, self::Approved, self::Declined, self::Withdrawn],
            // Back to submitted, not to in_review: the applicant's answer
            // rejoins the queue, and whether a reviewer picks it up again is
            // the reviewer's decision to make.
            self::InfoRequested => [self::Submitted, self::Withdrawn, self::Declined],
            self::Approved, self::Declined, self::Withdrawn => [],
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }

    /**
     * Whether the applicant may still change the answers they gave.
     *
     * `info_requested` is editable but only for the sections the reviewer
     * named — `ApplicationService` enforces the narrowing; this method only
     * says the door is open at all.
     */
    public function isEditableByApplicant(): bool
    {
        return $this === self::Draft || $this === self::InfoRequested;
    }

    /** Nothing follows a terminal state. */
    public function isTerminal(): bool
    {
        return $this->allowedTransitions() === [];
    }

    /**
     * Whether this application still occupies its applicant's one live slot
     * (the partial unique index on `b2b_applications`).
     */
    public function isLive(): bool
    {
        return ! $this->isTerminal();
    }

    /** Whether a platform reviewer, rather than the applicant, is holding it. */
    public function isWithReviewer(): bool
    {
        return $this === self::Submitted || $this === self::InReview;
    }
}
