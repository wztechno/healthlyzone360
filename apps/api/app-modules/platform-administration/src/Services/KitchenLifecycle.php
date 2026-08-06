<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;

/**
 * Suspending a kitchen and letting it trade again.
 *
 * ## Sub-resource actions, never `PATCH status`
 *
 * The platform convention, and here is why it earns its keep. A `PATCH` that
 * set `status` would accept `closed` from a console that has no business
 * offboarding anybody, would need a state machine in a validator to say which
 * transitions are legal, and would make "suspend" and "reactivate" — two
 * decisions with different consequences and different audit entries — the same
 * request with a different string in it. Two endpoints, two verbs, two audit
 * actions.
 *
 * ## `closed` is not reachable from here, and `pending` is not returned to
 *
 * A closed organisation has been offboarded: memberships ended, agreement
 * terminated, personal data purged. Reactivating it would be a lie, and
 * suspending it would be worse — it would suggest the state is recoverable. So
 * both methods refuse anything that is not the one status they expect, and say
 * which status they found. A `pending` kitchen — one created here but never
 * handed to an owner — reactivates to `active` the same as a suspended one,
 * because "let this trade" is the same decision either way; it is only the
 * *suspending* side that insists on `active`.
 *
 * ## Effects live at the seams, not here
 *
 * This method writes one column. Everything that follows from it — vanishing
 * from the marketplace, refusing quotes, refusing checkout, refusing catalogue
 * writes — is enforced where those things happen, through
 * `OrganisationTradingGuard` and `MarketplaceKitchens::visible()`. A lifecycle
 * service that also tried to go and switch things off would be a second
 * enforcement that could disagree with the first, and the disagreement would
 * always be discovered by a customer.
 */
final readonly class KitchenLifecycle
{
    public function __construct(private AuditRecorder $audit) {}

    /**
     * @throws ApiException
     */
    public function suspend(Organisation $kitchen, User $actor, ?string $reason, int $expectedLockVersion): Organisation
    {
        if ($kitchen->status !== OrganisationStatus::Active) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'Only an active kitchen can be suspended.',
                ['status' => $kitchen->status->value],
            );
        }

        $note = $reason === null || trim($reason) === '' ? null : trim($reason);
        $now = CarbonImmutable::now();

        $this->compareAndSwap($kitchen, [
            'status' => OrganisationStatus::Suspended->value,
            'suspended_at' => $now,
            'suspension_reason' => $note,
            'suspended_by' => (string) $actor->getKey(),
        ], $expectedLockVersion);

        $this->audit->record(
            'platform.kitchen_suspended',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation',
            subjectId: (string) $kitchen->getKey(),
            metadata: [
                'slug' => $kitchen->slug,
                'from_status' => OrganisationStatus::Active->value,
                'to_status' => OrganisationStatus::Suspended->value,
                'reason' => $note,
            ],
        );

        return $kitchen;
    }

    /**
     * @throws ApiException
     */
    public function reactivate(Organisation $kitchen, User $actor, int $expectedLockVersion): Organisation
    {
        if ($kitchen->status === OrganisationStatus::Active) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This kitchen is already trading.',
                ['status' => $kitchen->status->value],
            );
        }

        if ($kitchen->status === OrganisationStatus::Closed) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'A closed organisation cannot be reactivated. Its memberships were ended and its personal data purged.',
                ['status' => $kitchen->status->value],
            );
        }

        $from = $kitchen->status->value;

        $this->compareAndSwap($kitchen, [
            'status' => OrganisationStatus::Active->value,
            'suspended_at' => null,
            'suspension_reason' => null,
            'suspended_by' => null,
        ], $expectedLockVersion);

        $this->audit->record(
            'platform.kitchen_reactivated',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation',
            subjectId: (string) $kitchen->getKey(),
            metadata: [
                'slug' => $kitchen->slug,
                'from_status' => $from,
                'to_status' => OrganisationStatus::Active->value,
            ],
        );

        return $kitchen;
    }

    /**
     * A single conditional `UPDATE`, never a read followed by a write — the
     * same shape every lock-versioned write on this platform uses.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function compareAndSwap(Organisation $kitchen, array $changes, int $expectedLockVersion): void
    {
        $affected = Organisation::query()
            ->whereKey($kitchen->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = Organisation::query()->whereKey($kitchen->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $kitchen->refresh();
    }
}
