<?php

declare(strict_types=1);

namespace Healthy360\Orders\Presenters;

use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;

/**
 * A guest's own order, as the person who placed it may read it.
 *
 * ## One name, chosen by the server
 *
 * `name_en` and `name_ar` never both appear. §4.8's localisation rule is that a
 * consumer projection carries **one** server-chosen name, and a pair of columns
 * on the wire is the signature of somebody having serialised the model. The
 * choice is made from `Accept-Language` and falls back to English when the
 * Arabic snapshot is empty — a blank line on a receipt is worse than a line in
 * the wrong language.
 *
 * ## What is deliberately absent
 *
 * `lock_version` is not here, and neither is an `ETag` on the responses that
 * use this shape. A guest has no write surface on an order — there is no
 * amend, no cancel, no re-address in G1 — so a validator would be a token for a
 * request nobody can make, and the key is on the anonymous-surface denylist.
 *
 * `price_list_id` and `price_list_item_id` are absent for the reason
 * `OrderLine` states in as many words: they exist so "why was this the price?"
 * is answerable a year later, they never leave the server, and the sweep
 * denylists exactly those keys.
 *
 * `organisation_id`, `branch_id` and `sales_channel_id` are absent too, and
 * this one is a judgement rather than a rule. They are the seller's internal
 * identifiers; a guest reached this order from a kitchen's own page and their
 * client already knows which kitchen it was. Naming the seller properly means a
 * projection — a name, a slug, a logo — and that shape already exists on the
 * marketplace surface. Half-naming them with a raw identifier here would be a
 * third vocabulary for the same kitchen.
 *
 * ## The two nominal collisions, stated rather than hidden
 *
 * `lines` and `quantity` both appear on `PublicSurfaceLeakSweepTest`'s
 * denylist. The collision is **nominal**: what that list forbids is a *recipe*
 * line and a *recipe* quantity — the formulation a kitchen must never publish —
 * and what these are is the customer's own receipt, which is meaningless
 * without them. This surface is credentialled by `X-Guest-Token`, so the sweep
 * (which sends no headers) only ever sees its `401` envelope and never these
 * keys. Written down here so that the day somebody gives the sweep a token
 * fixture, they find the argument instead of a puzzle.
 *
 * ## Money
 *
 * Integers of minor units with the currency beside them, never formatted. `4500`
 * with `AED`, never `"45.00 AED"` — the same rule the pricing family states, for
 * the same reason: a server that formats money has decided a locale on the
 * client's behalf and made the number unusable for arithmetic.
 */
final class GuestOrderPresenter
{
    /**
     * @return array{
     *     id: string,
     *     order_number: string,
     *     status: string,
     *     currency_code: string,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     payment_method: string,
     *     delivery: array{label: string|null, line_one: string, line_two: string|null, city: string|null, area: string|null, window_code: string|null, requested_date: string|null},
     *     placed_at: string,
     *     confirmed_at: string|null,
     *     cancelled_at: string|null,
     *     cancellation_reason: string|null,
     *     lines: list<array{id: string, catalogue_item_id: string, name: string, variant_label: string|null, quantity: string, unit_price_minor: int, line_total_minor: int, currency_code: string, allergens: list<array{allergen_code: string, containment: string}>, pack_summary: array<string, mixed>|null}>
     * }
     */
    public function order(Order $order, string $locale): array
    {
        return [
            'id' => (string) $order->getKey(),
            // The reference a person quotes on the telephone, which is why it
            // is here and the account number is not.
            'order_number' => $order->order_number,
            'status' => $order->status->value,
            'currency_code' => $order->currency_code,
            'subtotal_minor' => $order->subtotal_minor,
            // Null is a value: nobody decided a fee for this zone. Never
            // flattened to `0`, which would say delivery is free.
            'delivery_fee_minor' => $order->delivery_fee_minor,
            'total_minor' => $order->total_minor,
            'payment_method' => $order->payment_method->value,
            'delivery' => [
                'label' => $order->delivery_label,
                'line_one' => $order->delivery_line_one,
                'line_two' => $order->delivery_line_two,
                'city' => $order->delivery_city,
                'area' => $this->localised($order->delivery_area_name_en, $order->delivery_area_name_ar, $locale),
                'window_code' => $order->delivery_window_code,
                'requested_date' => $order->requested_delivery_date?->toDateString(),
            ],
            'placed_at' => $order->placed_at->toIso8601String(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $order->cancellation_reason?->value,
            'lines' => $this->lines($order, $locale),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     name: string,
     *     variant_label: string|null,
     *     quantity: string,
     *     unit_price_minor: int,
     *     line_total_minor: int,
     *     currency_code: string,
     *     allergens: list<array{allergen_code: string, containment: string}>,
     *     pack_summary: array<string, mixed>|null
     * }
     */
    public function line(OrderLine $line, string $locale): array
    {
        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_id' => $line->catalogue_item_id,
            'name' => $this->localised($line->name_en, $line->name_ar, $locale) ?? $line->name_en,
            'variant_label' => $line->variant_label,
            // A decimal string, not a float. `2.0000` survives a round trip
            // through JSON and back into PostgreSQL's numeric; `2.0` does not
            // reliably survive anything.
            'quantity' => (string) $line->quantity,
            'unit_price_minor' => $line->unit_price_minor,
            'line_total_minor' => $line->line_total_minor,
            'currency_code' => $line->currency_code,
            // The frozen statement, exactly as it stood when the order was
            // placed. Never re-derived from the catalogue on read: a person who
            // was shown "contains sesame" must still be shown it after the
            // kitchen reformulates.
            'allergens' => $line->allergens,
            'pack_summary' => $line->pack_summary,
        ];
    }

    /**
     * @return list<array{id: string, catalogue_item_id: string, name: string, variant_label: string|null, quantity: string, unit_price_minor: int, line_total_minor: int, currency_code: string, allergens: list<array{allergen_code: string, containment: string}>, pack_summary: array<string, mixed>|null}>
     */
    private function lines(Order $order, string $locale): array
    {
        return array_values($order->lines
            ->sortBy(fn (OrderLine $line): string => $line->name_en)
            ->map(fn (OrderLine $line): array => $this->line($line, $locale))
            ->all());
    }

    /**
     * One name, and English when the other is missing.
     *
     * An empty `name_ar` is a real state — the snapshot copied what the
     * catalogue had, and the catalogue's publish gate is what refuses an
     * untranslated *item*, not this. A receipt that rendered the empty string
     * would be a blank line where the food should be.
     */
    private function localised(?string $english, ?string $arabic, string $locale): ?string
    {
        if ($locale === 'ar' && is_string($arabic) && $arabic !== '') {
            return $arabic;
        }

        return $english !== null && $english !== '' ? $english : null;
    }
}
