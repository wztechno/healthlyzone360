<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/applications/{application}/agreements — every version, newest
 * first.
 *
 * **All of them, including superseded ones**, and that is the point of
 * versioning rather than editing. An active agreement is immutable; the way to
 * change what is in force is a new version that supersedes the old, and a list
 * that showed only the current terms would hide the history a company needs in
 * order to answer "what were we on before". `supersedes_agreement_id` chains
 * them.
 *
 * Not cursor-paginated. Versions are counted on one hand — a renegotiation is
 * a conversation, not an event stream — and a cursor over four rows would be
 * ceremony.
 *
 * The applicant reads their own terms here. There is no separate consumer
 * shape: an agreement is a document *between* two parties, so there is nothing
 * on it the company may not see. The one field that is genuinely internal —
 * the passcode challenge behind the signature — is reduced to a boolean by the
 * presenter for everyone.
 */
final class B2bAgreementIndexController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly B2bAgreementPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application): JsonResponse
    {
        $record = $this->locator->ownApplication($application, $this->currentUser($request));

        $agreements = B2bAgreement::query()
            ->where('b2b_application_id', $record->getKey())
            ->orderByDesc('version')
            ->get();

        return ApiResponse::data(
            $agreements->map(fn (B2bAgreement $agreement): array => $this->presenter->agreement($agreement))->all(),
            ['count' => $agreements->count()],
        );
    }
}
