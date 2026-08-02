<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;

/**
 * Pricing's answer to the catalogue's publish-gate question: which variants
 * somebody has actually committed a number to.
 *
 * Built on `confirmedOpenRows()` rather than on a hand-written predicate, so
 * that "the only rows that may ever reach a customer" has exactly one
 * definition in this module and the K1.5 scope test pins it for this caller
 * too. A placeholder is not a price, a market-priced row is not a price, and a
 * closed row is last spring's price.
 *
 * The **list** conditions are added here rather than folded into the scope, for
 * the reason `PriceListItem` gives: a scope named for two conditions that
 * quietly applied four would be unreadable at the call site. What this adds is
 * `status = active` — a draft tariff prices nothing, which is what draft means
 * — and the organisation predicate.
 *
 * The list's `valid_from`/`valid_to` window is deliberately **not** consulted.
 * A kitchen pricing next season's plans on a tariff that opens in September is
 * doing the right thing in the right order, and refusing to let it publish
 * until September would mean the readiness gate reading a calendar. What the
 * gate asks is whether somebody has committed to a number, not whether that
 * number governs today.
 *
 * `withoutTenancy()` with an explicit `organisation_id` predicate, matching
 * `PriceResolver`: the caller supplies the organisation from the item being
 * published, so the answer is correct whatever ambient context the call arrives
 * in, and a cross-tenant answer is impossible rather than merely unlikely.
 */
final readonly class PriceListConfirmedPriceRegistry implements ConfirmedPriceRegistry
{
    /**
     * @param  list<string>  $variantIds
     * @return list<string>
     */
    public function pricedVariantIds(string $organisationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        /** @var list<string> */
        return array_values(array_unique(PriceListItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('catalogue_item_variant_id', $variantIds)
            ->confirmedOpenRows()
            ->whereIn('price_list_id', PriceList::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('status', PriceListStatus::Active->value)
                ->select('id'))
            ->pluck('catalogue_item_variant_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all()));
    }
}
