<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Http\Concerns\PresentsConsentPosition;
use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/me/consents/{code} — withdraw.
 *
 * **A state transition, never a deletion.** The grant row survives with
 * `status = withdrawn` and a timestamp, because "this person consented on the
 * 3rd and withdrew on the 9th" is the fact a regulator asks for and a deleted
 * row answers neither half of it. The `consent_grants` policies enforce it from
 * underneath: there is no DELETE policy at all.
 *
 * **A required consent may be withdrawn**, and the consequence is visible
 * rather than prevented: the activation checklist will report it outstanding on
 * the next read, and an account that was active becomes unable to satisfy its
 * requirements. Refusing here would make a right conditional on not needing the
 * service, which is not how consent works. The remedy is offered by the
 * checklist, not by this endpoint.
 *
 * Withdrawing something never granted is a no-op and still 204, because the
 * caller's intent — this person should not hold this consent — is satisfied
 * either way, and an opt-out that failed for somebody who never opted in would
 * be an unpleasant surprise on a page nobody should have to think about.
 *
 * An **unknown code** is a 404, which is the one thing this endpoint does
 * refuse. A code that names no text in the catalogue is a client bug, and
 * answering 204 to it would let a typo look like a successful withdrawal
 * forever.
 */
final class ConsentDestroyController
{
    use PresentsConsentPosition;
    use ResolvesCustomerAccount;

    public function __construct(private readonly ConsentLedger $consents) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $code): Response
    {
        $user = $this->currentUser($request);

        if (! $this->consents->currentDefinitions()->has($code)) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $this->consents->withdraw($user, [$code], $this->consentChannel($request));

        return ApiResponse::noContent();
    }
}
