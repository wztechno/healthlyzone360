<?php

declare(strict_types=1);

namespace Healthy360\Features\Services;

use Healthy360\Features\Enums\EntitlementDenialReason;
use Healthy360\Features\Enums\EntitlementStatus;
use Healthy360\Features\Models\FeatureDefinition;
use Healthy360\Features\Models\FeatureEntitlement;
use Illuminate\Contracts\Database\Eloquent\Builder;

/**
 * Standalone entitlement check, evaluated separately from the six-step RBAC
 * decision with its own distinct denial reason (plan §10 separated concerns).
 * It must never be folded into the PermissionChecker.
 */
final class FeatureEntitlementChecker
{
    public function check(string $organisationId, string $featureCode): EntitlementDecision
    {
        $definition = FeatureDefinition::query()
            ->where('code', $featureCode)
            ->where('is_active', true)
            ->first();

        if ($definition === null) {
            return EntitlementDecision::deny(EntitlementDenialReason::EntitlementMissing);
        }

        $now = now();

        $entitled = FeatureEntitlement::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('feature_definition_id', $definition->getKey())
            ->whereIn('status', [EntitlementStatus::Enabled, EntitlementStatus::Trial])
            ->where(function (Builder $query) use ($now): void {
                $query->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
            })
            ->where(function (Builder $query) use ($now): void {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', $now);
            })
            ->exists();

        return $entitled
            ? EntitlementDecision::allow()
            : EntitlementDecision::deny(EntitlementDenialReason::EntitlementMissing);
    }

    /**
     * Every feature code the organisation is currently entitled to, for
     * hydration into /api/v1/me. Same time and status rules as check().
     *
     * @return list<string>
     */
    public function entitledCodes(string $organisationId): array
    {
        $now = now();

        /** @var list<string> */
        return FeatureDefinition::query()
            ->where('is_active', true)
            ->whereIn('id', FeatureEntitlement::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereIn('status', [EntitlementStatus::Enabled, EntitlementStatus::Trial])
                ->where(function (Builder $query) use ($now): void {
                    $query->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
                })
                ->where(function (Builder $query) use ($now): void {
                    $query->whereNull('expires_at')->orWhere('expires_at', '>', $now);
                })
                ->select('feature_definition_id'))
            ->orderBy('code')
            ->pluck('code')
            ->all();
    }
}
