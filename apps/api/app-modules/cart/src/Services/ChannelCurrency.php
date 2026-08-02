<?php

declare(strict_types=1);

namespace Healthy360\Cart\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;

/**
 * What one channel trades in.
 *
 * A basket has to be denominated before it holds anything — a currency decided
 * per line is not a currency, it is a pile of incomparable numbers — and the
 * honest source is the channel's own tariff: the currency of the first price
 * list it would actually consult.
 *
 * The walk deliberately mirrors `PriceResolver`'s first step (assignments in
 * `priority` order, `created_at` and `id` breaking ties, only `active` lists
 * whose validity window covers the day), because the answer must be the
 * currency of the list that is going to price things. Duplicating the *whole*
 * resolver would be worse: this needs one column from the winning list and
 * nothing about rows, tiers or variants.
 *
 * **A channel with no usable list falls back to the seller's default
 * currency.** That is not a guess about prices — there are none — it is what
 * lets an empty basket exist at all on a channel a kitchen has not finished
 * configuring. Every line added to it is then refused as `unpriced`, which is
 * the truth.
 *
 * A channel holding lists in two currencies resolves to the highest-priority
 * one, and lines that only the other list prices are refused
 * `currency_mismatch` rather than converted. Converting would mean inventing
 * an exchange rate; refusing makes a configuration mistake visible on the
 * first order instead of on the first reconciliation.
 */
final readonly class ChannelCurrency
{
    public function for(SalesChannel $channel, ?CarbonImmutable $on = null): string
    {
        $day = ($on ?? CarbonImmutable::now())->startOfDay();

        /** @var list<string> $listIds */
        $listIds = ChannelPriceList::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('organisation_id', $channel->organisation_id)
            ->orderBy('priority')
            ->orderBy('created_at')
            ->orderBy('id')
            ->pluck('price_list_id')
            ->all();

        if ($listIds !== []) {
            $lists = PriceList::withoutTenancy()
                ->whereIn('id', $listIds)
                ->where('organisation_id', $channel->organisation_id)
                ->where('status', PriceListStatus::Active->value)
                ->get()
                ->keyBy(static fn (PriceList $list): string => (string) $list->getKey());

            foreach ($listIds as $id) {
                $list = $lists->get($id);

                if ($list instanceof PriceList && $list->isInEffectOn($day)) {
                    return $list->currency_code;
                }
            }
        }

        return $this->sellerDefault($channel);
    }

    private function sellerDefault(SalesChannel $channel): string
    {
        // `Organisation` carries no tenant scope of its own — it *is* the
        // tenant — so this is a plain lookup rather than a bypassed one.
        $organisation = Organisation::query()->whereKey($channel->organisation_id)->first();

        return $organisation instanceof Organisation ? $organisation->default_currency_code : 'USD';
    }
}
