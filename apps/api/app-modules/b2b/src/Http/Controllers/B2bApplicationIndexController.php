<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/applications — the caller's own applications.
 *
 * Scoped to `applicant_user_id` in the query rather than filtered afterwards,
 * because `b2b_applications` is deliberately not an `OrganisationScoped` model
 * and carries no row-level-security policy: there is no ambient scope to lean
 * on here, so the `where` **is** the isolation. A list endpoint that fetched
 * broadly and trimmed in PHP would leak the moment somebody added a
 * `->orWhere`.
 *
 * There is normally exactly one live application and then a tail of history —
 * a withdrawn attempt, a decline from last year — so the walk is **newest
 * first**. The applicant's question is "where is the one I am filling in", and
 * the answer should be on the first page for as long as the account exists.
 *
 * The list carries the queue shape rather than the full file: a person's own
 * application list is a navigation aid, and the confidential detail belongs on
 * the resource somebody deliberately opened.
 */
final class B2bApplicationIndexController
{
    use ResolvesAuthenticatedUser;

    public function __construct(private readonly B2bApplicationPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = B2bApplication::query()
            ->where('applicant_user_id', (string) $this->currentUser($request)->getKey());

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (B2bApplication $application): array => $this->presenter->summary($application))->all(),
            $page['meta'],
        );
    }
}
