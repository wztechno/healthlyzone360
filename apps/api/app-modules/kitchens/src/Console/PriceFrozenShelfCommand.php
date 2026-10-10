<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\ChannelAvailabilityService;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Import\Runtime\KitchenWorkbookWorld;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Services\PriceEntryService;
use Illuminate\Console\Command;

/**
 * Put one kitchen's frozen shelf on sale: a retail price for every frozen
 * item, and a place on the web shop.
 *
 * ## Why the shelf needs it
 *
 * The v6 workbook carries no price for any frozen row, and the importer lists
 * an item on a channel only where a channel priced it. So the frozen products
 * arrive published but unpriced and offered nowhere, and the marketplace —
 * which shows only what an active listing channel offers at a resolvable
 * price — hides all of them. The importer is idempotent per item, so
 * re-running it never fills the gap; this does.
 *
 * ## Through the services an admin uses
 *
 * Prices go through {@see PriceEntryService::replace()} and listings through
 * {@see ChannelAvailabilityService::replace()}, the two the admin's tariff and
 * channel editors call, so the history, the validation and the audit trail are
 * the same as if a person had typed them in. Both are set-replace: the tariff's
 * standing entries and the item's other channels are restated unchanged, so
 * nothing outside the frozen shelf moves.
 *
 * Idempotent: an unchanged price is left alone by the entry service, and an
 * item already on the web shop is skipped.
 *
 * Figures come from `database/data/frozen-shelf-prices.json`, one piece each —
 * the `unit` pack the importer gives an unpriced row so a price has somewhere
 * to attach. A frozen item the file does not name is reported and left hidden.
 */
final class PriceFrozenShelfCommand extends Command
{
    use RunsInsideOneKitchen;

    private const string FROZEN_CATEGORY_CODE = 'frozen';

    protected $signature = 'kitchen:price-frozen-shelf
        {--org= : The kitchen organisation (defaults to the configured one)}
        {--dry-run : Show what would be priced and listed, and write nothing}';

    protected $description = "Price a kitchen's frozen shelf and list it on the web shop, so the marketplace shows it.";

    public function handle(PriceEntryService $entries, ChannelAvailabilityService $availability): int
    {
        if ($this->refusesThisEnvironment('kitchen:price-frozen-shelf')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if (! $organisation instanceof Organisation) {
            return self::FAILURE;
        }

        /** @var array{currency: string, items: array<string, int>} $data */
        $data = json_decode((string) file_get_contents(__DIR__.'/../../database/data/frozen-shelf-prices.json'), true, 512, JSON_THROW_ON_ERROR);
        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Price the frozen shelf — mode: %s · organisation: %s',
            $dryRun ? 'dry-run' : 'live',
            $organisation->slug,
        ));

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, function (string $organisationId) use ($data, $dryRun, $entries, $availability): int {
            $priceList = PriceList::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('code', KitchenWorkbookWorld::PRICE_LIST_B2C)
                ->first();
            $shop = SalesChannel::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('code', KitchenWorkbookWorld::CHANNEL_B2C)
                ->first();

            if (! $priceList instanceof PriceList || ! $shop instanceof SalesChannel) {
                $this->components->error(sprintf(
                    'This kitchen has no "%s" tariff or no "%s" channel to sell the shelf through.',
                    KitchenWorkbookWorld::PRICE_LIST_B2C,
                    KitchenWorkbookWorld::CHANNEL_B2C,
                ));
                $this->line('  Both come from the v6 import; run kitchen:import-v6 --publish first.');

                return self::FAILURE;
            }

            if ($priceList->currency_code !== $data['currency']) {
                $this->components->error(sprintf(
                    'The shelf is priced in %s but the %s tariff is in %s.',
                    $data['currency'],
                    $priceList->code,
                    $priceList->currency_code,
                ));

                return self::FAILURE;
            }

            $plan = $this->plan($organisationId, $data['items']);

            if ($plan === []) {
                $this->components->warn('This kitchen has no frozen items to price.');

                return self::SUCCESS;
            }

            $this->table(['Item', 'Price', 'On the web shop'], array_map(static fn (array $row): array => [
                $row['item']->name_en,
                $row['amount'] === null ? 'not in the price file — stays hidden' : sprintf('%s %.2f', $data['currency'], $row['amount'] / 100),
                $row['listed'] ? 'already' : ($row['amount'] === null ? '—' : 'to list'),
            ], $plan));

            if ($dryRun) {
                return self::SUCCESS;
            }

            $priced = array_values(array_filter($plan, static fn (array $row): bool => $row['amount'] !== null));
            $entries->replace($priceList, $this->tariffWith($priceList, $priced), $priceList->lock_version);

            $listed = 0;

            foreach ($priced as $row) {
                if ($row['listed']) {
                    continue;
                }

                $availability->replace(
                    $row['item'],
                    [...$this->channelsOf($row['item']), [
                        'sales_channel_id' => (string) $shop->getKey(),
                        'catalogue_item_variant_id' => (string) $row['variant']->getKey(),
                        'is_available' => true,
                    ]],
                    $row['item']->lock_version,
                );
                $listed++;
            }

            $this->line('');
            $this->line(sprintf('  · priced: %d on %s', count($priced), $priceList->code));
            $this->line(sprintf('  · listed: %d newly on %s', $listed, $shop->code));

            $unpriced = count($plan) - count($priced);

            if ($unpriced > 0) {
                $this->components->warn(sprintf('%d frozen item(s) have no price in the file and stay hidden.', $unpriced));
            }

            return self::SUCCESS;
        });

        return $exit;
    }

    /**
     * Every frozen item, with the pack its price attaches to.
     *
     * @param  array<string, int>  $prices
     * @return list<array{item: CatalogueItem, variant: CatalogueItemVariant, amount: int|null, listed: bool}>
     */
    private function plan(string $organisationId, array $prices): array
    {
        // By code, as the marketplace's shelf filter reads it: the platform's
        // category and any of the kitchen's own under the same code.
        $categoryIds = ProductCategory::withoutTenancy()
            ->where('code', self::FROZEN_CATEGORY_CODE)
            ->where(static fn ($owner) => $owner->whereNull('organisation_id')->orWhere('organisation_id', $organisationId))
            ->pluck('id')
            ->all();

        if ($categoryIds === []) {
            return [];
        }

        $shopId = SalesChannel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('code', KitchenWorkbookWorld::CHANNEL_B2C)
            ->value('id');

        $plan = [];

        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('product_category_id', $categoryIds)
            ->orderBy('name_en')
            ->get();

        foreach ($items as $item) {
            $variant = CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->where('status', VariantStatus::Active->value)
                ->orderByDesc('is_default')
                ->orderBy('created_at')
                ->first();

            if (! $variant instanceof CatalogueItemVariant || ! $item->isEditable()) {
                continue;
            }

            $amount = $prices[$item->slug] ?? null;

            $plan[] = [
                'item' => $item,
                'variant' => $variant,
                'amount' => is_int($amount) ? $amount : null,
                'listed' => ChannelCatalogueItem::withoutTenancy()
                    ->where('catalogue_item_id', $item->getKey())
                    ->where('sales_channel_id', $shopId)
                    ->exists(),
            ];
        }

        return $plan;
    }

    /**
     * The tariff's standing entries, restated as they are, with the frozen
     * shelf's prices set over them.
     *
     * @param  list<array{item: CatalogueItem, variant: CatalogueItemVariant, amount: int|null, listed: bool}>  $priced
     * @return list<array{catalogue_item_id: string, catalogue_item_variant_id: string|null, min_quantity: string|null, unit_amount_minor: int|null, price_status: string}>
     */
    private function tariffWith(PriceList $priceList, array $priced): array
    {
        $tariff = [];

        $standing = PriceListItem::withoutTenancy()
            ->where('price_list_id', $priceList->getKey())
            ->openRows()
            ->get();

        foreach ($standing as $row) {
            $tariff[$row->catalogue_item_id.'|'.($row->catalogue_item_variant_id ?? '').'|'.($row->min_quantity ?? '')] = [
                'catalogue_item_id' => $row->catalogue_item_id,
                'catalogue_item_variant_id' => $row->catalogue_item_variant_id,
                'min_quantity' => $row->min_quantity,
                'unit_amount_minor' => $row->unit_amount_minor,
                'price_status' => $row->price_status->value,
            ];
        }

        foreach ($priced as $row) {
            $itemId = (string) $row['item']->getKey();
            $variantId = (string) $row['variant']->getKey();

            $tariff[$itemId.'|'.$variantId.'|'] = [
                'catalogue_item_id' => $itemId,
                'catalogue_item_variant_id' => $variantId,
                'min_quantity' => null,
                'unit_amount_minor' => $row['amount'],
                'price_status' => PriceStatus::Confirmed->value,
            ];
        }

        return array_values($tariff);
    }

    /**
     * The item's channel rows as they stand, so a restatement keeps them.
     *
     * @return list<array{sales_channel_id: string, catalogue_item_variant_id: string|null, is_available: bool, available_from: string|null, available_to: string|null}>
     */
    private function channelsOf(CatalogueItem $item): array
    {
        return array_values(ChannelCatalogueItem::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->get()
            ->map(static fn (ChannelCatalogueItem $row): array => [
                'sales_channel_id' => (string) $row->sales_channel_id,
                'catalogue_item_variant_id' => $row->catalogue_item_variant_id === null ? null : (string) $row->catalogue_item_variant_id,
                'is_available' => (bool) $row->is_available,
                'available_from' => $row->available_from?->toDateString(),
                'available_to' => $row->available_to?->toDateString(),
            ])
            ->all());
    }
}
