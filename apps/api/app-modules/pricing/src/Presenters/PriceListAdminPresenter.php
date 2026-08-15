<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Presenters;

use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;

/**
 * The administrative wire shapes of the pricing module.
 *
 * **Amounts leave as integers with their currency beside them, never
 * formatted.** `{"unit_amount_minor": 4500, "currency_code": "AED"}` and not
 * `"45.00 AED"`, and not `45.0` either. Three reasons, in order of how much
 * they cost when ignored: a float loses money at the fourth decimal of a
 * currency that has three; a server-formatted string picks a locale, a
 * separator and a symbol position on behalf of a client that already knows the
 * user's locale and this one does not; and a formatted amount cannot be added
 * up without being parsed back, which is where the rounding goes wrong. The
 * client formats. That is what `Intl.NumberFormat` is for, and it is already
 * how the frontend renders every other number.
 *
 * **Placeholder and market-priced rows are served here in full**, carrying
 * their status and a null amount. This is the admin surface: the whole point
 * of the honest badge is that a merchandiser can see which prices are real and
 * which are owed, and hiding the unpriced rows from the person whose job is to
 * price them would be exactly backwards. What must never happen is the same
 * rows reaching a *customer*, and that is the public projection's job (M1),
 * built on `PriceListItem::confirmedOpenRows()` — a separate presenter with
 * its own denylist sweep, never this one with fields removed. A public shape
 * derived by subtraction is one refactor away from leaking.
 *
 * `effective_to` is served as written — exclusive — and named plainly enough
 * that a client reading `2026-08-02` for both a row's end and its successor's
 * start can see the interval is half-open rather than guess.
 */
final class PriceListAdminPresenter
{
    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     branch_id: string|null,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     currency_code: string,
     *     customer_scope: string,
     *     status: string,
     *     valid_from: string|null,
     *     valid_to: string|null,
     *     source_system: string|null,
     *     source_ref: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function priceList(PriceList $priceList): array
    {
        return [
            'id' => (string) $priceList->getKey(),
            'organisation_id' => $priceList->organisation_id,
            'branch_id' => $priceList->branch_id,
            'code' => $priceList->code,
            'name_en' => $priceList->name_en,
            'name_ar' => $priceList->name_ar,
            'currency_code' => $priceList->currency_code,
            'customer_scope' => $priceList->customer_scope->value,
            'status' => $priceList->status->value,
            'valid_from' => $priceList->valid_from?->toDateString(),
            'valid_to' => $priceList->valid_to?->toDateString(),
            'source_system' => $priceList->source_system,
            'source_ref' => $priceList->source_ref,
            'lock_version' => $priceList->lock_version,
            'created_at' => $priceList->created_at?->toIso8601String(),
            'updated_at' => $priceList->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     min_quantity: string|null,
     *     unit_amount_minor: int|null,
     *     currency_code: string,
     *     price_status: string,
     *     effective_from: string,
     *     effective_to: string|null,
     *     superseded_by_id: string|null,
     *     created_at: string|null
     * }
     */
    public function entry(PriceListItem $entry, string $currencyCode): array
    {
        return [
            'id' => (string) $entry->getKey(),
            'catalogue_item_id' => $entry->catalogue_item_id,
            'catalogue_item_variant_id' => $entry->catalogue_item_variant_id,
            'min_quantity' => $entry->min_quantity,
            // Null whenever the status says there is no price. The pair is a
            // single fact and the database CHECK guarantees it, so a client may
            // branch on either half and get the same answer.
            'unit_amount_minor' => $entry->unit_amount_minor,
            // Repeated on every row even though it belongs to the list: a row
            // that travelled somewhere on its own — into a table cell, a log
            // line, an order snapshot — must not arrive without its currency.
            'currency_code' => $currencyCode,
            'price_status' => $entry->price_status->value,
            'effective_from' => $entry->effective_from->toDateString(),
            'effective_to' => $entry->effective_to?->toDateString(),
            'superseded_by_id' => $entry->superseded_by_id,
            'created_at' => $entry->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{id: string, sales_channel_id: string, price_list_id: string, priority: int}
     */
    public function channelAssignment(ChannelPriceList $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'sales_channel_id' => $row->sales_channel_id,
            'price_list_id' => $row->price_list_id,
            'priority' => $row->priority,
        ];
    }
}
