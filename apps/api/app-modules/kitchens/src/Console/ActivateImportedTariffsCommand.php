<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Import\Runtime\KitchenWorkbookWorld;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Services\ChannelPriceListService;
use Healthy360\Pricing\Services\PriceListService;
use Illuminate\Console\Command;

/**
 * Activate the workbook importer's draft public tariffs and point the kitchen's
 * `web-shop` / `wholesale` channels at them.
 *
 * Import alone leaves `healthy360-b2c-usd` and `healthy360-b2b-usd` as drafts
 * with no channel assignment, so nothing is buyable. This command is the
 * explicit local/onboarding step that makes imported product prices resolvable
 * — including when the target organisation is already-seeded Verdant
 * (`--org=verdant-kitchen`). Plan tariffs stay with
 * `kitchen:seed-approximate-plan-prices`.
 *
 * Follow with `kitchen:publish-ready --org=…` so ready products leave draft.
 */
final class ActivateImportedTariffsCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:activate-imported-tariffs
        {--org= : The kitchen organisation (defaults to the configured import slug)}
        {--dry-run : Report what would change and write nothing}';

    protected $description = 'Activate workbook B2C/B2B draft tariffs and assign them to web-shop / wholesale.';

    /** @var list<array{code: string, channel: string}> */
    private const array PRODUCT_TARIFFS = [
        ['code' => KitchenWorkbookWorld::PRICE_LIST_B2C, 'channel' => KitchenWorkbookWorld::CHANNEL_B2C],
        ['code' => KitchenWorkbookWorld::PRICE_LIST_B2B, 'channel' => KitchenWorkbookWorld::CHANNEL_B2B],
    ];

    public function handle(PriceListService $lists, ChannelPriceListService $channels): int
    {
        if ($this->refusesThisEnvironment('kitchen:activate-imported-tariffs')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Activate imported product tariffs — organisation: %s%s',
            $organisation->slug,
            $dryRun ? ' · dry-run' : '',
        ));

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, function (string $organisationId) use (
            $lists,
            $channels,
            $dryRun,
            $organisation,
        ): int {
            $activated = 0;

            foreach (self::PRODUCT_TARIFFS as $tariff) {
                $priceList = PriceList::withoutTenancy()
                    ->where('organisation_id', $organisationId)
                    ->where('code', $tariff['code'])
                    ->first();

                if (! $priceList instanceof PriceList) {
                    $this->components->warn(sprintf('No price list "%s" — import the workbook first.', $tariff['code']));

                    continue;
                }

                $channel = SalesChannel::withoutTenancy()
                    ->where('organisation_id', $organisationId)
                    ->where('code', $tariff['channel'])
                    ->first();

                if (! $channel instanceof SalesChannel) {
                    $this->components->warn(sprintf(
                        'No "%s" sales channel; leaving "%s" unassigned.',
                        $tariff['channel'],
                        $priceList->code,
                    ));

                    continue;
                }

                $this->line(sprintf(
                    '  · %s → %s (%s)',
                    $priceList->code,
                    $tariff['channel'],
                    $priceList->status->value,
                ));

                if ($dryRun) {
                    $activated++;

                    continue;
                }

                $priceList->refresh();
                $channels->replace(
                    $priceList,
                    [['sales_channel_id' => (string) $channel->getKey()]],
                    $priceList->lock_version,
                );

                $priceList->refresh();

                if ($priceList->status !== PriceListStatus::Active) {
                    $lists->publish($priceList, $priceList->lock_version);
                }

                $activated++;
            }

            $this->line('');
            $this->components->info(sprintf(
                '%s %d product tariff(s). Next: kitchen:publish-ready --org=%s',
                $dryRun ? 'Would activate' : 'Activated',
                $activated,
                $organisation->slug,
            ));

            return $activated === 0 ? self::FAILURE : self::SUCCESS;
        });

        return $exit;
    }
}
