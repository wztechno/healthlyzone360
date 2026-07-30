<?php

declare(strict_types=1);

namespace Healthy360\Consent\Enums;

enum ConsentStatus: string
{
    case Granted = 'granted';
    case Withdrawn = 'withdrawn';
}
