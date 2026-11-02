<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Http\Requests\UpdateKitchenServiceSettingsRequest;
use Healthy360\Kitchens\Presenters\KitchenServiceSettingsPresenter;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/kitchen-service-settings — replaces all four timings.
 *
 * No `If-Match`, for the reason `BranchOperatingReplaceController` gives: the
 * values arrive together, the row carries no `lock_version`, and there is no half
 * of it for a validator to protect.
 */
final class KitchenServiceSettingsUpdateController
{
    public function __construct(
        private readonly KitchenServiceSettingsLookup $lookup,
        private readonly KitchenServiceSettingsPresenter $presenter,
        private readonly TenantContext $context,
        private readonly AuditRecorder $audit,
    ) {}

    public function __invoke(UpdateKitchenServiceSettingsRequest $request): JsonResponse
    {
        $organisationId = (string) $this->context->organisationId();

        $settings = $this->lookup->for($organisationId);
        $settings->fill($request->validated());
        $changed = array_keys($settings->getDirty());
        $settings->save();

        $this->audit->record(
            'kitchen.service_settings_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $organisationId,
            metadata: ['changed_fields' => $changed],
        );

        return ApiResponse::data($this->presenter->settings($settings));
    }
}
