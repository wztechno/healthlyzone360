<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Exceptions\PermissionDenied;
use Healthy360\Kitchens\Presenters\KitchenServiceSettingsPresenter;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * GET /api/v1/catalogue/kitchen-service-settings — this kitchen's service timings,
 * created with defaults the first time they are read.
 *
 * Two audiences, so the permission is checked here rather than by the `permission`
 * middleware, which takes one code: whoever may edit the timings, and whoever
 * works the kitchen display, which reads its alarm minutes from them.
 */
final class KitchenServiceSettingsShowController
{
    private const array READERS = ['catalogue.manage_organisation', 'order.manage_organisation'];

    public function __construct(
        private readonly KitchenServiceSettingsLookup $lookup,
        private readonly KitchenServiceSettingsPresenter $presenter,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws PermissionDenied
     */
    public function __invoke(): JsonResponse
    {
        if (! Gate::any(self::READERS)) {
            throw new PermissionDenied(AccessDenialReason::PermissionNotGranted, self::READERS[0]);
        }

        return ApiResponse::data($this->presenter->settings(
            $this->lookup->for((string) $this->context->organisationId()),
        ));
    }
}
