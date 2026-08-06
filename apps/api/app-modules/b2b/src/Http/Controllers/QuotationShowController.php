<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/b2b/quotations/{quotation} — one quotation and its lines.
 */
final class QuotationShowController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $quotation): JsonResponse
    {
        $record = $this->locator->quotation($quotation);

        return ApiResponse::data(['quotation' => $this->presenter->quotation($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
