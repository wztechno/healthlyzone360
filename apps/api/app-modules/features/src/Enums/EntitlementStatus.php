<?php

declare(strict_types=1);

namespace Healthy360\Features\Enums;

enum EntitlementStatus: string
{
    case Enabled = 'enabled';
    case Disabled = 'disabled';
    case Trial = 'trial';
}
