<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Tenancy\Scopes\OrganisationScope;

/**
 * The name a kitchen gave a delivery window, for an order that only snapshots the code (HA-22).
 *
 * Checkout shows the kitchen's own names ("Lunch · 11:00–14:00"), and the kitchen's pages read
 * them too; the customer's tracking page and the kitchen display had only the code, and printed it
 * as "Midday". Both shapes now carry the name so every page says the same word.
 *
 * **Read without the organisation scope, by the order's own organisation.** The customer's
 * `/me/orders` has no organisation context and the scope fails closed; the organisation comes from
 * an order the caller has already been proved to own or sell, never from the request.
 *
 * One read per organisation per request: a kitchen has a handful of windows, and a page of orders
 * is almost always one kitchen's.
 */
final class OrderWindowNames
{
    /** @var array<string, array<string, array{en: string, ar: string}>> organisation → code → names */
    private array $byOrganisation = [];

    /**
     * @return array{en: string, ar: string}|null
     */
    public function for(string $organisationId, ?string $code): ?array
    {
        if ($code === null || $code === '') {
            return null;
        }

        if (! array_key_exists($organisationId, $this->byOrganisation)) {
            $names = [];

            $rows = DeliveryWindow::query()
                ->withoutGlobalScope(OrganisationScope::class)
                ->where('organisation_id', $organisationId)
                ->get(['code', 'name_en', 'name_ar']);

            foreach ($rows as $row) {
                $names[$row->code] = ['en' => $row->name_en, 'ar' => $row->name_ar];
            }

            $this->byOrganisation[$organisationId] = $names;
        }

        return $this->byOrganisation[$organisationId][$code] ?? null;
    }
}
