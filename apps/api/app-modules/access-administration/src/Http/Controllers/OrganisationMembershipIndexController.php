<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use App\Models\User;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/organisations/{organisation}/memberships — who works here.
 *
 * ## Ended memberships are listed, and only a filter hides them
 *
 * The default `status` filter is absent, which means every row: active,
 * invited, suspended and ended. That is the same call
 * `OrganisationInvitationIndexController` makes about revoked invitations, for
 * its reason — who *used* to have access is exactly what an access review reads,
 * and a screen that could not answer "did she ever work here" would send
 * somebody to the database. The console defaults its own filter to the active
 * ones because that is the common question; the endpoint does not, because the
 * uncommon one has nowhere else to go.
 *
 * ## Numbered pages, not a cursor
 *
 * A staff list is read by a person scrolling a table with a page control under
 * it, and `OffsetPage` is what the other kitchen list screens use. A kitchen
 * with four hundred staff is a large kitchen, not a feed.
 *
 * ## The three lookups are batched, and that is not premature
 *
 * Users, branches and roles are each fetched once for the page rather than once
 * per row. A twenty-five-row page would otherwise be seventy-six queries, and
 * the roles lookup in particular is the kind that looks free until a kitchen
 * defines its fourth role.
 */
final class OrganisationMembershipIndexController
{
    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly TeamMemberPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation): JsonResponse
    {
        $this->locator->contextOrganisation($organisation);

        $memberships = OrganisationMembership::query();
        $this->applyStatus($request, $memberships);

        $perPage = OffsetPage::perPage($request);
        $page = OffsetPage::page($request) ?? 1;
        $total = $memberships->clone()->count();

        OffsetPage::assertWithinRange($page, $perPage, $total);
        OffsetPage::constrain($memberships, $page, $perPage);

        $rows = $memberships->with('branch')->get();

        $users = User::query()
            ->with('profile')
            ->whereIn('id', $rows->pluck('user_id')->unique()->all())
            ->get()
            ->keyBy(static fn (User $user): string => (string) $user->getKey());

        $rolesByMembership = $this->rolesByMembership(
            $rows->map(static fn (OrganisationMembership $row): string => (string) $row->getKey())->all(),
        );

        return ApiResponse::data(
            $rows->map(fn (OrganisationMembership $membership): array => $this->presenter->summary(
                $membership,
                $users->get((string) $membership->user_id),
                $rolesByMembership[(string) $membership->getKey()] ?? [],
                $membership->branch,
            ))->all(),
            OffsetPage::meta($rows, $page, $perPage, $total),
        );
    }

    /**
     * @param  list<string>  $membershipIds
     * @return array<string, list<Role>>
     */
    private function rolesByMembership(array $membershipIds): array
    {
        if ($membershipIds === []) {
            return [];
        }

        $assignments = [];

        foreach ($membershipIds as $membershipId) {
            $assignments[$membershipId] = array_column($this->query->assignmentsFor($membershipId), 'role_id');
        }

        $roles = Role::query()
            ->whereIn('id', array_values(array_unique(array_merge(...array_values($assignments)))))
            ->get()
            ->keyBy(static fn (Role $role): string => (string) $role->getKey());

        $byMembership = [];

        foreach ($assignments as $membershipId => $roleIds) {
            $byMembership[$membershipId] = array_values(array_filter(
                array_map(static fn (string $roleId): ?Role => $roles->get($roleId), $roleIds),
            ));
        }

        return $byMembership;
    }

    /**
     * @param  Builder<OrganisationMembership>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            return;
        }

        $parsed = is_string($status) ? MembershipStatus::tryFrom($status) : null;

        if ($parsed === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: '.implode(', ', array_column(MembershipStatus::cases(), 'value')).'.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $parsed);
    }
}
