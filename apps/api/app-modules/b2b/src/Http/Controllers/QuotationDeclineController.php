<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\DeclineQuotationRequest;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/b2b/quotations/{quotation}/decline — quoted → declined (B5).
 */
final class QuotationDeclineController
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
    public function __invoke(DeclineQuotationRequest $request, string $quotation): JsonResponse
    {
        $record = $this->locator->quotation($quotation);
        $expected = $this->requiredLockVersion($request);
        $actor = $this->currentUser($request);

        $declined = $this->quotations->decline($record, $actor, $request->reason(), $expected);

        return ApiResponse::data(['quotation' => $this->presenter->quotation($declined)])
            ->withHeaders(['ETag' => '"'.$declined->lock_version.'"']);
    }
}
