<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/me/contacts/{contact} — withdraw a destination.
 *
 * **Retired, not deleted** (D-042). The row survives with a tombstone, which is
 * what lets the value be claimed again by somebody else — the partial unique
 * index excludes retired rows — while keeping the record of who held it, which
 * a closure or an abuse investigation needs. `verified_at` is kept for the same
 * reason: the destination *was* proven, and erasing that would erase the only
 * evidence that it was.
 *
 * **The login mirror cannot be withdrawn**, and the refusal is a conflict
 * rather than a validation failure: nothing about the request is malformed, and
 * the same request against any other contact would succeed. What stands in the
 * way is the state of this one — it is where a password reset and an email
 * verification are sent, and an account whose only route back in has been
 * retired is an account nobody can recover. Changing the login address is J2's
 * journey, with its own step-up and its own re-verification; it is not this
 * endpoint with a hole in it.
 *
 * Idempotent: retiring an already-retired contact is a no-op in the registry,
 * and the locator excludes retired rows, so a repeated delete is
 * `resource.not_found` rather than a second tombstone.
 */
final class ContactDestroyController
{
    use ResolvesCustomerAccount;

    public function __construct(private readonly ContactPointRegistry $contacts) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $contact): Response
    {
        $user = $this->currentUser($request);
        $record = $this->contactFor($user, $contact);

        if ($record->is_login_identity) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'The login contact cannot be withdrawn. Change the account email address instead.',
                ['contact_id' => (string) $record->getKey(), 'reason' => 'login_identity'],
            );
        }

        $this->contacts->retire($record);

        return ApiResponse::noContent();
    }
}
