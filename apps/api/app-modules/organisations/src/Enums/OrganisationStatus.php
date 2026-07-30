<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Enums;

enum OrganisationStatus: string
{
    case Active = 'active';
    case Suspended = 'suspended';
    case Pending = 'pending';
}
