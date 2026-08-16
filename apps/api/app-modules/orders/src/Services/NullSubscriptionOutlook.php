<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\SubscriptionOutlook;

/**
 * The answer when no subscriptions module is installed: a calendar of real
 * orders and nothing else.
 *
 * Bound by `OrdersServiceProvider` and replaced by the subscriptions module's
 * real adapter when that module is present. The null object exists so the desk
 * calendar keeps working — and keeps being testable — without subscriptions,
 * rather than resolving to an unbound interface and failing at the container
 * the first time somebody opens next week.
 *
 * Two empty lists are the **honest** answer rather than a degraded one. A
 * deployment that sells no standing arrangements has no forward book beyond the
 * orders it has actually taken, and a calendar showing only those is not
 * missing anything.
 */
final class NullSubscriptionOutlook implements SubscriptionOutlook
{
    /**
     * @return array{
     *     scheduled: list<array{delivery_date: string, delivery_window_code: string|null}>,
     *     projected: list<array{delivery_date: string, delivery_window_code: string|null}>,
     * }
     */
    public function forWindow(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array {
        return ['scheduled' => [], 'projected' => []];
    }
}
