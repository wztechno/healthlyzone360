<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Enums\ApplicationSection;
use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\UpdateApplicationSectionRequest;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/b2b/applications/{application}/sections/{section} — behind
 * `precondition`.
 *
 * **The section is in the path, not the body**, and that is what makes the
 * endpoint honest. A wizard step is a unit of intent — "here are my company
 * details" — and naming it in the URL means the server can refuse a payload
 * that wandered outside it. A body-only PATCH would have to guess, and a guess
 * that silently accepted `legal_name` sent to the logistics step is a bug
 * report six weeks later about data that "didn't save".
 *
 * A key the section does not own is **refused, not ignored**, and the refusal
 * says which section does own it. That is the whole reason
 * `UpdateApplicationSectionRequest::payload()` passes unknown keys through
 * rather than stripping them.
 *
 * `If-Match` is required despite there being exactly one editor, and the reason
 * is the reviewer rather than the applicant: in `info_requested` the writable
 * set is whatever the reviewer last named, and a stale tab that saved over a
 * narrowing it never saw would put answers into fields the review had already
 * closed. The validator is the application's `lock_version`.
 *
 * An unknown `{section}` is `400 request.invalid` naming the parameter, not a
 * 404: the application exists, and the client sent a word this API does not
 * have.
 */
final class B2bApplicationSectionUpdateController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ApplicationService $applications,
        private readonly B2bApplicationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateApplicationSectionRequest $request, string $application, string $section): JsonResponse
    {
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);

        $updated = $this->applications->updateSection(
            $record,
            $this->section($section),
            $request->payload(),
            $actor,
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data(['application' => $this->presenter->application($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }

    /**
     * @throws ApiException
     */
    private function section(string $value): ApplicationSection
    {
        $section = ApplicationSection::tryFrom($value);

        if (! $section instanceof ApplicationSection) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The section must be one of: company, signatory, trade_terms, logistics.',
                ['parameter' => 'section'],
            );
        }

        return $section;
    }
}
