<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\RoleWriter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * DELETE /api/v1/organisations/{organisation}/roles/{role} — remove a role
 * nobody holds.
 *
 * A real delete, not a soft one: there are no soft deletes anywhere on this
 * platform, and a role that nobody holds and that grants nothing to anybody is
 * a row with no remaining meaning. The history that matters — who could do what
 * — lives in `audit_logs` and in the memberships that carried the role while it
 * existed.
 *
 * **Refused while anybody still holds it**, and that refusal is the whole
 * reason this endpoint has a guard beyond the policy. `membership_roles`
 * cascades on delete, so the database would happily take a role away from six
 * people without saying a word — which is exactly the silent revocation this
 * module exists to make impossible. The 409 carries the count and up to twenty
 * membership identifiers, so the console can say "reassign these six first"
 * rather than "no".
 *
 * `precondition` for the reason the update carries it, sharpened: somebody may
 * have granted this role to a new starter between the list being read and
 * Delete being pressed, and a delete that ignored the version would take it
 * straight back off them.
 *
 * 204, with nothing in the body. There is no resource left to describe.
 */
final class OrganisationRoleDeleteController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly RoleWriter $writer,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation, string $role): Response
    {
        $this->locator->contextOrganisation($organisation);
        $record = $this->locator->ownRole($role);

        Gate::authorize('delete', $record);

        $this->writer->delete($record, $this->requiredLockVersion($request));

        return ApiResponse::noContent();
    }
}
