<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The route requires an organisation context but no X-Organisation-Id header
 * was supplied. Rendered as the standard error envelope (400,
 * context.organisation_required) by the central API exception renderer.
 */
class OrganisationContextRequired extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::ContextOrganisationRequired);
    }
}
