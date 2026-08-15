<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Enums;

/**
 * Whether a refund has been paid, as far as this platform knows.
 *
 * **Two states, and neither of them moves money.** The approved semantics (§3)
 * record a cancellation refund as a credit memo for *manual* settlement until
 * PAY1 exists, and this enum is the honest statement of that: `recorded` means
 * the platform has computed what is owed, `settled` means a human has told it
 * the money changed hands. There is deliberately no `paid` or `refunded` — the
 * platform has no payment rail, and a status implying it had one would be the
 * first thing a report believed.
 *
 * A memo is never deleted and never reversed here. If somebody settles the
 * wrong one, that is a correction with a second memo attached, which is a
 * conversation PAY1 will have to have properly.
 */
enum CreditMemoStatus: string
{
    case Recorded = 'recorded';
    case Settled = 'settled';
}
