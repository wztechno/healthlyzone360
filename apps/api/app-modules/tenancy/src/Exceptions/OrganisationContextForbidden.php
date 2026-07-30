<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * The declared organisation context could not be validated for the
 * authenticated user (unknown organisation, no membership, or membership not
 * active). One deliberately indistinct message: the response must not reveal
 * whether the organisation exists.
 */
class OrganisationContextForbidden extends Exception
{
    public function render(): JsonResponse
    {
        return new JsonResponse([
            'error' => [
                'code' => 'context.organisation_forbidden',
                'message' => 'You do not have an active membership in the requested organisation.',
            ],
        ], 403);
    }
}
