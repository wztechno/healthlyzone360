<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Kitchens\Services\KitchenSetupChecklist;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/kitchen/setup and POST /api/v1/kitchen/setup/go-live.
 *
 * Going live is the owner's call, behind `organisation.update_current`, audited,
 * and refused while a required step is unfinished. There is no way back from
 * here: a kitchen that must stop has the timed pause and its closures.
 */
final class KitchenSetupController
{
    public function __construct(
        private readonly KitchenSetupChecklist $checklist,
        private readonly KitchenServiceSettingsLookup $settings,
        private readonly TenantContext $context,
        private readonly AuditRecorder $audit,
    ) {}

    public function show(): JsonResponse
    {
        return ApiResponse::data($this->checklist->for((string) $this->context->organisationId()));
    }

    public function goLive(): JsonResponse
    {
        $organisationId = (string) $this->context->organisationId();
        $setup = $this->checklist->for($organisationId);

        $unfinished = array_filter($setup['steps'], static fn (array $step): bool => $step['required'] && ! $step['done']);

        if ($unfinished !== []) {
            throw ValidationException::withMessages([
                'steps' => array_map(static fn (array $step): string => $step['key'], array_values($unfinished)),
            ]);
        }

        if (! $setup['is_live']) {
            $settings = $this->settings->for($organisationId);
            $settings->not_open_yet = false;
            $settings->save();

            $this->audit->record(
                'kitchen.went_live',
                actorUserId: $this->context->userId(),
                subjectType: 'organisation',
                subjectId: $organisationId,
            );
        }

        return ApiResponse::data($this->checklist->for($organisationId));
    }
}
