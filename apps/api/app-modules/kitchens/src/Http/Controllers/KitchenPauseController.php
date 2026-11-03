<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Presenters\KitchenServiceSettingsPresenter;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST and DELETE /api/v1/catalogue/kitchen-pause — stop taking new customer
 * orders for a while, or start again early.
 *
 * Twelve hours is the ceiling: a pause is for a rush or a broken oven, and a
 * kitchen closing for days sets its opening hours. Behind
 * `order.supervise_organisation`, the code the other service decisions carry.
 * Audited, because a kitchen that stopped trading should be able to say who
 * stopped it.
 */
final class KitchenPauseController
{
    private const int MAX_MINUTES = 720;

    public function __construct(
        private readonly KitchenServiceSettingsLookup $lookup,
        private readonly KitchenServiceSettingsPresenter $presenter,
        private readonly TenantContext $context,
        private readonly AuditRecorder $audit,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'minutes' => ['required', 'integer', 'min:1', 'max:'.self::MAX_MINUTES],
        ]);

        return $this->pause(CarbonImmutable::now()->addMinutes((int) $validated['minutes']));
    }

    public function destroy(): JsonResponse
    {
        return $this->pause(null);
    }

    private function pause(?CarbonImmutable $until): JsonResponse
    {
        $organisationId = (string) $this->context->organisationId();

        $settings = $this->lookup->for($organisationId);
        $settings->paused_until = $until;
        $settings->paused_by = $until === null ? null : $this->context->userId();
        $settings->save();

        $this->audit->record(
            $until === null ? 'kitchen.pause_ended' : 'kitchen.paused',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $organisationId,
            metadata: ['paused_until' => $until?->toIso8601String()],
        );

        return ApiResponse::data($this->presenter->settings($settings));
    }
}
