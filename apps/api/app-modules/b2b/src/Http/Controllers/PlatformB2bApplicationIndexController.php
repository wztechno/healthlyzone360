<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/platform/b2b/applications — the review queue.
 *
 * Requires `b2b_application.view_platform`, behind `platform.context`. Two
 * gates, not one: the context asserts the selected organisation *is* the
 * platform operator, and the permission asserts the member holds the code. A
 * tenant that somehow acquired the permission still cannot reach this, because
 * an organisation type is not something a tenant can grant itself. Admitting a
 * company to trade is a platform decision by construction — there is no
 * organisation to scope it to until the decision has been made.
 *
 * **Oldest first**, unlike every other list in the platform. This is a queue
 * rather than a feed: the fair order to work applications in is the order they
 * arrived, and newest-first would leave a company that applied in March behind
 * one that applied this morning for as long as the queue keeps growing. The
 * applicant's own list walks the other way, because there the question is
 * "where is the one I am filling in".
 *
 * **Drafts are excluded unless asked for by name.** A draft is somebody's
 * half-typed form that has not been sent to anybody; putting it in a reviewer's
 * queue would show the platform a company's private working-out and invite
 * somebody to act on an application that was never submitted. `status=draft`
 * still serves them, because support occasionally needs to see one.
 *
 * `query` matches the legal name, the trading name and the reference, because
 * those are the three things a person holds when they ring up: what the
 * company is called, what it trades as, and the code on the email.
 */
final class PlatformB2bApplicationIndexController
{
    public function __construct(private readonly B2bApplicationPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = B2bApplication::query();

        $this->applyStatus($request, $query);
        $this->applySearch($request, $query);

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (B2bApplication $application): array => $this->presenter->summary($application))->all(),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<B2bApplication>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', '!=', ApplicationStatus::Draft->value);

            return;
        }

        if (! is_string($status) || ApplicationStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: draft, submitted, in_review, info_requested, approved, declined, withdrawn.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<B2bApplication>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->where(function (Builder $scoped) use ($needle): void {
            $scoped->whereRaw('lower(legal_name) like ?', [$needle])
                ->orWhereRaw('lower(trading_name) like ?', [$needle])
                ->orWhereRaw('lower(reference) like ?', [$needle]);
        });
    }
}
