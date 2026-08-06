<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Services;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * "May this organisation trade right now?", answered once (PA1).
 *
 * Suspension is a single fact with many consequences, and the failure mode
 * this class exists to prevent is each consequence deciding for itself what
 * suspension means. Before PA1 the answer was written out in
 * `MarketplaceKitchens::visible()` as `where('status', 'active')` and nowhere
 * else, which made the anonymous marketplace fail closed and left every
 * signed-in surface — quoting, checkout, the kitchen's own catalogue writes —
 * fail *open*. A suspended kitchen vanished from the shop window and carried
 * on taking orders.
 *
 * So the question is asked through `OrganisationStatus::isTrading()` and
 * nothing else. Widening the vocabulary later — a `probation` status, say —
 * is then one edit to the enum rather than a search for string literals.
 *
 * ## Why `pending` and `closed` refuse too
 *
 * The method is not `isNotSuspended()`. A pending organisation has never been
 * admitted and a closed one has been offboarded with its memberships ended and
 * its personal data purged; neither may trade, and both would sail through a
 * check written against `suspended` alone. The error code says `suspended`
 * because that is the only one of the three a real caller will ever meet — the
 * marketplace never lists the other two — but the guard's actual question is
 * the broader one.
 *
 * ## Memoised, deliberately
 *
 * `LineProbe` runs this once per basket line and `OrderPlacementService` runs
 * it again over the same seller at commit. The status of an organisation
 * cannot change inside one request, so the lookup is cached for the life of
 * the instance and the service is bound as a singleton.
 */
final class OrganisationTradingGuard
{
    /** @var array<string, bool> */
    private array $memo = [];

    /**
     * Refuses unless the organisation exists and is trading.
     *
     * A null identifier passes. Callers reach this guard from seams that also
     * serve organisation-less traffic — a guest basket that has not resolved a
     * seller yet — and inventing a refusal there would turn "not applicable"
     * into "forbidden".
     *
     * @throws ApiException
     */
    public function assertTrading(?string $organisationId): void
    {
        if ($this->isTrading($organisationId)) {
            return;
        }

        throw new ApiException(
            ErrorCode::OrganisationSuspended,
            details: ['organisation_id' => $organisationId],
        );
    }

    /**
     * The same question without the exception, for accumulating refusal lists.
     *
     * An organisation identifier that resolves to nothing answers `true`. This
     * guard's job is suspension, not existence: a missing row is somebody
     * else's 404, and answering `false` here would dress it up as a suspension
     * the operator would then go looking for.
     */
    public function isTrading(?string $organisationId): bool
    {
        if ($organisationId === null || trim($organisationId) === '') {
            return true;
        }

        $key = trim($organisationId);

        return $this->memo[$key] ??= $this->resolve($key);
    }

    private function resolve(string $organisationId): bool
    {
        $organisation = Organisation::query()->find($organisationId);

        return ! $organisation instanceof Organisation || $organisation->status->isTrading();
    }
}
