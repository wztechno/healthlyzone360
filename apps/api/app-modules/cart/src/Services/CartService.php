<?php

declare(strict_types=1);

namespace Healthy360\Cart\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Cart\Enums\CartStatus;
use Healthy360\Cart\Exceptions\LineRefused;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Models\CartItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Everything that can be done to a basket.
 *
 * **The server validates on the way in.** `addItem` runs a full price probe —
 * the article is published, the channel offers it that day, there is a
 * confirmed price, and that price is in the basket's currency — and refuses
 * the line if any of that fails. The alternative, accepting anything and
 * discovering the problem at checkout, is the shape of the prototype this
 * programme replaces: a customer builds a basket for ten minutes and is told
 * at the end that half of it was never orderable.
 *
 * **The probe's price is thrown away.** This is the important half. What the
 * probe establishes is *orderability*, not cost: `carts` and `cart_items` hold
 * no amount at all, and `OrderPlacementService` reprices every line at
 * placement. A cart price is advisory by nature — the tariff may change
 * between adding a line and paying for it — and storing an advisory number
 * next to an authoritative one is how the wrong one eventually gets charged.
 *
 * **One open cart per customer per channel**, held by a partial unique index
 * and read here through `getOrCreate`. The index rather than a check-then-
 * insert because two taps on a slow connection are a race, and a race that
 * produces two baskets loses one of them silently.
 *
 * Cart mutations are audited (`cart.opened`, `cart.line_added`,
 * `cart.line_quantity_changed`, `cart.line_removed`, `cart.expired`,
 * `cart.converted`). Metadata carries counts and identifiers and never a key
 * ending in `_code`, which the audit redactor would blank.
 */
final readonly class CartService
{
    public function __construct(
        private LineProbe $probe,
        private ChannelCurrency $currencies,
        private AuditRecorder $audit,
    ) {}

    /**
     * The customer's open basket on this channel, opening one if there is
     * none.
     *
     * `branchId` is where the food would be produced. It is optional because a
     * customer choosing a meal has usually not chosen a kitchen location yet,
     * and naming one for them would silently pick whose cut-off and whose
     * delivery terms apply. Passing one on an existing open cart moves it —
     * the customer has since chosen.
     *
     * @throws ApiException
     */
    public function getOrCreate(CustomerAccount $account, SalesChannel $channel, ?string $branchId = null): Cart
    {
        $existing = $this->openCartFor($account, $channel);

        if ($existing instanceof Cart) {
            if ($branchId !== null && $existing->branch_id !== $branchId) {
                $existing->branch_id = $this->validatedBranchId($channel, $branchId);
                $existing->save();
            }

            return $existing;
        }

        $cart = new Cart;
        $cart->organisation_id = $channel->organisation_id;
        $cart->customer_account_id = (string) $account->getKey();
        $cart->sales_channel_id = (string) $channel->getKey();
        $cart->branch_id = $branchId === null ? null : $this->validatedBranchId($channel, $branchId);
        $cart->status = CartStatus::Open;
        $cart->currency_code = $this->currencies->for($channel);
        $cart->expires_at = CarbonImmutable::now()->addMinutes($this->ttlMinutes());
        $cart->lock_version = 0;
        $cart->save();

        $this->audit->record(
            'cart.opened',
            subjectType: 'cart',
            subjectId: (string) $cart->getKey(),
            metadata: [
                'customer_account_id' => (string) $account->getKey(),
                'sales_channel_id' => (string) $channel->getKey(),
                'currency' => $cart->currency_code,
            ],
        );

        return $cart;
    }

    /**
     * Add a quantity of something, or raise the quantity of a line that is
     * already there.
     *
     * Merging rather than appending, because "two of these" and "one of these
     * twice" are the same basket, and a customer who has to scroll past three
     * copies of one line to find the total has been shown the database's
     * internal state instead of their order. The unique index makes the merge
     * a guarantee; this method makes it the behaviour.
     *
     * @param  string|int|float  $quantity  how many; must be positive
     *
     * @throws ApiException|LineRefused
     */
    public function addItem(
        Cart $cart,
        string $catalogueItemId,
        ?string $catalogueItemVariantId = null,
        string|int|float $quantity = 1,
        ?CarbonImmutable $deliveryDate = null,
    ): CartItem {
        $this->assertShoppable($cart);

        $asked = $this->validatedQuantity($quantity);
        $existing = $this->lineOf($cart, $catalogueItemId, $catalogueItemVariantId, $deliveryDate);
        $total = $this->decimal((float) $asked + ($existing instanceof CartItem ? (float) $existing->quantity : 0.0));

        // Probed at the *combined* quantity, not the increment: a tier that
        // begins at fifty is reached by the fiftieth unit however it was
        // added, and probing the increment alone would price a top-up against
        // the wrong tier.
        $result = $this->probe->probe(
            $this->channelOf($cart),
            $catalogueItemId,
            $catalogueItemVariantId,
            $total,
            $deliveryDate,
            $cart->currency_code,
            $this->buyerOf($cart),
        );

        if (! $result->isOrderable()) {
            throw new LineRefused($result->refusals);
        }

        $line = DB::transaction(function () use ($cart, $existing, $catalogueItemId, $catalogueItemVariantId, $total, $deliveryDate): CartItem {
            if ($existing instanceof CartItem) {
                $existing->quantity = $total;
                $existing->save();

                return $existing;
            }

            $line = new CartItem;
            $line->cart_id = (string) $cart->getKey();
            $line->catalogue_item_id = $catalogueItemId;
            $line->catalogue_item_variant_id = $catalogueItemVariantId;
            $line->quantity = $total;
            $line->delivery_date = $deliveryDate;
            $line->save();

            return $line;
        });

        $this->touchCart($cart);

        $this->audit->record(
            'cart.line_added',
            subjectType: 'cart',
            subjectId: (string) $cart->getKey(),
            metadata: [
                'cart_item_id' => (string) $line->getKey(),
                'catalogue_item_id' => $catalogueItemId,
                'quantity' => $total,
                'merged' => $existing instanceof CartItem,
            ],
        );

        return $line;
    }

    /**
     * Set a line to an exact quantity, reprobing at the new one.
     *
     * Reprobed rather than trusted, because a quantity is not merely a number
     * on a line the server has already agreed to: raising it can cross a tier
     * the kitchen prices in another currency, and lowering it can drop below
     * the only tier that priced the article at all. Both are refusals, and
     * both are invisible without asking again.
     *
     * @throws ApiException|LineRefused
     */
    public function setQuantity(Cart $cart, CartItem $line, string|int|float $quantity): CartItem
    {
        $this->assertShoppable($cart);
        $this->assertBelongs($cart, $line);

        $wanted = $this->validatedQuantity($quantity);

        $result = $this->probe->probe(
            $this->channelOf($cart),
            $line->catalogue_item_id,
            $line->catalogue_item_variant_id,
            $wanted,
            $line->delivery_date,
            $cart->currency_code,
            $this->buyerOf($cart),
        );

        if (! $result->isOrderable()) {
            throw new LineRefused($result->refusals);
        }

        $previous = $line->quantity;
        $line->quantity = $wanted;
        $line->save();

        $this->touchCart($cart);

        $this->audit->record(
            'cart.line_quantity_changed',
            subjectType: 'cart',
            subjectId: (string) $cart->getKey(),
            metadata: [
                'cart_item_id' => (string) $line->getKey(),
                'from_quantity' => $previous,
                'to_quantity' => $wanted,
            ],
        );

        return $line;
    }

    /**
     * @throws ApiException
     */
    public function removeItem(Cart $cart, CartItem $line): void
    {
        $this->assertShoppable($cart);
        $this->assertBelongs($cart, $line);

        $lineId = (string) $line->getKey();
        $itemId = $line->catalogue_item_id;

        $line->delete();

        $this->touchCart($cart);

        $this->audit->record(
            'cart.line_removed',
            subjectType: 'cart',
            subjectId: (string) $cart->getKey(),
            metadata: ['cart_item_id' => $lineId, 'catalogue_item_id' => $itemId],
        );
    }

    /**
     * Close a basket nobody came back to.
     *
     * The lines are **kept**, not deleted. An expired cart is the record of
     * what somebody nearly ordered, it is what "resume my basket" would
     * restore from, and it costs four columns to keep. Deleting it would also
     * make `cart_items`' `restrictOnDelete` on the catalogue pointless — the
     * one protection that stops a withdrawn article taking baskets with it.
     */
    public function expire(Cart $cart): Cart
    {
        if ($cart->status !== CartStatus::Open) {
            return $cart;
        }

        $cart->status = CartStatus::Expired;
        $cart->lock_version = $cart->lock_version + 1;
        $cart->save();

        $this->audit->record(
            'cart.expired',
            subjectType: 'cart',
            subjectId: (string) $cart->getKey(),
            metadata: ['customer_account_id' => $cart->customer_account_id],
        );

        return $cart;
    }

    /**
     * Mark the basket as having become an order.
     *
     * Called from inside `OrderPlacementService`'s transaction — deliberately
     * not by it directly, so the one place that knows what `converted` means
     * stays this one. It frees the customer's open-cart slot on the channel,
     * which is why placing an order lets them start a new basket immediately.
     */
    public function markConverted(Cart $cart, string $orderId): Cart
    {
        $cart->status = CartStatus::Converted;
        $cart->lock_version = $cart->lock_version + 1;
        $cart->save();

        $this->audit->record(
            'cart.converted',
            subjectType: 'cart',
            subjectId: (string) $cart->getKey(),
            metadata: ['order_id' => $orderId, 'line_count' => $cart->items()->count()],
        );

        return $cart;
    }

    /**
     * The customer's open basket on this channel, if there is one.
     */
    public function openCartFor(CustomerAccount $account, SalesChannel $channel): ?Cart
    {
        return Cart::query()
            ->where('customer_account_id', $account->getKey())
            ->where('sales_channel_id', $channel->getKey())
            ->where('status', CartStatus::Open)
            ->first();
    }

    /**
     * Every open basket of one seller, for the kitchen-facing surfaces.
     *
     * Explicit rather than ambient: these models carry no organisation scope
     * (they are owned by customers, who are members of nothing), so the seller
     * filter is stated in the query. A reader that forgets it gets no rows
     * from this method, because there is no method that forgets it.
     *
     * @return Builder<Cart>
     */
    public function forSeller(string $organisationId): Builder
    {
        return Cart::query()->where('organisation_id', $organisationId);
    }

    /**
     * How long an untouched basket lives. Configuration rather than a
     * constant: a kitchen running a launch weekend may want a longer window,
     * and nothing about the number is a rule.
     */
    public function ttlMinutes(): int
    {
        return (int) config('cart.expiry.ttl_minutes', 4320);
    }

    /**
     * Push the expiry out and move the validator on.
     *
     * Two things at once, and both are about the basket as a whole. A basket
     * somebody is actively filling is not stale, so expiring it under them
     * would be the sweep punishing the customers it exists to tidy up after.
     * And `lock_version` lives on the cart rather than on the line because the
     * thing a client holds and re-renders is the basket: a validator that only
     * moved when the cart's own columns changed would be a validator that
     * never moved at all, since every interesting change here is a line.
     */
    private function touchCart(Cart $cart): void
    {
        $cart->expires_at = CarbonImmutable::now()->addMinutes($this->ttlMinutes());
        $cart->lock_version = $cart->lock_version + 1;
        $cart->save();
    }

    private function lineOf(Cart $cart, string $itemId, ?string $variantId, ?CarbonImmutable $deliveryDate): ?CartItem
    {
        $query = CartItem::query()
            ->where('cart_id', $cart->getKey())
            ->where('catalogue_item_id', $itemId);

        $variantId === null
            ? $query->whereNull('catalogue_item_variant_id')
            : $query->where('catalogue_item_variant_id', $variantId);

        $deliveryDate === null
            ? $query->whereNull('delivery_date')
            : $query->whereDate('delivery_date', $deliveryDate->toDateString());

        return $query->first();
    }

    /**
     * @throws ApiException
     */
    private function channelOf(Cart $cart): SalesChannel
    {
        $channel = SalesChannel::withoutTenancy()->whereKey($cart->sales_channel_id)->first();

        if (! $channel instanceof SalesChannel) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'The sales channel this basket was opened against no longer exists.');
        }

        return $channel;
    }

    private function buyerOf(Cart $cart): CustomerAccount
    {
        $account = CustomerAccount::query()->whereKey($cart->customer_account_id)->first();

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'The customer account behind this basket could not be read.');
        }

        return $account;
    }

    /**
     * @throws ApiException
     */
    private function validatedBranchId(SalesChannel $channel, string $branchId): string
    {
        $belongs = OrganisationBranch::withoutTenancy()
            ->whereKey($branchId)
            ->where('organisation_id', $channel->organisation_id)
            ->exists();

        if (! $belongs) {
            throw $this->invalid('branch_id', 'This branch is not one of the kitchen you are ordering from.');
        }

        return $branchId;
    }

    /**
     * @throws ApiException
     */
    private function assertShoppable(Cart $cart): void
    {
        if (! $cart->isShoppable()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This basket has been checked out or has expired. Start a new one.',
                ['status' => $cart->status->value],
            );
        }
    }

    /**
     * @throws ApiException
     */
    private function assertBelongs(Cart $cart, CartItem $line): void
    {
        if ($line->cart_id !== (string) $cart->getKey()) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'This line is not in this basket.');
        }
    }

    /**
     * @throws ApiException
     */
    private function validatedQuantity(string|int|float $quantity): string
    {
        $value = is_string($quantity) ? trim($quantity) : (string) $quantity;

        if (! is_numeric($value) || (float) $value <= 0) {
            throw $this->invalid('quantity', 'A quantity is a positive number. Removing a line is its own action, not a quantity of zero.');
        }

        return $this->decimal((float) $value);
    }

    /** The scale `cart_items.quantity` is held at, applied once on the way in. */
    private function decimal(float $value): string
    {
        return number_format($value, 4, '.', '');
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
