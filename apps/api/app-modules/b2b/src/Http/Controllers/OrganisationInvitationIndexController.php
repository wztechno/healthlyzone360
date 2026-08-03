<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Presenters\OrganisationInvitationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/organisations/{organisation}/invitations — who has been offered a
 * place.
 *
 * Requires `membership.view_organisation`, inside `org.context`, and the
 * organisation in the path must be the one in context — a mismatch is `404`.
 * The `organisation_id` predicate here **is** the isolation: see the store
 * controller for why this table deliberately carries no PostgreSQL policy.
 *
 * **Accepted and revoked invitations are listed too**, and only a `status`
 * filter narrows to the live ones. An administrator asking "who did we invite"
 * needs the ones that were taken up and the ones that were withdrawn as much as
 * the ones still outstanding; a list that showed only live offers would make
 * "did we ever invite her?" unanswerable from this screen. The expired ones are
 * the exception that proves it — they are eventually purged, because an unused
 * offer that lapsed holds an email address for no remaining purpose.
 *
 * `status` is derived rather than stored — an invitation is live, accepted,
 * revoked or expired, and three of those four are already facts on the row —
 * so the filter is expressed as predicates over `accepted_at`, `revoked_at` and
 * `expires_at` rather than as a column comparison. That is the same
 * computation the presenter performs, which is why the two can never disagree.
 *
 * Newest first: an invitation list is read to find something recent.
 */
final class OrganisationInvitationIndexController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly OrganisationInvitationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation): JsonResponse
    {
        $tenant = $this->locator->contextOrganisation($organisation);

        $query = OrganisationInvitation::query()->where('organisation_id', $tenant->getKey());

        $this->applyStatus($request, $query);

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (OrganisationInvitation $invitation): array => $this->presenter->invitation($invitation))->all(),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<OrganisationInvitation>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            return;
        }

        match ($status) {
            'live' => $query->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now()),
            'accepted' => $query->whereNotNull('accepted_at'),
            'revoked' => $query->whereNull('accepted_at')->whereNotNull('revoked_at'),
            'expired' => $query->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '<=', now()),
            default => throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: live, accepted, revoked, expired.',
                ['parameter' => 'status'],
            ),
        };
    }
}
