<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/kitchen/quotations — the quotations submitted against
 * programmes the caller's active organisation is the seller kitchen for
 * (B4). Drafts are excluded: a kitchen has no business seeing a buyer's
 * unsent draft, only what was actually asked for.
 *
 * Reached from the *kitchen's* side of the relationship — see
 * `B2bLocator::kitchenQuotationsQuery()` for why that means an explicit
 * bypass of the buyer-shaped tenant scope rather than a plain query.
 */
final class KitchenQuotationIndexController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        $quotations = $this->locator->kitchenQuotationsQuery($organisationId)
            ->where('status', '!=', 'draft')
            ->orderByDesc('created_at')
            ->get();

        return ApiResponse::data(
            $quotations->map(fn (Quotation $quotation): array => $this->presenter->quotation($quotation, collect()))->all(),
            ['count' => $quotations->count()],
        );
    }
}
