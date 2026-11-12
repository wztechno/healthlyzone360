<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Contracts\PackPriceRegistry;
use Healthy360\Catalogues\Contracts\SellingPlaceRegistry;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackComponent;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Catalogues\Services\DishMargins;
use Healthy360\Catalogues\Services\SellingReadiness;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * A cooked item's Packs & prices tab, read and written as one statement: the
 * packs it sells, the packaging each is made of, each pack's Home shop and
 * Business price, and the three places it sells.
 *
 * ## The places
 *
 * - `home` — the kitchen's first active `b2c_web` channel;
 * - `business` — its first active `b2b` channel;
 * - `counter` — the active channel coded `desk` (the literal
 *   {@see ChannelPackPriceService::offerOnDesk()} explains).
 *
 * Home and Business are priced on their public tariff
 * ({@see PriceResolver::publicTariffFor()}); a place with no channel, or no
 * tariff, is null. The counter carries no price: it charges the Home shop's for
 * as long as the desk quotes from the same list (`follows_home`).
 *
 * ## Inherited prices (S1)
 *
 * The resolver gives a pack with no row of its own the item's pack-less price,
 * so the read reports that price as `inherited`. The write makes every price
 * explicit and closes the item's pack-less rows on both tariffs, so from then on
 * a pack with no price is not sold there.
 *
 * ## One write, one lock
 *
 * Variants, pack rows, components, prices and offers are written directly in
 * one transaction behind one compare-and-swap on the item. Not through
 * `VariantService::replace` or `ChannelAvailabilityService::replace`: each moves
 * the item's lock itself, and the second deletes every offer row. Of the
 * offers, only the item-level row of each place's channel is touched — its
 * dates, every per-pack row and every other channel's rows are left as they are.
 *
 * It also answers the catalogue's {@see SellingPlaceRegistry} port, so
 * {@see SellingReadiness} reads places and prices exactly as this tab does, and
 * its {@see PackPriceRegistry} port, so {@see DishMargins} prices each pack from
 * this same read. A write refreshes that item's Dish margins once it commits.
 */
final readonly class ItemPacksService implements PackPriceRegistry, SellingPlaceRegistry
{
    private const string DESK_CODE = 'desk';

    /** @var array<'home'|'business', SalesChannelKind> */
    private const array PRICED_PLACES = ['home' => SalesChannelKind::B2cWeb, 'business' => SalesChannelKind::B2b];

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
        private PriceResolver $resolver,
        private PriceEntryService $entries,
    ) {}

    /**
     * @return array{
     *     places: array{
     *         home: array{sales_channel_id: string, price_list_id: string, currency_code: string, offered: bool}|null,
     *         business: array{sales_channel_id: string, price_list_id: string, currency_code: string, offered: bool}|null,
     *         counter: array{sales_channel_id: string, offered: bool, follows_home: bool, price_list_name: string|null}|null,
     *     },
     *     packs: list<array{
     *         id: string, code: string, name_en: string|null, name_ar: string|null, is_default: bool,
     *         fill: array{quantity: string, unit: string},
     *         components: list<array{ingredient_id: string, quantity: string, is_container: bool}>,
     *         prices: array{home: array{amount_minor: int, inherited: bool}|null, business: array{amount_minor: int, inherited: bool}|null},
     *     }>,
     * }
     */
    public function read(CatalogueItem $item): array
    {
        $places = $this->places($item);
        $packs = $this->activePacks($item);
        $ids = array_map(static fn (CatalogueItemVariant $pack): string => (string) $pack->getKey(), $packs);

        $sizes = CatalogueItemPackVariant::sizesOf($ids);
        $components = [];

        foreach (CatalogueItemPackComponent::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $ids)
            ->orderByDesc('is_container')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get() as $component) {
            $components[$component->catalogue_item_variant_id][] = [
                'ingredient_id' => $component->ingredient_id,
                'quantity' => self::trimmed((string) $component->quantity),
                'is_container' => $component->is_container,
            ];
        }

        $standing = [];

        foreach (self::PRICED_PLACES as $place => $kind) {
            $standing[$place] = $places[$place] === null ? null : $this->standingPrices($item, $places[$place]['list']);
        }

        $out = ['places' => ['home' => null, 'business' => null, 'counter' => null], 'packs' => []];

        foreach (self::PRICED_PLACES as $place => $kind) {
            $step = $places[$place];
            $out['places'][$place] = $step === null ? null : [
                'sales_channel_id' => (string) $step['channel']->getKey(),
                'price_list_id' => (string) $step['list']->getKey(),
                'currency_code' => (string) $step['list']->currency_code,
                'offered' => $this->isOffered($item, $step['channel']),
            ];
        }

        $counter = $places['counter'];
        $out['places']['counter'] = $counter === null ? null : [
            'sales_channel_id' => (string) $counter['channel']->getKey(),
            'offered' => $this->isOffered($item, $counter['channel']),
            'follows_home' => $counter['follows_home'],
            'price_list_name' => $counter['list']?->name_en,
        ];

        foreach ($packs as $pack) {
            $id = (string) $pack->getKey();

            $out['packs'][] = [
                'id' => $id,
                'code' => $pack->code,
                'name_en' => $pack->name_en,
                'name_ar' => $pack->name_ar,
                'is_default' => $pack->is_default,
                // A pack nobody sized has no row; the wire's fill is a required object, so it reads empty.
                'fill' => isset($sizes[$id]) ? ['quantity' => $sizes[$id]['size'], 'unit' => $sizes[$id]['unit']] : ['quantity' => '', 'unit' => ''],
                'components' => $components[$id] ?? [],
                'prices' => [
                    'home' => $standing['home'] === null ? null : self::effective($standing['home'], $id),
                    'business' => $standing['business'] === null ? null : self::effective($standing['business'], $id),
                ],
            ];
        }

        return $out;
    }

    /**
     * @param  array{
     *     places: array{home: bool, business: bool, counter: bool},
     *     packs: list<array{
     *         id: string|null,
     *         fill: array{quantity: string, unit: string},
     *         components: list<array{ingredient_id: string, quantity: string, is_container: bool}>,
     *         prices: array{home: int|null, business: int|null},
     *     }>,
     * }  $statement
     *
     * @throws ApiException
     */
    public function write(CatalogueItem $item, array $statement, int $expectedLockVersion): CatalogueItem
    {
        $this->items->assertEditable($item);

        $places = $this->places($item);
        $ticked = $statement['places'];

        if ($ticked['counter'] && $places['counter'] !== null && ! $places['counter']['follows_home']) {
            $name = $places['counter']['list']?->name_en;

            throw $this->invalid('places.counter', 'The counter charges the Home shop price only while the order desk quotes from the Home shop\'s price list, and it quotes from '.($name === null ? 'no price list' : "\"{$name}\"").'. Change the desk\'s price list first.');
        }

        /** @var array<string, CatalogueItemVariant> $existing */
        $existing = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('variant_type', VariantType::Pack->value)
            ->get()
            ->keyBy(static fn (CatalogueItemVariant $variant): string => (string) $variant->getKey())
            ->all();

        /** @var array<string, string> $units code → id */
        $units = MeasurementUnit::query()->pluck('id', 'code')->map(static fn (mixed $id): string => (string) $id)->all();

        $packaging = CatalogueItemPackComponent::usablePackaging(array_values(array_merge([], ...array_map(
            static fn (array $pack): array => array_column($pack['components'], 'ingredient_id'),
            $statement['packs'],
        ))));

        $sameList = $places['home'] !== null && $places['business'] !== null
            && $places['home']['list']->getKey() === $places['business']['list']->getKey();

        $plan = [];
        $named = [];

        foreach ($statement['packs'] as $index => $pack) {
            $variant = null;

            if ($pack['id'] !== null) {
                $variant = $existing[$pack['id']] ?? null;

                if ($variant === null || isset($named[$pack['id']])) {
                    throw $this->invalid("packs.{$index}.id", 'This pack does not belong to this item, or is listed twice.');
                }

                $named[$pack['id']] = true;
            }

            $unitId = $units[$pack['fill']['unit']] ?? null;

            if ($unitId === null) {
                throw $this->invalid("packs.{$index}.fill.unit", 'This measurement unit does not exist.');
            }

            $container = null;
            $seen = [];

            foreach ($pack['components'] as $position => $component) {
                $field = "packs.{$index}.components.{$position}";
                $packagingItem = $packaging[$component['ingredient_id']] ?? null;

                if ($packagingItem === null) {
                    throw $this->invalid("{$field}.ingredient_id", 'This is not a packaging item you can use. Only active items under Packaging can make up a pack.');
                }

                if (isset($seen[$component['ingredient_id']])) {
                    throw $this->invalid("{$field}.ingredient_id", 'This packaging item is already on this pack. Change its quantity instead.');
                }

                $seen[$component['ingredient_id']] = true;

                if (! $component['is_container']) {
                    continue;
                }

                if ($container !== null) {
                    throw $this->invalid("packs.{$index}.components", 'A pack is filled into one container. Mark only one of its packaging items as the container.');
                }

                if ($packagingItem->capacity_quantity === null) {
                    throw $this->invalid("{$field}.is_container", 'This container records no capacity, so it cannot say how much one pack holds. Record its capacity on the packaging item first.');
                }

                $container = $packagingItem;
            }

            foreach (self::PRICED_PLACES as $place => $kind) {
                if ($pack['prices'][$place] !== null && $places[$place] === null) {
                    throw $this->invalid("packs.{$index}.prices.{$place}", 'This kitchen has no active '.($place === 'home' ? 'Home shop' : 'Business').' channel with a price list to price it on. Set one up under Price lists first.');
                }
            }

            if ($sameList && $pack['prices']['home'] !== null && $pack['prices']['business'] !== null && $pack['prices']['home'] !== $pack['prices']['business']) {
                throw $this->invalid("packs.{$index}.prices.business", 'Home shop and Business quote from the same price list, so one pack can only have one price on both.');
            }

            $plan[] = [
                'variant' => $variant,
                'fill' => $pack['fill'],
                'unit_id' => $unitId,
                'components' => $pack['components'],
                'prices' => $pack['prices'],
                'container' => $container === null ? null : [
                    'id' => (string) $container->getKey(),
                    'source_ref' => $container->source_ref,
                    'name_en' => $container->name_en,
                    'name_ar' => $container->name_ar,
                ],
            ];
        }

        if ($item->status === CatalogueItemStatus::Published) {
            $this->assertStillSellable($statement, $places);
        }

        DB::transaction(function () use ($item, $expectedLockVersion, $existing, $named, $plan, $places, $ticked): void {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            foreach ($existing as $id => $variant) {
                if ($variant->status === VariantStatus::Active && ! isset($named[$id])) {
                    $variant->status = VariantStatus::Archived;
                    $variant->is_default = false;
                    $variant->updated_by = $this->context->userId();
                    $variant->lock_version = $variant->lock_version + 1;
                    $variant->save();
                }
            }

            $kept = [];

            foreach ($plan as $step) {
                $variant = $step['variant'] ?? $this->createPack($item, $step['container']);

                if ($variant->status !== VariantStatus::Active) {
                    $variant->status = VariantStatus::Active;
                    $variant->updated_by = $this->context->userId();
                    $variant->lock_version = $variant->lock_version + 1;
                    $variant->save();
                }

                $this->writeFill($item, $variant, $step['fill']['quantity'], $step['unit_id']);
                $this->replaceComponents($item, $variant, $step['components']);

                foreach (self::PRICED_PLACES as $place => $kind) {
                    if ($places[$place] !== null) {
                        $this->entries->setBasePrice($places[$place]['list'], (string) $item->getKey(), (string) $variant->getKey(), $step['prices'][$place]);
                    }
                }

                $kept[] = $variant;
            }

            $this->keepOneDefault($item, $kept);

            // S1: from now on a pack's own row is its price, and a blank is "not sold here".
            $closed = [];

            foreach (self::PRICED_PLACES as $place => $kind) {
                $list = $places[$place]['list'] ?? null;

                if ($list instanceof PriceList && ! isset($closed[(string) $list->getKey()])) {
                    $this->entries->setBasePrice($list, (string) $item->getKey(), null, null);
                    $closed[(string) $list->getKey()] = true;
                }
            }

            foreach (['home', 'business', 'counter'] as $place) {
                $channel = $places[$place]['channel'] ?? null;

                if ($channel instanceof SalesChannel) {
                    $this->setOffered($item, $channel, $ticked[$place]);
                }
            }
        });

        $this->audit->record(
            'catalogue.item_packs_set',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['packs', 'places'],
                'pack_count' => count($plan),
                'places' => array_keys(array_filter($ticked)),
                'lock_version' => $item->lock_version,
            ],
        );

        $this->refreshMargins($item);

        return $item;
    }

    /**
     * @return list<array{id: string, code: string, name_en: string|null, fill: array{quantity: string, unit: string}, components: list<array{ingredient_id: string, quantity: string, is_container: bool}>, prices: array{home: array{amount_minor: int, currency_code: string, inherited: bool}|null, business: array{amount_minor: int, currency_code: string, inherited: bool}|null}}>
     */
    public function packPricesOf(CatalogueItem $item): array
    {
        $read = $this->read($item);
        $out = [];

        foreach ($read['packs'] as $pack) {
            $prices = [];

            foreach (self::PRICED_PLACES as $place => $kind) {
                $price = $pack['prices'][$place];
                $currency = $read['places'][$place]['currency_code'] ?? null;
                $prices[$place] = $price === null || $currency === null ? null : [...$price, 'currency_code' => $currency];
            }

            $out[] = [
                'id' => $pack['id'],
                'code' => $pack['code'],
                'name_en' => $pack['name_en'],
                'fill' => $pack['fill'],
                'components' => $pack['components'],
                'prices' => $prices,
            ];
        }

        return $out;
    }

    /**
     * Bring this item's Dish margins rows up to date after a committed write
     * (plan S7), so the page agrees with the tab without the nightly run.
     *
     * Resolved here rather than injected: `DishMargins` reads packs through
     * {@see PackPriceRegistry}, which is this class, so a constructor
     * dependency would be a cycle. Its own transaction is a savepoint inside
     * any outer one, so a failure rolls back only the refresh; it is reported
     * and never fails the write the owner just made.
     */
    private function refreshMargins(CatalogueItem $item): void
    {
        try {
            DB::transaction(static fn () => app(DishMargins::class)->refreshItem($item));
        } catch (Throwable $e) {
            report($e);
        }
    }

    /**
     * @return array{offered: list<'home'|'business'|'counter'>, priced: list<'home'|'business'|'counter'>}
     */
    public function placesOf(CatalogueItem $item): array
    {
        $places = $this->places($item);
        $ids = array_map(static fn (CatalogueItemVariant $pack): string => (string) $pack->getKey(), $this->activePacks($item));

        $offered = [];
        $priced = [];

        foreach (['home', 'business', 'counter'] as $place) {
            $step = $places[$place];

            if ($step === null) {
                continue;
            }

            if ($this->isOffered($item, $step['channel'])) {
                $offered[] = $place;
            }

            if (! $step['list'] instanceof PriceList) {
                continue;
            }

            $standing = $this->standingPrices($item, $step['list']);

            foreach ($ids as $id) {
                if (self::effective($standing, $id) !== null) {
                    $priced[] = $place;

                    break;
                }
            }
        }

        return ['offered' => $offered, 'priced' => $priced];
    }

    /**
     * The three places, each with the list it is priced on. The same list is
     * one instance across places, so a second price write to it carries the
     * lock version the first one moved.
     *
     * @return array{
     *     home: array{channel: SalesChannel, list: PriceList}|null,
     *     business: array{channel: SalesChannel, list: PriceList}|null,
     *     counter: array{channel: SalesChannel, list: PriceList|null, follows_home: bool}|null,
     * }
     */
    private function places(CatalogueItem $item): array
    {
        /** @var array<string, PriceList> $lists */
        $lists = [];
        $tariff = function (SalesChannel $channel) use (&$lists): ?PriceList {
            $list = $this->resolver->publicTariffFor($channel);

            return $list === null ? null : ($lists[(string) $list->getKey()] ??= $list);
        };

        $out = ['home' => null, 'business' => null, 'counter' => null];

        foreach (self::PRICED_PLACES as $place => $kind) {
            $channel = SalesChannel::withoutTenancy()
                ->where('organisation_id', $item->organisation_id)
                ->where('channel_kind', $kind->value)
                ->where('status', SalesChannelStatus::Active->value)
                ->orderBy('created_at')
                ->orderBy('id')
                ->first();
            $list = $channel === null ? null : $tariff($channel);

            if ($channel !== null && $list !== null) {
                $out[$place] = ['channel' => $channel, 'list' => $list];
            }
        }

        $desk = SalesChannel::withoutTenancy()
            ->where('organisation_id', $item->organisation_id)
            ->where('code', self::DESK_CODE)
            ->where('status', SalesChannelStatus::Active->value)
            ->first();

        if ($desk instanceof SalesChannel) {
            $list = $tariff($desk);

            $out['counter'] = [
                'channel' => $desk,
                'list' => $list,
                'follows_home' => $list !== null && $out['home'] !== null && $out['home']['list']->getKey() === $list->getKey(),
            ];
        }

        return $out;
    }

    /**
     * @return list<CatalogueItemVariant> default first, then in the order they were made
     */
    private function activePacks(CatalogueItem $item): array
    {
        return CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('variant_type', VariantType::Pack->value)
            ->where('status', VariantStatus::Active->value)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->all();
    }

    /**
     * The item's standing confirmed base prices on one list.
     *
     * @return array<string, int> pack id → amount; the pack-less row under `''`
     */
    private function standingPrices(CatalogueItem $item, PriceList $list): array
    {
        $out = [];

        foreach (PriceListItem::withoutTenancy()
            ->where('price_list_id', $list->getKey())
            ->where('catalogue_item_id', $item->getKey())
            ->whereNull('min_quantity')
            ->confirmedOpenRows()
            ->get() as $row) {
            if ($row->unit_amount_minor !== null) {
                $out[$row->catalogue_item_variant_id ?? ''] = $row->unit_amount_minor;
            }
        }

        return $out;
    }

    /**
     * The pack's own price, else the item's pack-less one — `PriceResolver::pickRow`'s order.
     *
     * @param  array<string, int>  $standing
     * @return array{amount_minor: int, inherited: bool}|null
     */
    private static function effective(array $standing, string $packId): ?array
    {
        if (isset($standing[$packId])) {
            return ['amount_minor' => $standing[$packId], 'inherited' => false];
        }

        return isset($standing['']) ? ['amount_minor' => $standing[''], 'inherited' => true] : null;
    }

    private function isOffered(CatalogueItem $item, SalesChannel $channel): bool
    {
        $today = CarbonImmutable::now()->toDateString();

        return ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('catalogue_item_id', $item->getKey())
            ->whereNull('catalogue_item_variant_id')
            ->where('is_available', true)
            ->where(static fn ($query) => $query->whereNull('available_from')->orWhere('available_from', '<=', $today))
            ->where(static fn ($query) => $query->whereNull('available_to')->orWhere('available_to', '>=', $today))
            ->exists();
    }

    /**
     * The published-listing rule (S3): a write may pause a listing, never leave
     * it offered somewhere nothing can be bought.
     *
     * @param  array{places: array{home: bool, business: bool, counter: bool}, packs: list<array{prices: array{home: int|null, business: int|null}, ...}>}  $statement
     * @param  array{home: mixed, business: mixed, counter: array{follows_home: bool, ...}|null}  $places
     *
     * @throws ApiException
     */
    private function assertStillSellable(array $statement, array $places): void
    {
        $offered = array_values(array_filter(
            SellingReadiness::PLACES,
            static fn (string $place): bool => $statement['places'][$place] && $places[$place] !== null,
        ));

        $priced = [];

        foreach (self::PRICED_PLACES as $place => $kind) {
            foreach ($statement['packs'] as $pack) {
                if ($pack['prices'][$place] !== null) {
                    $priced[] = $place;

                    break;
                }
            }
        }

        if (in_array('home', $priced, true) && ($places['counter']['follows_home'] ?? false)) {
            $priced[] = 'counter';
        }

        $fields = [];

        foreach (SellingReadiness::evaluate(true, $offered, $priced) as $reason) {
            if ($reason['code'] === 'place_unpriced') {
                $fields['places.'.$reason['context']['place']] = [$reason['detail']];
            }
        }

        if ($fields !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This listing is on sale, and this would leave it offered where no pack has a price. Price a pack for each ticked place, or untick the place.',
                ['fields' => $fields],
            );
        }
    }

    /**
     * A new pack, coded and named after its container.
     *
     * @param  array{id: string, source_ref: string|null, name_en: string, name_ar: string}|null  $container
     */
    private function createPack(CatalogueItem $item, ?array $container): CatalogueItemVariant
    {
        $ref = $container === null ? '' : mb_strtolower(trim((string) $container['source_ref']));
        $base = match (true) {
            $container === null => 'pack',
            $ref !== '' => $ref,
            default => 'pack-'.substr(str_replace('-', '', $container['id']), -8),
        };
        // Room for a `-NN` suffix inside the column's 60.
        $base = mb_substr($base, 0, 56);

        $taken = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->pluck('code')
            ->all();

        $code = $base;

        for ($suffix = 2; in_array($code, $taken, true); $suffix++) {
            $code = "{$base}-{$suffix}";
        }

        $variant = new CatalogueItemVariant;
        $variant->organisation_id = $item->organisation_id;
        $variant->catalogue_item_id = (string) $item->getKey();
        $variant->variant_type = VariantType::Pack;
        $variant->code = $code;
        $variant->name_en = $container['name_en'] ?? null;
        $variant->name_ar = $container['name_ar'] ?? null;
        // Made the default, when there is none, by keepOneDefault().
        $variant->is_default = false;
        $variant->status = VariantStatus::Active;
        $variant->created_by = $this->context->userId();
        $variant->lock_version = 0;
        $variant->save();

        return $variant;
    }

    private function writeFill(CatalogueItem $item, CatalogueItemVariant $variant, string $quantity, string $unitId): void
    {
        $pack = CatalogueItemPackVariant::withoutTenancy()->whereKey($variant->getKey())->first() ?? new CatalogueItemPackVariant;
        $pack->catalogue_item_variant_id = (string) $variant->getKey();
        $pack->organisation_id = $item->organisation_id;
        $pack->pack_quantity = $quantity;
        $pack->pack_unit_id = $unitId;

        // Only a mass unit states a net weight without a density — `ChannelPackPriceService::upsertPack`'s rule.
        $grams = match (MeasurementUnit::query()->whereKey($unitId)->value('code')) {
            'kg' => (int) round((float) $quantity * 1000),
            'g' => (int) round((float) $quantity),
            default => null,
        };
        $pack->net_weight_grams = $grams !== null && $grams > 0 ? $grams : null;
        $pack->save();
    }

    /**
     * @param  list<array{ingredient_id: string, quantity: string, is_container: bool}>  $components
     */
    private function replaceComponents(CatalogueItem $item, CatalogueItemVariant $variant, array $components): void
    {
        CatalogueItemPackComponent::withoutTenancy()->where('catalogue_item_variant_id', $variant->getKey())->delete();

        foreach ($components as $component) {
            $row = new CatalogueItemPackComponent;
            $row->organisation_id = $item->organisation_id;
            $row->catalogue_item_variant_id = (string) $variant->getKey();
            $row->ingredient_id = $component['ingredient_id'];
            $row->quantity = $component['quantity'];
            $row->is_container = $component['is_container'];
            $row->save();
        }
    }

    /**
     * The item keeps its default if it still has one; otherwise the first
     * pack of the statement takes it.
     *
     * @param  list<CatalogueItemVariant>  $kept
     */
    private function keepOneDefault(CatalogueItem $item, array $kept): void
    {
        if ($kept === []) {
            return;
        }

        $hasDefault = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('status', VariantStatus::Active->value)
            ->where('is_default', true)
            ->exists();

        if ($hasDefault) {
            return;
        }

        $first = $kept[0];
        $first->is_default = true;
        $first->save();
    }

    /**
     * Only the item-level row: on → created or switched on; off → switched
     * off, never deleted. Its date window is left as it is.
     */
    private function setOffered(CatalogueItem $item, SalesChannel $channel, bool $offered): void
    {
        $row = ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('catalogue_item_id', $item->getKey())
            ->whereNull('catalogue_item_variant_id');

        if (! $offered) {
            $row->where('is_available', true)->update(['is_available' => false, 'updated_at' => now()]);

            return;
        }

        if ($row->update(['is_available' => true, 'updated_at' => now()]) > 0) {
            return;
        }

        $new = new ChannelCatalogueItem;
        $new->organisation_id = $item->organisation_id;
        $new->sales_channel_id = (string) $channel->getKey();
        $new->catalogue_item_id = (string) $item->getKey();
        $new->catalogue_item_variant_id = null;
        $new->is_available = true;
        $new->created_by = $this->context->userId();
        $new->save();
    }

    private static function trimmed(string $decimal): string
    {
        return str_contains($decimal, '.') ? rtrim(rtrim($decimal, '0'), '.') : $decimal;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(ErrorCode::ValidationFailed, $message, ['fields' => [$field => [$message]]]);
    }
}
