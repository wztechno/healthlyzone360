<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * How an order is paid for.
 *
 * **One case, and that is the design** (master plan v2 C1, F-bis #3). Cash on
 * delivery is the whole of what this platform accepts until PAY1 introduces
 * payments with its own tables, its own provider selection and its own
 * security review. The enum exists as a single case rather than as a hardcoded
 * string so that the day a second method arrives, every reader of this value
 * is already asking a type rather than comparing a literal — and so that the
 * database CHECK, the enum and the API contract can be widened together in one
 * deliberate act.
 *
 * There is no `Card`, no `Wallet` and no `Online` case reserved here. A
 * reserved case is a value something eventually writes.
 */
enum PaymentMethod: string
{
    case CashOnDelivery = 'cash_on_delivery';
}
