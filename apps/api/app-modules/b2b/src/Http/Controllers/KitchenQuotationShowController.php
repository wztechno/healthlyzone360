<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Enums\QuotationStatus;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/b2b/kitchen/quotations/{quotation} — one submitted quotation,
 * from the seller kitchen's side.
 */
final class KitchenQuotationShowController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $quotation, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        $record = $this->locator->kitchenQuotation($quotation, $organisationId);

        if ($record->status === QuotationStatus::Draft) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return ApiResponse::data(['quotation' => $this->presenter->quotation($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
