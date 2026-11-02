<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Enums;

/**
 * Why a run came back. A fixed vocabulary for the reason `CancellationReason` is
 * one, with `other` and a note for what it does not cover.
 */
enum DeliveryFailureReason: string
{
    case NoAnswer = 'no_answer';
    case WrongAddress = 'wrong_address';
    case Refused = 'refused';
    case Unreachable = 'unreachable';
    case Other = 'other';
}
