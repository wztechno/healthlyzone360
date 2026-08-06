<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\CreateQuotationRequest;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/b2b/programmes/{programme}/quotations — a buyer opens a new
 * draft (B4). Any member of the organisation may (B7: org-shared server
 * drafts) — there is no additional permission gate here, only membership in
 * the buyer organisation, which `org.context` has already proven.
 */
final class QuotationStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationService $quotations,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(CreateQuotationRequest $request, string $programme): JsonResponse
    {
        $record = $this->locator->programme($programme);
        $actor = $this->currentUser($request);

        $quotation = $this->quotations->createDraft($record, $actor, $request->payload());

        return ApiResponse::data(['quotation' => $this->presenter->quotation($quotation)], status: 201)
            ->withHeaders(['ETag' => '"'.$quotation->lock_version.'"']);
    }
}
