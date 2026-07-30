<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Enums;

enum MembershipStatus: string
{
    case Invited = 'invited';
    case Active = 'active';
    case Suspended = 'suspended';
    case Ended = 'ended';
}
