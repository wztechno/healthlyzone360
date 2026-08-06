<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;

/**
 * The numbers and the people the console shows beside each kitchen.
 *
 * ## One query per fact, over a page — never per row
 *
 * A list of twenty kitchens needs a branch count, an owner list and a
 * published-catalogue breakdown for each. Asked row by row that is sixty
 * round trips; asked here it is three, each grouped by `organisation_id`, and
 * the presenter reads the answers out of arrays. Which is why this class takes
 * a *list* of organisations rather than one — the single-row case calls it
 * with an array of one and pays the same three queries, and there is no second
 * code path to drift.
 *
 * ## Owners are memberships holding the `organisation_owner` role
 *
 * Not a column, not a flag. Ownership on this platform has always been "a
 * membership with the owner role assigned to it" — that is what
 * `DemoTenantSeeder` writes and what the permission checker reads — so asking
 * the same question here keeps the console honest about who can actually do
 * what. Ended and suspended memberships are excluded: they are people who used
 * to be owners, and a console that counted them would report an owned kitchen
 * nobody can get into.
 *
 * Both the platform template role and an organisation's own role of that code
 * count, because `MembershipGranter` will grant either.
 *
 * ## `withoutTenancy()` throughout
 *
 * The reader is the platform operator, sitting in the platform-operator
 * organisation's context. Every row wanted here belongs to somebody else, so
 * the tenant scope would fail closed on all of it. This is the one console on
 * the platform for which that is correct, and `platform.context` in front of
 * the routes is what makes it safe.
 */
final class KitchenOverviewQuery
{
    public const string OWNER_ROLE = 'organisation_owner';

    /**
     * @param  list<Organisation>  $organisations
     * @return array<string, array{
     *     branches: int,
     *     active_branches: int,
     *     owners: list<array{membership_id: string, user_id: string, name: string|null, email: string, status: string}>,
     *     catalogue: array{meals: int, products: int, plans: int, published: int, draft: int}
     * }>
     */
    public function forAll(array $organisations): array
    {
        $ids = array_map(static fn (Organisation $o): string => (string) $o->getKey(), $organisations);

        if ($ids === []) {
            return [];
        }

        $branches = $this->branchCounts($ids);
        $owners = $this->owners($ids);
        $catalogue = $this->catalogueCounts($ids);

        $overview = [];

        foreach ($ids as $id) {
            $overview[$id] = [
                'branches' => $branches[$id]['total'] ?? 0,
                'active_branches' => $branches[$id]['active'] ?? 0,
                'owners' => $owners[$id] ?? [],
                'catalogue' => $catalogue[$id] ?? [
                    'meals' => 0,
                    'products' => 0,
                    'plans' => 0,
                    'published' => 0,
                    'draft' => 0,
                ],
            ];
        }

        return $overview;
    }

    /**
     * @return array{
     *     branches: int,
     *     active_branches: int,
     *     owners: list<array{membership_id: string, user_id: string, name: string|null, email: string, status: string}>,
     *     catalogue: array{meals: int, products: int, plans: int, published: int, draft: int}
     * }
     */
    public function forOne(Organisation $organisation): array
    {
        $all = $this->forAll([$organisation]);

        return $all[(string) $organisation->getKey()];
    }

    /**
     * The active owner memberships of one kitchen, in the shape the console
     * lists them and the revoke endpoint validates against.
     *
     * @return list<array{membership_id: string, user_id: string, name: string|null, email: string, status: string}>
     */
    public function ownersOf(Organisation $organisation): array
    {
        $id = (string) $organisation->getKey();

        return $this->owners([$id])[$id] ?? [];
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{total: int, active: int}>
     */
    private function branchCounts(array $ids): array
    {
        $rows = OrganisationBranch::withoutTenancy()
            ->whereIn('organisation_id', $ids)
            ->selectRaw('organisation_id, count(*) as total, count(*) filter (where status = ?) as active', [BranchStatus::Active->value])
            ->groupBy('organisation_id')
            ->get();

        $counts = [];

        foreach ($rows as $row) {
            $counts[(string) $row->getAttribute('organisation_id')] = [
                'total' => (int) $row->getAttribute('total'),
                'active' => (int) $row->getAttribute('active'),
            ];
        }

        return $counts;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, list<array{membership_id: string, user_id: string, name: string|null, email: string, status: string}>>
     */
    private function owners(array $ids): array
    {
        $roleIds = Role::withoutTenancy()
            ->where('code', self::OWNER_ROLE)
            ->where(function ($query) use ($ids): void {
                $query->whereNull('organisation_id')->orWhereIn('organisation_id', $ids);
            })
            ->pluck('id')
            ->all();

        if ($roleIds === []) {
            return [];
        }

        $membershipIds = MembershipRole::withoutTenancy()
            ->whereIn('role_id', $roleIds)
            ->whereIn('organisation_id', $ids)
            ->pluck('membership_id')
            ->all();

        if ($membershipIds === []) {
            return [];
        }

        $memberships = OrganisationMembership::withoutTenancy()
            ->whereIn('id', $membershipIds)
            ->where('status', MembershipStatus::Active->value)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        $userIds = $memberships->pluck('user_id')->filter()->map(static fn ($id): string => (string) $id)->all();

        $emails = User::query()->whereIn('id', $userIds)->pluck('email', 'id')->all();
        $profiles = UserProfile::query()->whereIn('user_id', $userIds)->get()->keyBy('user_id');

        $owners = [];

        foreach ($memberships as $membership) {
            $userId = (string) $membership->user_id;
            $profile = $profiles->get($userId);

            $name = $profile instanceof UserProfile
                ? trim($profile->given_name.' '.$profile->family_name)
                : null;

            $owners[(string) $membership->organisation_id][] = [
                'membership_id' => (string) $membership->getKey(),
                'user_id' => $userId,
                'name' => $name === '' ? null : $name,
                'email' => (string) ($emails[$userId] ?? ''),
                'status' => $membership->status->value,
            ];
        }

        return $owners;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{meals: int, products: int, plans: int, published: int, draft: int}>
     */
    private function catalogueCounts(array $ids): array
    {
        $rows = CatalogueItem::withoutTenancy()
            ->whereIn('organisation_id', $ids)
            ->selectRaw('organisation_id, item_type, status, count(*) as total')
            ->groupBy('organisation_id', 'item_type', 'status')
            ->get();

        $counts = [];

        foreach ($rows as $row) {
            $id = (string) $row->getAttribute('organisation_id');
            $type = (string) $row->getAttribute('item_type');
            $status = (string) $row->getAttribute('status');
            $total = (int) $row->getAttribute('total');

            $counts[$id] ??= ['meals' => 0, 'products' => 0, 'plans' => 0, 'published' => 0, 'draft' => 0];

            // The type breakdown counts *published* rows only: "what is this
            // kitchen selling" is the question the console asks, and a
            // half-written draft is not an answer to it. The published/draft
            // pair beside it is the progress bar, and counts everything.
            if ($status === CatalogueItemStatus::Published->value) {
                $counts[$id]['published'] += $total;

                match ($type) {
                    'meal' => $counts[$id]['meals'] += $total,
                    'product' => $counts[$id]['products'] += $total,
                    'subscription_plan' => $counts[$id]['plans'] += $total,
                    default => null,
                };
            }

            if ($status === CatalogueItemStatus::Draft->value || $status === CatalogueItemStatus::ReviewRequired->value) {
                $counts[$id]['draft'] += $total;
            }
        }

        return $counts;
    }
}
