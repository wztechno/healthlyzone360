<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Illuminate\Database\Eloquent\Builder;

/**
 * What one article actually costs, through one channel, on one day.
 *
 * This is the question everything downstream asks — a listing, a cart, an
 * order snapshot in C1 — and it is asked here once so that four surfaces
 * cannot answer it four ways.
 *
 * **The walk.**
 *
 * 1. The channel's price lists, in `priority` order, lowest first. A channel
 *    legitimately holds several: a standing trade tariff plus a negotiated
 *    sheet for one account. The first list that prices the point wins
 *    outright — the lists are **not merged**, so a client's agreement can
 *    override two lines without restating the other four hundred, and a gap in
 *    the agreement falls through to the tariff behind it rather than becoming
 *    a hole.
 * 2. Within a list: rows that govern the day (`effective_from <= date <
 *    effective_to`), on the exact article, and matching the variant rule below.
 * 3. Among those: the highest `min_quantity` at or below the quantity asked
 *    for. A tier says "from here upwards", so "50 or more" beats "10 or more"
 *    at 60 and loses at 20, and a row with no tier at all is the base price.
 *
 * **The variant rule.** Asking for a variant prefers that variant's own row
 * and falls back to the item-level row (the one with no variant), because a
 * kitchen that prices the article once means that price for every pack of it.
 * Asking *without* a variant matches only item-level rows — never one pack's
 * price offered as the article's, which would answer "what does the harissa
 * cost" with the 250 g jar's number and be wrong by a factor of four.
 *
 * **Honest absence.** A point priced only by placeholder or market-priced rows
 * resolves to `null`, exactly as an unpriced one does, and the caller has to
 * handle "there is no price" either way. That is the whole design: a resolver
 * that returned a placeholder's NULL amount inside a populated result object
 * would push every caller into checking a nullable field they did not know was
 * nullable, and the first one that forgot would render `0`. The three
 * unpriceable states are deliberately indistinguishable *here*; the admin
 * surface, which is allowed to see them, reads the rows directly.
 *
 * A list is consulted only when it is `active` and its own validity window
 * covers the day. Draft tariffs price nothing — that is what draft means — and
 * a window that has closed stops pricing without anybody having to remember to
 * detach it.
 *
 * The **channel's own status is deliberately not consulted**. "The wholesale
 * desk is switched off" and "this article has no price on the wholesale desk"
 * are different facts, and collapsing them into the same `null` would make a
 * caller unable to tell a closed channel from an unpriced article. Whether the
 * channel is serving at all is a question the caller asks the channel, before
 * it asks this what anything costs.
 *
 * **On the tenant scope.** Every query here runs `withoutTenancy()` and then
 * filters on the *channel's own* `organisation_id`. Both halves are
 * deliberate. The bypass is needed because the caller that matters most has no
 * membership: a customer browsing a kitchen's web shop (M1) or placing an
 * order (C1) is not a member of that kitchen, and the ambient organisation
 * scope would either throw or be the wrong organisation. Deriving the scope
 * from the channel instead makes the resolver correct whatever context it is
 * called in, and makes a cross-tenant answer impossible rather than merely
 * unlikely — a price list wrongly assigned to another organisation's channel
 * still cannot price through it. The PostgreSQL policy on `price_list_items`
 * remains the outer layer and is not weakened by anything here: an anonymous
 * read still runs with `app.organisation_id` set to the kitchen being browsed.
 */
final readonly class PriceResolver
{
    /**
     * @param  string  $salesChannelId  the channel the customer is buying through
     * @param  string  $catalogueItemId  the article
     * @param  string|null  $catalogueItemVariantId  the pack or plan configuration, when one is named
     * @param  int|float|string|null  $quantity  how many; defaults to one
     * @param  CarbonImmutable|null  $date  the day to price on; defaults to today
     */
    public function currentFor(
        string $salesChannelId,
        string $catalogueItemId,
        ?string $catalogueItemVariantId = null,
        int|float|string|null $quantity = null,
        ?CarbonImmutable $date = null,
    ): ?ResolvedPrice {
        $on = ($date ?? CarbonImmutable::now())->startOfDay();
        $wanted = $quantity === null ? 1.0 : (float) $quantity;

        $channel = SalesChannel::withoutTenancy()->whereKey($salesChannelId)->first();

        if (! $channel instanceof SalesChannel) {
            return null;
        }

        foreach ($this->listsFor($channel, $on) as $priceList) {
            $row = $this->bestRowIn($priceList, $channel->organisation_id, $catalogueItemId, $catalogueItemVariantId, $wanted, $on);

            if ($row !== null) {
                return new ResolvedPrice(
                    amountMinor: (int) $row->unit_amount_minor,
                    currencyCode: $priceList->currency_code,
                    priceListId: (string) $priceList->getKey(),
                    priceListItemId: (string) $row->getKey(),
                    minQuantity: $row->min_quantity,
                );
            }
        }

        return null;
    }

    /**
     * The channel's lists, in the order they are consulted.
     *
     * `created_at` and `id` break a priority tie, so two lists assigned at the
     * same priority resolve deterministically rather than by whatever order
     * PostgreSQL felt like returning. A tie is a configuration mistake, but an
     * intermittent price is a much worse symptom of it than a consistent one.
     *
     * @return list<PriceList>
     */
    private function listsFor(SalesChannel $channel, CarbonImmutable $on): array
    {
        /** @var list<string> $listIds */
        $listIds = ChannelPriceList::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('organisation_id', $channel->organisation_id)
            ->orderBy('priority')
            ->orderBy('created_at')
            ->orderBy('id')
            ->pluck('price_list_id')
            ->all();

        if ($listIds === []) {
            return [];
        }

        $lists = PriceList::withoutTenancy()
            ->whereIn('id', $listIds)
            ->where('organisation_id', $channel->organisation_id)
            ->where('status', PriceListStatus::Active->value)
            ->get()
            ->keyBy(static fn (PriceList $list): string => (string) $list->getKey());

        $ordered = [];

        foreach ($listIds as $id) {
            $list = $lists->get($id);

            if ($list instanceof PriceList && $list->isInEffectOn($on)) {
                $ordered[] = $list;
            }
        }

        return $ordered;
    }

    /**
     * The best confirmed, standing-on-that-day row of one list, or null.
     */
    private function bestRowIn(
        PriceList $priceList,
        string $organisationId,
        string $catalogueItemId,
        ?string $catalogueItemVariantId,
        float $quantity,
        CarbonImmutable $on,
    ): ?PriceListItem {
        $candidates = PriceListItem::withoutTenancy()
            ->where('price_list_id', $priceList->getKey())
            ->where('organisation_id', $organisationId)
            ->where('catalogue_item_id', $catalogueItemId)
            ->where('price_status', PriceStatus::Confirmed->value)
            ->where('effective_from', '<=', $on->toDateString())
            ->where(function (Builder $scoped) use ($on): void {
                // `effective_to` is exclusive: a row closed today stops
                // governing today, which is exactly what makes the same-day
                // supersession single-valued.
                $scoped->whereNull('effective_to')->orWhere('effective_to', '>', $on->toDateString());
            })
            ->get();

        // The variant rule: the named variant's own rows first, item-level
        // rows only if it has none. Evaluated as two passes over one result
        // set rather than two queries, because falling back has to consider
        // *every* tier of the fallback, not merely the tiers the first pass
        // missed.
        $passes = $catalogueItemVariantId === null
            ? [null]
            : [$catalogueItemVariantId, null];

        foreach ($passes as $variantId) {
            $best = null;
            $bestTier = null;

            foreach ($candidates as $row) {
                if ($row->catalogue_item_variant_id !== $variantId) {
                    continue;
                }

                $tier = $row->min_quantity === null ? 0.0 : (float) $row->min_quantity;

                if ($tier > $quantity) {
                    continue;
                }

                if ($bestTier === null || $tier > $bestTier) {
                    $best = $row;
                    $bestTier = $tier;
                }
            }

            if ($best !== null) {
                return $best;
            }
        }

        return null;
    }
}
