<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\StoreOffboardingRequest;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/offboardings — serve notice and open the wind-up.
 *
 * **Platform-driven, and there is deliberately no organisation-side variant.**
 * `OffboardingService` takes an actor and an organisation and assumes the
 * authority has been established; the authority to end a trading relationship
 * is not something a tenant grants itself, and a "request offboarding" endpoint
 * on the tenant's own surface would be a different thing — a *notice of
 * intent*, which needs a state before `notice_served` and a decision by
 * somebody at the platform. That is deferred rather than approximated: an
 * endpoint that let a company put itself into `notice_served` would look like
 * the same thing and would end its own trading with no human in the loop.
 *
 * **`201`, and the row it creates is the wind-up rather than the ending.**
 * Notice is served, `effective_on` is computed once from the agreement's own
 * `notice_period_days` and copied onto the row — so an amendment signed next
 * week cannot shorten notice already served — and nothing has been taken away
 * from anybody. Every subsequent step is a separate deliberate act, because
 * revocation ends people's access to a system they use for work and the
 * platform should have to be told to do it.
 *
 * The refusals: an organisation that is not a corporate customer
 * (`422 validation.failed`), one with no agreement in force and one already
 * being wound up (`409 offboarding.refused`). The last of those is refused here
 * rather than left to the partial unique index, so an operator gets a sentence
 * rather than a constraint violation — and the index stays as the thing nothing
 * can route around.
 */
final class OffboardingStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly OffboardingService $offboardings,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreOffboardingRequest $request): JsonResponse
    {
        /** @var string $organisationId */
        $organisationId = $request->validated('organisation_id');

        // `organisations` carries no ambient tenancy scope of its own — it is
        // the table the scope is *about* — so a plain lookup is right here. The
        // subject is somebody else's company by construction: the organisation
        // in `X-Organisation-Id` is the platform operator's, and `platform.context`
        // has already proven that.
        $organisation = Organisation::query()->whereKey($organisationId)->first();

        if (! $organisation instanceof Organisation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        /** @var string|null $effectiveOn */
        $effectiveOn = $request->validated('effective_on');
        /** @var string|null $note */
        $note = $request->validated('reason_note');

        $offboarding = $this->offboardings->start(
            $organisation,
            $request->trigger(),
            $this->currentUser($request),
            $note,
            $effectiveOn === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $effectiveOn)->startOfDay(),
        );

        return ApiResponse::data(
            ['offboarding' => $this->presenter->offboarding($offboarding)],
            status: 201,
        )->withHeaders(['ETag' => '"'.$offboarding->lock_version.'"']);
    }
}
