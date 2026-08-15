<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/b2b/programmes/{programme}/quotations — every quotation drafted
 * against one programme, newest first. Lines are omitted from the list
 * shape; `QuotationShowController` carries them.
 */
final class QuotationIndexController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $programme): JsonResponse
    {
        $record = $this->locator->programme($programme);

        $quotations = Quotation::query()
            ->where('corporate_programme_id', $record->getKey())
            ->orderByDesc('created_at')
            ->get();

        return ApiResponse::data(
            $quotations->map(fn (Quotation $quotation): array => $this->presenter->quotation($quotation, collect()))->all(),
            ['count' => $quotations->count()],
        );
    }
}
