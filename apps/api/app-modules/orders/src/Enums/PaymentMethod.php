<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * How an order is paid for.
 *
 * **Three cases, and each one has a table behind it.** That is the whole rule
 * this enum is governed by, and it is the same rule that kept it at one case
 * for the whole of C1: a payment method exists here when there is somewhere in
 * this schema that records money arriving that way, and not a moment sooner.
 *
 *  * `cash_on_delivery` — a driver is handed money at a door. C1's only way to
 *    pay, and still the way most orders are settled.
 *  * `cash_at_counter` — money is handed over in the room, at the Order Desk.
 *  * `wish` — a transfer through the WISH app, **manually confirmed**: nothing
 *    verifies it, a desk person asserts it, and `order_payment_receipts.
 *    confirmed_by` names who.
 *
 * The widening was a deliberate migration
 * (`2026_08_15_003002_widen_payment_methods_and_create_order_payment_receipts`)
 * that moved the database CHECK, this enum and the receipts ledger in one act,
 * exactly as the orders table's docblock said it would have to be.
 *
 * What has not changed is the refusal. There is still no `Card`, no `Wallet`
 * and no `Online` case reserved here, and no case is added in anticipation of
 * a table: a reserved case is a value something eventually writes, and this
 * value is read to decide what evidence a payment is expected to carry.
 *
 * Note also what this enum is *not*: `payment_method` on an order is the
 * **intent** captured at placement, and `order_payment_receipts.method` is how
 * the money actually turned up. They share this vocabulary and are deliberately
 * not constrained to agree.
 */
enum PaymentMethod: string
{
    case CashOnDelivery = 'cash_on_delivery';

    case CashAtCounter = 'cash_at_counter';

    case Wish = 'wish';
}
