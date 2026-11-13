<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
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
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Services\PriceEntryService;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The `b2b` / `b2c` pack pairs the v6 importer left behind, merged into one pack
 * that carries both prices where the two are the same thing (`kitchen:merge-duplicate-packs`).
 *
 * ## Eligible
 *
 * An item that is not retired, with exactly two active packs coded `b2b` and
 * `b2c`, whose packs agree on everything but their prices:
 *
 * - **size** — the pack quantity converted within its dimension (1000 g is 1 kg),
 *   and the same piece count;
 * - **packaging** — the same components (none on both counts as the same);
 * - **per-pack offers** — the same `channel_catalogue_items` rows naming either pack;
 * - **prices** — on every list (public tariffs and agreement lists alike) and at
 *   every quantity point, at most one of the two has an open row, or both say the
 *   same thing. Every open row of the pack being archived must also be one
 *   {@see PriceEntryService::setBasePrice()} can restate: a confirmed base row,
 *   already in force, on a list that can still be edited. A tier, a placeholder,
 *   a future-dated row or a row on an archived list is reported, never hand-written;
 * - **no live reference** to the pack being archived. `LineProbe` refuses an
 *   archived pack, so anything that will be probed again must not hold it. Every
 *   table with a `catalogue_item_variant_id`, and what "live" means for it:
 *   - `cart_items` — live while the cart is `open`; `converted` and `expired`
 *     carts are history.
 *   - `quotation_lines` — live while the quotation is `draft`, `submitted` or
 *     `quoted`; `accepted`, `declined` and `expired` are decided.
 *   - `order_lines` — live while the order is `placed` or `confirmed`. Such an
 *     order is not history yet: the order desk's edit (`OrderPlacementService::amend`)
 *     re-sends every line through `LineProbe`, so an archived pack on it would
 *     make the order uneditable. `fulfilled` and `cancelled` orders are history.
 *   - `subscription_meal_choices` — live for a delivery today or later on an
 *     `active` or `paused` subscription; past days and ended subscriptions are history.
 *   - `subscriptions` — names the plan configuration, never a pack; not checked.
 *     Its captured servings carry no variant at all.
 *   - Order-desk drafts are not stored (`CounterSaleDraft` lives for one request);
 *     an open desk order is the `order_lines` case above.
 *   - `price_list_items` — what is moved; `channel_catalogue_items`,
 *     `catalogue_item_pack_variants` and `catalogue_item_pack_components` — compared
 *     above; `plan_variant_profiles` / `plan_variant_durations` — plan
 *     configurations only; `dish_margins` — a derived report, recomputed.
 *
 * The four live tables belong to Cart, B2B, Orders and Subscriptions, and
 * Kitchens may depend on none of them but B2B (Orders and Subscriptions sit
 * downstream of Kitchens), so they are read by table name rather than through
 * their models. They carry no row-level policy, so nothing is hidden from the read.
 *
 * ## Kept, moved, archived
 *
 * The item's default pack is kept; if neither is the default, `b2c`. Its code is
 * not renamed. In one transaction per item: every open row of the other pack is
 * restated on the kept pack and closed on its own, through `setBasePrice`; the
 * kept pack must then resolve, through {@see PriceResolver::currentFor()}, the
 * amount the pair resolved before on the kitchen's Home shop (`b2c_web`) and
 * Business (`b2b`) channels, or the transaction is rolled back and the pair is
 * reported; only then is the other pack archived and the merge audited.
 */
final readonly class DuplicatePacks
{
    /** @var list<string> */
    private const array PAIR = ['b2b', 'b2c'];

    public function __construct(
        private PriceResolver $resolver,
        private PriceEntryService $entries,
        private UnitConversionService $units,
        private AuditRecorder $audit,
    ) {}

    /**
     * Every pair in the organisation, eligible or not.
     *
     * @return list<array{item: CatalogueItem, keep: CatalogueItemVariant, drop: CatalogueItemVariant, reason: string|null, moves: list<array{price_list_id: string, list: string, amount_minor: int}>}>
     */
    public function scan(string $organisationId): array
    {
        $paired = CatalogueItemVariant::withoutTenancy()
            ->select('catalogue_item_id')
            ->where('organisation_id', $organisationId)
            ->where('variant_type', VariantType::Pack->value)
            ->where('status', VariantStatus::Active->value)
            ->where('code', 'b2b');

        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', '!=', CatalogueItemStatus::Retired->value)
            ->whereIn('id', $paired)
            ->orderBy('name_en')
            ->orderBy('id')
            ->get();

        $pairs = [];

        foreach ($items as $item) {
            $packs = CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->where('variant_type', VariantType::Pack->value)
                ->where('status', VariantStatus::Active->value)
                ->get()
                ->keyBy('code');

            $codes = $packs->keys()->sort()->values()->all();

            if ($codes !== self::PAIR) {
                continue;
            }

            /** @var CatalogueItemVariant $b2b */
            $b2b = $packs->get('b2b');
            /** @var CatalogueItemVariant $b2c */
            $b2c = $packs->get('b2c');

            // The default pack is kept; with no default, `b2c`.
            [$keep, $drop] = $b2b->is_default ? [$b2b, $b2c] : [$b2c, $b2b];

            [$reason, $moves] = $this->judge($item, $keep, $drop);

            $pairs[] = ['item' => $item, 'keep' => $keep, 'drop' => $drop, 'reason' => $reason, 'moves' => $moves];
        }

        return $pairs;
    }

    /**
     * Merge one eligible pair. Null when it merged (or, on a dry run, would have
     * and was rolled back); otherwise why the price check refused it.
     *
     * @param  array{item: CatalogueItem, keep: CatalogueItemVariant, drop: CatalogueItemVariant, reason: string|null, moves: list<array{price_list_id: string, list: string, amount_minor: int}>}  $pair
     */
    public function merge(string $organisationId, array $pair, bool $dryRun): ?string
    {
        $item = $pair['item'];
        $itemId = (string) $item->getKey();
        $keepId = (string) $pair['keep']->getKey();
        $dropId = (string) $pair['drop']->getKey();
        $places = $this->places($organisationId);

        DB::beginTransaction();

        try {
            $expected = [];

            foreach ($places as $label => $channel) {
                $expected[$label] = $this->expectedOn($channel, $itemId, $keepId, $dropId);
            }

            /** @var array<string, PriceList> $lists one instance per list, so a second write carries the lock the first moved */
            $lists = [];

            foreach ($pair['moves'] as $move) {
                $list = $lists[$move['price_list_id']] ??= PriceList::withoutTenancy()->whereKey($move['price_list_id'])->firstOrFail();

                $this->entries->setBasePrice($list, $itemId, $keepId, $move['amount_minor']);
                $this->entries->setBasePrice($list, $itemId, $dropId, null);
            }

            foreach ($places as $label => $channel) {
                $actual = $this->resolver->currentFor((string) $channel->getKey(), $itemId, $keepId)?->amountMinor;

                if ($actual !== $expected[$label]) {
                    DB::rollBack();

                    return sprintf(
                        'price check failed on %s: the pair resolved %s, the kept pack would resolve %s',
                        $label,
                        $expected[$label] ?? 'nothing',
                        $actual ?? 'nothing',
                    );
                }
            }

            CatalogueItemVariant::withoutTenancy()->whereKey($dropId)->update([
                'status' => VariantStatus::Archived->value,
                'is_default' => false,
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => now(),
            ]);

            // The item's packs changed: an editor holding the Packs & prices tab open is told so.
            CatalogueItem::withoutTenancy()->whereKey($itemId)->update([
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => now(),
            ]);

            // Flat, and no key containing "code", which the audit redaction drops.
            $this->audit->record(
                'catalogue.duplicate_pack_merged',
                subjectType: 'catalogue_item',
                subjectId: $itemId,
                metadata: [
                    'slug' => $item->slug,
                    'kept_pack_id' => $keepId,
                    'kept_pack' => $pair['keep']->code,
                    'archived_pack_id' => $dropId,
                    'archived_pack' => $pair['drop']->code,
                    'prices_moved' => count($pair['moves']),
                ],
            );

            $dryRun ? DB::rollBack() : DB::commit();
        } catch (Throwable $exception) {
            DB::rollBack();

            throw $exception;
        }

        return null;
    }

    /**
     * Why the pair may not merge, or null; and the prices that would move.
     *
     * @return array{0: string|null, 1: list<array{price_list_id: string, list: string, amount_minor: int}>}
     */
    private function judge(CatalogueItem $item, CatalogueItemVariant $keep, CatalogueItemVariant $drop): array
    {
        $reason = $this->sizeDiffers($keep, $drop);

        if ($reason === null && $this->components($keep) !== $this->components($drop)) {
            $reason = 'different packaging components';
        }

        if ($reason === null && $this->offers($keep) !== $this->offers($drop)) {
            $reason = 'different per-pack channel offers';
        }

        $moves = [];

        if ($reason === null) {
            [$reason, $moves] = $this->prices($item, $keep, $drop);
        }

        if ($reason === null) {
            $reason = $this->liveReferences((string) $drop->getKey());
        }

        return [$reason, $reason === null ? $moves : []];
    }

    private function sizeDiffers(CatalogueItemVariant $keep, CatalogueItemVariant $drop): ?string
    {
        $a = CatalogueItemPackVariant::withoutTenancy()->whereKey($keep->getKey())->first();
        $b = CatalogueItemPackVariant::withoutTenancy()->whereKey($drop->getKey())->first();

        if (! $a instanceof CatalogueItemPackVariant || ! $b instanceof CatalogueItemPackVariant) {
            return 'no recorded size on one or both packs';
        }

        if ($a->pack_piece_count !== $b->pack_piece_count) {
            return sprintf('different piece counts (%s and %s)', $a->pack_piece_count ?? 'none', $b->pack_piece_count ?? 'none');
        }

        $unitA = MeasurementUnit::query()->whereKey($a->pack_unit_id)->firstOrFail();
        $unitB = MeasurementUnit::query()->whereKey($b->pack_unit_id)->firstOrFail();
        /** @var numeric-string $quantityA */
        $quantityA = (string) $a->pack_quantity;
        /** @var numeric-string $quantityB */
        $quantityB = (string) $b->pack_quantity;
        $label = sprintf('%s %s and %s %s', $quantityA, $unitA->code, $quantityB, $unitB->code);

        if ($unitA->getKey() !== $unitB->getKey() && ! $this->units->canConvert($unitB, $unitA)) {
            return 'sizes in units that do not convert ('.$label.')';
        }

        $converted = $this->units->convert($quantityB, $unitB, $unitA);

        return bccomp($converted, $quantityA, 4) === 0 ? null : 'different sizes ('.$label.')';
    }

    /**
     * @return list<string>
     */
    private function components(CatalogueItemVariant $pack): array
    {
        return array_values(CatalogueItemPackComponent::withoutTenancy()
            ->where('catalogue_item_variant_id', $pack->getKey())
            ->get()
            ->map(static fn (CatalogueItemPackComponent $row): string => implode('|', [
                $row->ingredient_id,
                number_format((float) $row->quantity, 4, '.', ''),
                $row->is_container ? '1' : '0',
            ]))
            ->sort()
            ->all());
    }

    /**
     * @return list<string>
     */
    private function offers(CatalogueItemVariant $pack): array
    {
        return array_values(ChannelCatalogueItem::withoutTenancy()
            ->where('catalogue_item_variant_id', $pack->getKey())
            ->get()
            ->map(static fn (ChannelCatalogueItem $row): string => implode('|', [
                $row->sales_channel_id,
                $row->is_available ? '1' : '0',
                $row->available_from?->toDateString() ?? '',
                $row->available_to?->toDateString() ?? '',
            ]))
            ->sort()
            ->all());
    }

    /**
     * @return array{0: string|null, 1: list<array{price_list_id: string, list: string, amount_minor: int}>}
     */
    private function prices(CatalogueItem $item, CatalogueItemVariant $keep, CatalogueItemVariant $drop): array
    {
        $keepId = (string) $keep->getKey();
        $dropId = (string) $drop->getKey();
        $today = CarbonImmutable::now()->startOfDay();

        $rows = PriceListItem::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->whereIn('catalogue_item_variant_id', [$keepId, $dropId])
            ->openRows()
            ->get();

        $lists = PriceList::withoutTenancy()
            ->whereIn('id', $rows->pluck('price_list_id')->unique()->all())
            ->get()
            ->keyBy(static fn (PriceList $list): string => (string) $list->getKey());

        /** @var array<string, array<string, PriceListItem>> $byPoint list|min quantity → pack id → row */
        $byPoint = [];
        $moves = [];

        foreach ($rows as $row) {
            $byPoint[$row->price_list_id.'|'.($row->min_quantity ?? '')][(string) $row->catalogue_item_variant_id] = $row;
        }

        foreach ($byPoint as $point) {
            $kept = $point[$keepId] ?? null;
            $dropped = $point[$dropId] ?? null;

            if ($dropped === null) {
                continue;
            }

            $list = $lists->get((string) $dropped->price_list_id);
            $name = $list instanceof PriceList ? $list->code : (string) $dropped->price_list_id;

            if ($kept !== null && ($kept->price_status !== $dropped->price_status || $kept->unit_amount_minor !== $dropped->unit_amount_minor)) {
                return [sprintf(
                    'conflicting prices on %s%s (%s %s, %s %s)',
                    $name,
                    $dropped->min_quantity === null ? '' : ' from '.$dropped->min_quantity,
                    $keep->code,
                    $kept->unit_amount_minor ?? $kept->price_status->value,
                    $drop->code,
                    $dropped->unit_amount_minor ?? $dropped->price_status->value,
                ), []];
            }

            $unmovable = match (true) {
                $dropped->min_quantity !== null => 'a quantity tier from '.$dropped->min_quantity,
                $dropped->price_status !== PriceStatus::Confirmed || $dropped->unit_amount_minor === null || $dropped->unit_amount_minor <= 0 => 'a '.$dropped->price_status->value.' price',
                $dropped->effective_from->greaterThan($today) => 'a price starting '.$dropped->effective_from->toDateString(),
                ! $list instanceof PriceList || ! $list->isEditable() => 'a price on an archived list',
                default => null,
            };

            if ($unmovable !== null) {
                return [sprintf('%s has %s on %s, which needs a hand', $drop->code, $unmovable, $name), []];
            }

            $moves[] = ['price_list_id' => (string) $dropped->price_list_id, 'list' => $name, 'amount_minor' => (int) $dropped->unit_amount_minor];
        }

        return [null, $moves];
    }

    private function liveReferences(string $packId): ?string
    {
        $today = CarbonImmutable::now()->toDateString();

        $held = array_filter([
            'open cart line' => DB::table('cart_items')
                ->join('carts', 'carts.id', '=', 'cart_items.cart_id')
                ->where('cart_items.catalogue_item_variant_id', $packId)
                ->where('carts.status', 'open')
                ->count(),
            'open quotation line' => DB::table('quotation_lines')
                ->join('quotations', 'quotations.id', '=', 'quotation_lines.quotation_id')
                ->where('quotation_lines.catalogue_item_variant_id', $packId)
                ->whereIn('quotations.status', ['draft', 'submitted', 'quoted'])
                ->count(),
            'open order line' => DB::table('order_lines')
                ->join('orders', 'orders.id', '=', 'order_lines.order_id')
                ->where('order_lines.catalogue_item_variant_id', $packId)
                ->whereIn('orders.status', ['placed', 'confirmed'])
                ->count(),
            'upcoming subscription meal choice' => DB::table('subscription_meal_choices')
                ->join('subscriptions', 'subscriptions.id', '=', 'subscription_meal_choices.subscription_id')
                ->where('subscription_meal_choices.catalogue_item_variant_id', $packId)
                ->whereIn('subscriptions.status', ['active', 'paused'])
                ->where('subscription_meal_choices.delivery_date', '>=', $today)
                ->count(),
        ]);

        if ($held === []) {
            return null;
        }

        return 'held by '.implode(', ', array_map(
            static fn (string $what, int $count): string => sprintf('%d %s(s)', $count, $what),
            array_keys($held),
            $held,
        ));
    }

    /**
     * The Home shop and Business channels, as the Packs & prices tab finds them:
     * the first active channel of each kind.
     *
     * @return array<string, SalesChannel>
     */
    private function places(string $organisationId): array
    {
        $out = [];

        foreach (['Home shop' => SalesChannelKind::B2cWeb, 'Business' => SalesChannelKind::B2b] as $label => $kind) {
            $channel = SalesChannel::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('channel_kind', $kind->value)
                ->where('status', SalesChannelStatus::Active->value)
                ->orderBy('created_at')
                ->orderBy('id')
                ->first();

            if ($channel instanceof SalesChannel) {
                $out[$label] = $channel;
            }
        }

        return $out;
    }

    /**
     * What the pair charges on a channel today: the kept pack's own price, else
     * the archived pack's own price, else whatever the kept pack inherits.
     */
    private function expectedOn(SalesChannel $channel, string $itemId, string $keepId, string $dropId): ?int
    {
        $kept = $this->resolver->currentFor((string) $channel->getKey(), $itemId, $keepId);

        if ($kept !== null && $kept->catalogueItemVariantId === $keepId) {
            return $kept->amountMinor;
        }

        $dropped = $this->resolver->currentFor((string) $channel->getKey(), $itemId, $dropId);

        if ($dropped !== null && $dropped->catalogueItemVariantId === $dropId) {
            return $dropped->amountMinor;
        }

        return $kept?->amountMinor;
    }
}
