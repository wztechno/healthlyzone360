<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\ReplaceApplicationContactsRequest;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/b2b/applications/{application}/contacts — set-replace of the
 * people the company names.
 *
 * A replace rather than a merge, for the reason every set-valued resource in
 * the platform uses one: a client that removed a row has to be able to say so,
 * and a PATCH that only ever adds cannot express a deletion. `{"contacts": []}`
 * is the payload that says "nobody, yet".
 *
 * **No `If-Match` and no `ETag`.** The set is the unit of change and is
 * replaced in one transaction, so there is no half-list for a validator to
 * protect; and these rows carry no `lock_version` of their own because a
 * per-row validator would let two editors replace different halves of one
 * roster. The application's own validator is untouched by this write, which is
 * why it is not echoed back either — echoing an unchanged validator from an
 * endpoint that did not change it invites a client to treat it as fresh.
 *
 * The rows are re-read after the write rather than reflected from the payload:
 * the service trims, normalises and de-duplicates by role, and a response
 * built from the request would show the client what it sent rather than what
 * was stored.
 */
final class B2bApplicationContactReplaceController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ApplicationService $applications,
        private readonly B2bApplicationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceApplicationContactsRequest $request, string $application): JsonResponse
    {
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);

        $this->applications->replaceContacts($record, $request->contacts(), $actor);

        $rows = B2bApplicationContact::query()
            ->where('b2b_application_id', $record->getKey())
            ->orderBy('role')
            ->get();

        return ApiResponse::data([
            'contacts' => $rows->map(fn (B2bApplicationContact $contact): array => $this->presenter->contact($contact))->all(),
        ]);
    }
}
