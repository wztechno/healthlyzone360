<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * The route requires an organisation context but no X-Organisation-Id header
 * was supplied. Minimal JSON mapping for now; the full error envelope with
 * correlation identifiers arrives in Phase 4.
 */
class OrganisationContextRequired extends Exception
{
    public function render(): JsonResponse
    {
        return new JsonResponse([
            'error' => [
                'code' => 'context.organisation_required',
                'message' => 'An X-Organisation-Id header is required for this endpoint.',
            ],
        ], 400);
    }
}
