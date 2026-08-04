<?php

declare(strict_types=1);

namespace Healthy360\Payments\Enums;

enum PaymentMethodKind: string
{
    case CashOnDelivery = 'cash_on_delivery';
    case Card = 'card';
    case Invoice = 'invoice';
}
