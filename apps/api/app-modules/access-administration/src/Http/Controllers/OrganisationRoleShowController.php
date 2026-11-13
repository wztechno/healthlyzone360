<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use App\Models\User;
use Healthy360\AccessAdministration\Presenters\OrganisationRolePresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/organisations/{organisation}/roles/{role} — one role and
 * everything it grants.
 *
 * Resolved through {@see AccessAdministrationLocator::ownRole()}: every
 * organisation owns a copy of each platform template, so the blueprints
 * themselves are never served to a tenant.
 *
 * The `ETag` is the role's `lock_version`, and it is what a subsequent `PATCH`
 * must echo in `If-Match`.
 */
final class OrganisationRoleShowController
{
    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly OrganisationRolePresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $organisation, string $role): JsonResponse
    {
        $this->locator->contextOrganisation($organisation);
        $record = $this->locator->ownRole($role);

        $detail = $this->presenter->detail(
            $record,
            $this->query->holderCountFor((string) $record->getKey()),
            $this->query->codesForRole((string) $record->getKey()),
            $this->editorName($record),
        );

        return ApiResponse::data(['role' => $detail])
            ->header('ETag', '"'.(int) ($record->lock_version ?? 0).'"');
    }

    /**
     * Who last changed this role's grants, as a name rather than an identifier.
     *
     * `withoutTenancy()`, and this is the one place in the module that needs
     * it: the editor may be somebody whose membership has since ended, or — on
     * a role copied from a template — a platform operator who was never a
     * member of this organisation at all. The tenant scope would hide them and
     * the header would read "never edited" about a role that plainly was. Only
     * a display name crosses the boundary; no email address, no identifier.
     */
    private function editorName(Role $role): ?string
    {
        $editorId = $role->updated_by;

        if ($editorId === null) {
            return null;
        }

        $editor = User::query()->with('profile')->whereKey($editorId)->first();

        if (! $editor instanceof User || $editor->profile === null) {
            return null;
        }

        return trim($editor->profile->given_name.' '.$editor->profile->family_name);
    }
}
