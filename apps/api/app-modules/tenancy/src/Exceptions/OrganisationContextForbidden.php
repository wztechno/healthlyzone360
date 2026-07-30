<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The declared organisation context could not be validated for the
 * authenticated user (unknown organisation, no membership, or membership not
 * active). One deliberately indistinct message: the response must not reveal
 * whether the organisation exists.
 */
class OrganisationContextForbidden extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::ContextOrganisationForbidden);
    }
}
