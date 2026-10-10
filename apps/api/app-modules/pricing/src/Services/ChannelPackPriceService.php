<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * An article's B2B and B2C offer — the weight each channel sells and the price
 * it sells it at — read and written as one pair, the way the v6 sheet states
 * them (B2B Weight, B2B Price, B2C Weight, B2C Price).
 *
 * ## Where each half lives
 *
 * - **The weight** is a pack variant coded `b2b` or `b2c`, the codes the v6
 *   importer writes. Other packs an item has are left alone: this block owns
 *   these two and nothing else.
 * - **The price** is the open, confirmed base row for that pack on the list the
 *   kitchen's B2B (or B2C web) channel quotes from to a buyer with no agreement
 *   ({@see PriceResolver::publicTariffFor()}). A negotiated agreement tariff is
 *   a different price and is never written here.
 *
 * ## Writes
 *
 * A channel left out of the request is untouched. A channel sent as `null`
 * stops being sold there: its standing price closes, and the pack stays so the
 * weight is not forgotten. A channel sent with a weight upserts its pack (an
 * archived one is revived); its `amount_minor` sets the price, or withdraws it
 * when null. Prices go through {@see PriceEntryService::setBasePrice()}, so the
 * history rules are the price list's own.
 *
 * Pricing an article on a channel that has never offered it adds an
 * item-level offer row there — pricing for B2C is the decision to sell it B2C,
 * the importer's rule — but a row a kitchen switched off stays off.
 *
 * The item's lock version moves on every write, because the packs are the
 * item's: an editor holding a stale copy of the pack list is refused rather
 * than archiving the pack this call just wrote.
 */
final readonly class ChannelPackPriceService
{
    /** @var array<string, SalesChannelKind> */
    private const array CHANNELS = ['b2b' => SalesChannelKind::B2b, 'b2c' => SalesChannelKind::B2cWeb];

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
        private PriceResolver $resolver,
        private PriceEntryService $entries,
    ) {}

    /**
     * @return array<string, array{sales_channel_id: string, price_list_id: string, currency_code: string, pack: array{size: string, unit: string}|null, amount_minor: int|null}|null>
     */
    public function read(CatalogueItem $item): array
    {
        $out = [];

        foreach (self::CHANNELS as $code => $kind) {
            $channel = $this->channelOf($item, $kind);
            $list = $channel === null ? null : $this->resolver->publicTariffFor($channel);

            if ($channel === null || ! $list instanceof PriceList) {
                $out[$code] = null;

                continue;
            }

            $variant = $this->packVariant($item, $code);
            $price = $variant === null ? null : PriceListItem::withoutTenancy()
                ->where('price_list_id', $list->getKey())
                ->where('catalogue_item_variant_id', $variant->getKey())
                ->whereNull('min_quantity')
                ->openRows()
                ->where('price_status', PriceStatus::Confirmed->value)
                ->first();

            $out[$code] = [
                'sales_channel_id' => (string) $channel->getKey(),
                'price_list_id' => (string) $list->getKey(),
                'currency_code' => (string) $list->currency_code,
                'pack' => $variant === null || $variant->status === VariantStatus::Archived
                    ? null
                    : CatalogueItemPackVariant::sizeOf((string) $variant->getKey()),
                'amount_minor' => $price?->unit_amount_minor,
            ];
        }

        return $out;
    }

    /**
     * @param  array<string, array{quantity: string, unit: string, amount_minor: int|null}|null>  $channels  only the channels being changed
     *
     * @throws ApiException
     */
    public function write(CatalogueItem $item, array $channels, int $expectedLockVersion): CatalogueItem
    {
        $this->items->assertEditable($item);

        $plan = [];

        foreach ($channels as $code => $offer) {
            $kind = self::CHANNELS[$code] ?? null;

            if ($kind === null) {
                continue;
            }

            $channel = $this->channelOf($item, $kind);
            $list = $channel === null ? null : $this->resolver->publicTariffFor($channel);

            if ($channel === null || ! $list instanceof PriceList) {
                throw $this->invalid($code, 'This kitchen has no active '.strtoupper($code).' channel with a price list to price it on. Set one up under Price lists first.');
            }

            $unitId = null;

            if ($offer !== null) {
                $unitId = MeasurementUnit::query()->where('code', $offer['unit'])->value('id');

                if (! is_string($unitId)) {
                    throw $this->invalid("{$code}.unit", 'This measurement unit does not exist.');
                }
            }

            $plan[$code] = ['channel' => $channel, 'list' => $list, 'offer' => $offer, 'unit_id' => $unitId];
        }

        DB::transaction(function () use ($item, $plan, $expectedLockVersion): void {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            foreach ($plan as $code => $step) {
                $offer = $step['offer'];

                if ($offer === null) {
                    $variant = $this->packVariant($item, $code);

                    if ($variant !== null) {
                        $this->entries->setBasePrice($step['list'], (string) $item->getKey(), (string) $variant->getKey(), null);
                    }

                    continue;
                }

                $variant = $this->upsertPack($item, $code, $offer['quantity'], (string) $step['unit_id']);
                $this->entries->setBasePrice($step['list'], (string) $item->getKey(), (string) $variant->getKey(), $offer['amount_minor']);

                if ($offer['amount_minor'] !== null) {
                    $this->offerOn($item, $step['channel']);
                }
            }
        });

        $this->audit->record(
            'catalogue.item_channel_prices_set',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => array_keys($plan),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    private function channelOf(CatalogueItem $item, SalesChannelKind $kind): ?SalesChannel
    {
        return SalesChannel::withoutTenancy()
            ->where('organisation_id', $item->organisation_id)
            ->where('channel_kind', $kind->value)
            ->where('status', SalesChannelStatus::Active->value)
            ->orderBy('created_at')
            ->orderBy('id')
            ->first();
    }

    private function packVariant(CatalogueItem $item, string $code): ?CatalogueItemVariant
    {
        return CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('code', $code)
            ->first();
    }

    private function upsertPack(CatalogueItem $item, string $code, string $quantity, string $unitId): CatalogueItemVariant
    {
        $variant = $this->packVariant($item, $code);

        if ($variant === null) {
            $hasDefault = CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->where('is_default', true)
                ->exists();

            $variant = new CatalogueItemVariant;
            $variant->organisation_id = $item->organisation_id;
            $variant->catalogue_item_id = (string) $item->getKey();
            $variant->variant_type = VariantType::Pack;
            $variant->code = $code;
            $variant->name_en = strtoupper($code).' pack';
            $variant->name_ar = strtoupper($code).' pack';
            // The consumer pack leads, as the importer orders them; otherwise the first pack does.
            $variant->is_default = ! $hasDefault;
            $variant->status = VariantStatus::Active;
            $variant->created_by = $this->context->userId();
            $variant->lock_version = 0;
            $variant->save();
        } elseif ($variant->status !== VariantStatus::Active) {
            $variant->status = VariantStatus::Active;
            $variant->updated_by = $this->context->userId();
            $variant->lock_version = $variant->lock_version + 1;
            $variant->save();
        }

        $pack = CatalogueItemPackVariant::withoutTenancy()->whereKey($variant->getKey())->first() ?? new CatalogueItemPackVariant;
        $pack->catalogue_item_variant_id = (string) $variant->getKey();
        $pack->organisation_id = $item->organisation_id;
        $pack->pack_quantity = $quantity;
        $pack->pack_unit_id = $unitId;

        // Only a mass unit states a net weight without a density.
        $grams = match (MeasurementUnit::query()->whereKey($unitId)->value('code')) {
            'kg' => (int) round((float) $quantity * 1000),
            'g' => (int) round((float) $quantity),
            default => null,
        };
        $pack->net_weight_grams = $grams !== null && $grams > 0 ? $grams : null;
        $pack->save();

        return $variant;
    }

    private function offerOn(CatalogueItem $item, SalesChannel $channel): void
    {
        $exists = ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('catalogue_item_id', $item->getKey())
            ->exists();

        if ($exists) {
            return;
        }

        $row = new ChannelCatalogueItem;
        $row->organisation_id = $item->organisation_id;
        $row->sales_channel_id = (string) $channel->getKey();
        $row->catalogue_item_id = (string) $item->getKey();
        $row->catalogue_item_variant_id = null;
        $row->is_available = true;
        $row->created_by = $this->context->userId();
        $row->save();
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(ErrorCode::ValidationFailed, $message, ['fields' => [$field => [$message]]]);
    }
}
