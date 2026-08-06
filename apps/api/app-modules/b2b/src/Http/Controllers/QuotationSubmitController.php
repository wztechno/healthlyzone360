<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/b2b/quotations/{quotation}/submit — draft → submitted, the
 * buyer's ask for prices (B5). `200`: nothing is created, an existing
 * quotation moves state.
 */
final class QuotationSubmitController
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
    public function __invoke(Request $request, string $quotation): JsonResponse
    {
        $record = $this->locator->quotation($quotation);
        $expected = $this->requiredLockVersion($request);
        $actor = $this->currentUser($request);

        $submitted = $this->quotations->submit($record, $actor, $expected);

        return ApiResponse::data(['quotation' => $this->presenter->quotation($submitted)])
            ->withHeaders(['ETag' => '"'.$submitted->lock_version.'"']);
    }
}
