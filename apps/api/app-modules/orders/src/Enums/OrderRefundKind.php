<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * Why an entry sits on the refund ledger. A `Refund` is money that went back; a
 * `ReceiptCorrection` is a receipt that should not have been written, so the
 * balance it covered comes back as outstanding.
 */
enum OrderRefundKind: string
{
    case Refund = 'refund';
    case ReceiptCorrection = 'receipt_correction';
}
