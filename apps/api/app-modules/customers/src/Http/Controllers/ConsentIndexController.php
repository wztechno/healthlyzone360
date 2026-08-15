<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Http\Concerns\PresentsConsentPosition;
use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Presenters\CustomerConsentPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/consents — what this person has agreed to, and what is still
 * asked of them.
 *
 * **One list, not two.** A screen that received only the outstanding texts
 * could not show somebody what they have already accepted, and a person who
 * cannot see what they consented to cannot meaningfully withdraw it — which is
 * the right the whole ledger exists to serve.
 *
 * Filtered to the consumer audience plus the texts everybody holds. Without the
 * filter this endpoint would start asking a kitchen's chef to confirm they are
 * old enough to order food; the audience is a property of the surface rather
 * than a parameter, so no caller can widen it.
 *
 * No customer account is required. Consent attaches to the identity, is
 * collected at registration before any account exists, and survives the account
 * being closed — gating the read on an account would hide a person's own
 * consent history from them at exactly the moment they most want it.
 */
final class ConsentIndexController
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
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);

        $position = $this->consentPosition($user, $this->consents, $this->presenter);

        return ApiResponse::data($position, ['count' => count($position)]);
    }
}
