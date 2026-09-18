<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * POST /api/v1/catalogue/production/orders — open a draft batch (PROD1).
 *
 * ## The draft claims nothing, and that is the whole point of the state
 *
 * A kitchen writing next week's runs on a Friday afternoon must not be quietly
 * reserving Monday's flour while it decides. Confirm is where the commitment
 * happens; this is where the intention is written down.
 *
 * ## How much to make, said either way round
 *
 * `planned_yield` is what a cook thinks in — forty litres of dressing — and
 * `batch_factor` is what the explosion thinks in — two and a half times over.
 * One or the other is required and the server derives the missing one, because
 * the conversion needs the version's own yield and a client doing it would be a
 * second place the arithmetic lives.
 *
 * ## The version must be this organisation's
 *
 * Checked explicitly rather than trusted, and answered as a 404: a recipe version
 * id that belongs to another kitchen is not a permission problem to explain, it
 * is a row this caller cannot see.
 *
 * Requires `production.manage_organisation`.
 */
final class ProductionOrderStoreController
{
    use ResolvesProductionOrder;

    public function __construct(
        private readonly ProductionOrderService $orders,
        private readonly ProductionOrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'recipe_version_id' => ['required', 'uuid'],
            'planned_yield' => ['nullable', 'numeric', 'gt:0'],
            'batch_factor' => ['nullable', 'numeric', 'gt:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        /** @var RecipeVersion|null $version */
        $version = RecipeVersion::query()
            ->withoutGlobalScopes()
            ->where('organisation_id', $context->organisationId())
            ->whereKey((string) $validated['recipe_version_id'])
            ->first();

        if (! $version instanceof RecipeVersion) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $order = $this->orders->draft(
            (string) $context->organisationId(),
            (string) $validated['branch_id'],
            $version,
            isset($validated['planned_yield']) ? (string) $validated['planned_yield'] : null,
            isset($validated['batch_factor']) ? (string) $validated['batch_factor'] : null,
            $context->userId(),
            $validated['notes'] ?? null,
        );

        return ApiResponse::data(
            ['production_order' => $this->presenter->summary($order, $this->withCosts())],
            status: 201,
        );
    }
}
