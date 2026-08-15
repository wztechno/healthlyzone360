<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Illuminate\Support\Collection;

/**
 * The bridge between the six sales-channel *kinds* the platform stores and the
 * eight consumer *switches* the marketplace contract publishes.
 *
 * The two vocabularies do not line up, and pretending they do would be the
 * bug. A channel kind is a route to market a kitchen owns a row for; the eight
 * switches are a flattening the prototype's `SalesChannel` union invented for a
 * filter bar. The reconciliation is stated once, here, and nowhere else:
 *
 * | stored kind   | switch it sets |
 * |---------------|----------------|
 * | `b2c_web`     | `b2c`          |
 * | `b2b`         | `b2b`          |
 * | `pos`         | `pos`          |
 * | `marketplace` | `marketplace`  |
 * | `corporate`   | `corporate`    |
 * | `insurance`   | *(none)*       |
 *
 * **Three switches are always false**, and that is a statement rather than an
 * omission. `subscription` is a property of what is *sold* (an item of type
 * `subscription_plan`), not of a route to market; `delivery` and `pickup` are
 * fulfilment methods, and the platform has no column that records either.
 * Deriving them from something adjacent — "it has a delivery zone, so it
 * delivers" — would publish an inference as a fact on the one surface where a
 * customer acts on it. A kitchen that does not appear to offer pickup is
 * accurate today: nothing in the schema says any kitchen does.
 *
 * **`insurance` sets no switch on purpose.** There is no consumer switch for
 * it, and mapping it onto `corporate` would tell a diner that a kitchen with an
 * insurer agreement takes corporate orders.
 *
 * ## Consumer channels
 *
 * `consumerKinds()` is the other half of this class and the more important one.
 * It is the set of kinds a **public, anonymous** surface may read prices and
 * availability through, and it is defined as *exactly the kinds the domain
 * already declares non-private* (`SalesChannelKind::hasPrivatePricing()`).
 * Defining it that way rather than listing kinds again is deliberate: a future
 * kind that carries negotiated pricing becomes invisible to the marketplace the
 * moment it declares itself private, without anybody having to remember this
 * file. A negotiated contract price cannot reach a consumer through a channel
 * this method will not return.
 */
final class MarketplaceChannels
{
    /**
     * The eight switches, all false. The shape a kitchen with no channels
     * serialises to, and the base every projection starts from — so the wire
     * shape never depends on which kinds happen to exist.
     *
     * @return array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool}
     */
    public static function none(): array
    {
        return [
            'b2c' => false,
            'b2b' => false,
            'marketplace' => false,
            'pos' => false,
            'subscription' => false,
            'delivery' => false,
            'pickup' => false,
            'corporate' => false,
        ];
    }

    /**
     * The kinds a public surface may price and list through.
     *
     * @return list<SalesChannelKind>
     */
    public static function consumerKinds(): array
    {
        return array_values(array_filter(
            SalesChannelKind::cases(),
            static fn (SalesChannelKind $kind): bool => ! $kind->hasPrivatePricing(),
        ));
    }

    /**
     * The kinds a *consumer plan or meal* is considered on sale through.
     *
     * Narrower than `consumerKinds()` by one: the point-of-sale desk is a
     * counter in a shop, and an item a kitchen sells over its own counter is
     * not thereby listed on a public marketplace. It stays in
     * `consumerKinds()` because its prices are not contract-private — the two
     * questions are different, and collapsing them would either leak a
     * wholesale price or hide a legitimate one.
     *
     * @return list<SalesChannelKind>
     */
    public static function listingKinds(): array
    {
        return [SalesChannelKind::B2cWeb, SalesChannelKind::Marketplace];
    }

    /**
     * @return list<string>
     */
    public static function listingKindValues(): array
    {
        return array_map(static fn (SalesChannelKind $kind): string => $kind->value, self::listingKinds());
    }

    /**
     * The organisation's active channels, whatever their kind.
     *
     * `withoutTenancy()` with an explicit organisation filter, because the
     * caller is an anonymous browser with no membership anywhere: the ambient
     * scope would either throw or be somebody else's. `sales_channels` carries
     * no row-level-security policy (K1.4 deliberately gave the catalogue tables
     * none — a channel's existence is not confidential; its *prices* are, and
     * `price_list_items` is the table that got the policy), so the explicit
     * filter is the whole boundary and is applied on every query here.
     *
     * @return Collection<int, SalesChannel>
     */
    public static function activeFor(string $organisationId): Collection
    {
        return SalesChannel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', SalesChannelStatus::Active->value)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();
    }

    /**
     * The eight switches, derived from a set of channels.
     *
     * @param  iterable<SalesChannel>  $channels
     * @return array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool}
     */
    public static function switchesFor(iterable $channels): array
    {
        $set = [];

        foreach ($channels as $channel) {
            $switch = self::switchFor($channel->channel_kind);

            if ($switch !== null) {
                $set[$switch] = true;
            }
        }

        // Rebuilt field by field rather than by mutating `none()`: the shape is
        // a closed eight-key object on the wire, and spelling it out is what
        // lets the type checker prove that every response carries all eight.
        return [
            'b2c' => isset($set['b2c']),
            'b2b' => isset($set['b2b']),
            'marketplace' => isset($set['marketplace']),
            'pos' => isset($set['pos']),
            'subscription' => isset($set['subscription']),
            'delivery' => isset($set['delivery']),
            'pickup' => isset($set['pickup']),
            'corporate' => isset($set['corporate']),
        ];
    }

    /**
     * Which switch a kind sets, or null when the contract has none for it.
     */
    private static function switchFor(SalesChannelKind $kind): ?string
    {
        return match ($kind) {
            SalesChannelKind::B2cWeb => 'b2c',
            SalesChannelKind::B2b => 'b2b',
            SalesChannelKind::Pos => 'pos',
            SalesChannelKind::Marketplace => 'marketplace',
            SalesChannelKind::Corporate => 'corporate',
            SalesChannelKind::Insurance => null,
        };
    }
}
