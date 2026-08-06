<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\UpdateQuotationRequest;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/b2b/quotations/{quotation} — patch a draft's notes, its
 * lines, or both, in one request (B4). Refused outside `draft`
 * (`409 b2b.quotation_state_invalid`) — a submitted quotation is waiting on
 * the kitchen, not on another edit.
 */
final class QuotationUpdateController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationService $quotations,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateQuotationRequest $request, string $quotation): JsonResponse
    {
        $record = $this->locator->quotation($quotation);
        $expected = $this->requiredLockVersion($request);
        $actor = $this->currentUser($request);

        $updated = $this->quotations->updateDraft($record, $actor, $request->payload(), $expected);

        return ApiResponse::data(['quotation' => $this->presenter->quotation($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
