<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\QuoteQuotationRequest;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/b2b/kitchen/quotations/{quotation}/quote — the seller kitchen
 * sets a unit price on every line and the quotation moves
 * `submitted` → `quoted` (B4, B5). Gated by
 * `b2b_quotation.quote_organisation` (route middleware) rather than by
 * anything checked here — this controller only has to prove the quotation
 * belongs to the caller's kitchen, which `B2bLocator::kitchenQuotation()`
 * already does.
 */
final class KitchenQuotationQuoteController
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
    public function __invoke(QuoteQuotationRequest $request, string $quotation, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        $record = $this->locator->kitchenQuotation($quotation, $organisationId);
        $expected = $this->requiredLockVersion($request);
        $actor = $this->currentUser($request);

        $quoted = $this->quotations->quote($record, $actor, $request->payload(), $expected);

        return ApiResponse::data(['quotation' => $this->presenter->quotation($quoted)])
            ->withHeaders(['ETag' => '"'.$quoted->lock_version.'"']);
    }
}
