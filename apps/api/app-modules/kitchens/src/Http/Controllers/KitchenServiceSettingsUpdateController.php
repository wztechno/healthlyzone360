<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Exceptions\PermissionDenied;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Http\Requests\UpdateKitchenServiceSettingsRequest;
use Healthy360\Kitchens\Presenters\KitchenServiceSettingsPresenter;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * PUT /api/v1/catalogue/kitchen-service-settings — replaces the timings and the refund limit.
 *
 * No `If-Match`, for the reason `BranchOperatingReplaceController` gives: the
 * values arrive together, the row carries no `lock_version`, and there is no half
 * of it for a validator to protect.
 *
 * **The two limits belong to whoever they limit against.** The refund limit decides
 * what reaches the owner and the price limit what reaches the approver, so a manager
 * who could raise either could approve themselves. Sending one unchanged is fine:
 * the form posts every value, so it is the change that takes the permission.
 */
final class KitchenServiceSettingsUpdateController
{
    /** @var array<string, string> a limit, and the permission that may move it */
    private const array GUARDED = [
        'refund_approval_above_minor' => 'order.approve_refund_organisation',
        'price_approval_above_percent' => 'inventory.approve_payables_organisation',
    ];

    public function __construct(
        private readonly KitchenServiceSettingsLookup $lookup,
        private readonly KitchenServiceSettingsPresenter $presenter,
        private readonly TenantContext $context,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws PermissionDenied
     */
    public function __invoke(UpdateKitchenServiceSettingsRequest $request): JsonResponse
    {
        $organisationId = (string) $this->context->organisationId();

        // Refreshed so a row created just now holds its nulls: a column missing
        // from the model reads as changed, and would ask for a permission here.
        $settings = $this->lookup->for($organisationId)->refresh();
        $settings->fill($request->validated());
        $changed = array_keys($settings->getDirty());

        foreach (self::GUARDED as $field => $permission) {
            if ($settings->isDirty($field) && Gate::denies($permission)) {
                throw new PermissionDenied(AccessDenialReason::PermissionNotGranted, $permission);
            }
        }

        $values = [];

        foreach ($changed as $field) {
            $values[$field] = ['old' => $settings->getOriginal($field), 'new' => $settings->getAttribute($field)];
        }

        $settings->save();

        $this->audit->record(
            'kitchen.service_settings_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $organisationId,
            metadata: ['changed_fields' => $changed, 'values' => $values],
        );

        return ApiResponse::data($this->presenter->settings($settings));
    }
}
