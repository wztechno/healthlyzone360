<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/archive — purge the
 * people, keep the company.
 *
 * **Re-runnable on purpose**, and that is why it has no `Idempotency-Key`.
 * `archiving → archiving` is a legal transition so a partial failure is retried
 * rather than declared finished, and every write inside is idempotent — nulling
 * an already-null column and bringing forward an already-past `purge_after`
 * both do nothing the second time. A replay guard here would refuse the retry
 * this step is designed to accept.
 *
 * **What goes and what stays is the decision worth reading.** The named
 * contacts' names, emails, phones and notes go; the signatory block on the
 * application goes; identity documents are made *due* rather than deleted, so
 * `PurgeExpiredKycDocuments` removes them through the one code path that knows
 * to delete the object before the row. What survives is the legal entity —
 * legal name, registration number, tax number, incorporation date — because a
 * corporate record carries retention obligations the people named on it do not.
 *
 * `archive.summary` in the response is the count of each, and
 * `legal_entity_retained` is stated rather than left to be inferred from the
 * summary's silence: it was a decision, not an omission, and the audit row says
 * so in the same words.
 *
 * The wind-up reaches `completed` in the same call. That is the one place this
 * family does cascade, and it is not really a cascade — the purge either
 * finished or it threw, and a state between "archived everything" and "done"
 * would be a state nothing could ever leave.
 */
final class OffboardingArchiveController
{
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    public function __construct(
        private readonly OffboardingService $offboardings,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);

        $archived = $this->offboardings->archive($record, $this->currentUser($request));

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($archived)])
            ->withHeaders(['ETag' => '"'.$archived->lock_version.'"']);
    }
}
