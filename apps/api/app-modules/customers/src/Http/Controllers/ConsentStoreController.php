<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Http\Concerns\PresentsConsentPosition;
use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Http\Requests\StoreConsentRequest;
use Healthy360\Customers\Presenters\CustomerConsentPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/consents — record acceptance.
 *
 * The grant is written against the **current version** of each definition, read
 * by the ledger at the moment of writing. A client cannot name a version, and
 * that is the guarantee rather than a limitation: a body that carried one could
 * accept a text that has since been reissued, which is consenting to words
 * nobody is showing any more.
 *
 * Re-granting something already held is a no-op, so a retried request cannot
 * duplicate the audit trail — the fact a regulator asks for is "this person
 * consented on the 3rd", and two rows saying so is worse evidence than one.
 * Unknown codes are skipped rather than refused: a client sending one has a
 * stale catalogue, not a malformed request.
 *
 * 200 with the caller's full position rather than 201 with what was written.
 * The response of a grant is what the person now holds — which is also exactly
 * what `GET /me/consents` answers, from the same builder, so the screen after
 * the tick cannot disagree with the screen before it. Skipped codes are visible
 * by their absence from `granted`, which is more useful than a count.
 */
final class ConsentStoreController
{
    use PresentsConsentPosition;
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly ConsentLedger $consents,
        private readonly CustomerConsentPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreConsentRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);

        $this->consents->grant($user, $request->payload()['codes'], $this->consentChannel($request));

        $position = $this->consentPosition($user, $this->consents, $this->presenter);

        return ApiResponse::data($position, ['count' => count($position)]);
    }
}
