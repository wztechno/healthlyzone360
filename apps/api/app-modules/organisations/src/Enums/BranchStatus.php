<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Enums;

enum BranchStatus: string
{
    case Active = 'active';
    case Closed = 'closed';
}
