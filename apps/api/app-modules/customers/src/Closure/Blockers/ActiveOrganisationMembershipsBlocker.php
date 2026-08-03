<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Database\Eloquent\Builder;

/**
 * The person still works somewhere.
 *
 * A membership is somebody else's business relationship. A chef closing their
 * personal account should not silently remove themselves from the kitchen's
 * roster on a Sunday night, and the organisation's owner is entitled to know
 * their staff list changed. So an active membership blocks: the person leaves
 * the organisation first, through the organisation's own surface, and closes
 * afterwards.
 *
 * **`invited` counts and `suspended` does not.** An outstanding invitation is a
 * live offer against this identity that would become an orphan the moment the
 * identity is anonymised. A suspended membership is already inert — somebody
 * has already decided this person is not currently working there — so holding a
 * closure for it would be refusing an erasure on the strength of a relationship
 * that has already been suspended.
 *
 * **The tenancy scope must be dropped and this is the one place it is
 * dangerous not to.** `OrganisationMembership` is `OrganisationScoped`, and a
 * closure runs with no ambient organisation — a consumer has none, and a
 * queue worker never does. Left scoped, the query would fail closed to zero
 * rows and this blocker would report `clear` for somebody with memberships in
 * four kitchens, which is a false negative on a safety check: precisely the
 * dishonesty the registry exists to prevent, arriving through the back door of
 * a correct-looking query.
 *
 * Real today. No port and no seam — organisations is a foundation module that
 * has always been in the tree.
 */
final class ActiveOrganisationMembershipsBlocker implements ClosureBlocker
{
    public function code(): string
    {
        return 'organisation_memberships';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        $count = $this->liveMembershipQuery((string) $user->getKey())->count();

        if ($count === 0) {
            return BlockerVerdict::clear($this->code());
        }

        return BlockerVerdict::blocking($this->code(), $count, 'memberships_live');
    }

    /**
     * Memberships this identity still holds anywhere on the platform.
     *
     * Exposed as a shared builder so the finalisation job ends exactly the rows
     * this blocker refused on. Two definitions of "live membership" would be two
     * answers, and the one that mattered would be whichever ran second.
     *
     * @return Builder<OrganisationMembership>
     */
    public function liveMembershipQuery(string $userId): Builder
    {
        return OrganisationMembership::withoutTenancy()
            ->where('user_id', $userId)
            ->whereIn('status', [MembershipStatus::Invited->value, MembershipStatus::Active->value]);
    }
}
