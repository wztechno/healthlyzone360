<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Services\ChannelPriceListService;
use Healthy360\Pricing\Services\PriceEntryService;
use Healthy360\Pricing\Services\PriceListService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Seed the owner's approximate plan prices so the plans can publish (DEC1,
 * key 2).
 *
 * The source workbook prices nothing. Its pricing sheet is a grid of
 * availability flags and a footnote saying that prices are daily and that
 * discounts depend on the number of days — so the import wrote a placeholder on
 * every plan configuration, which is the honest record of "we have not priced
 * this" and which the plan publish gate refuses. Seven plans and seventy-four
 * configurations sat behind that refusal.
 *
 * The product owner's answer was not "publish them unpriced". It was a rule:
 *
 * - a per-day base of **breakfast 6, lunch 9, dinner 9, snack 4**, summed over
 *   whatever the combination actually includes;
 * - **premium +15%**, applied to the whole per-day sum;
 * - **energy-band scaling** from −10% at the lowest band to +10% at the highest,
 *   linear between;
 * - **duration discounts** of 0 / 0 / 5 / 10 / 15 per cent for one-off, 5, 20,
 *   40 and 60 days.
 *
 * **The discount lives on the duration, not in the price.** The per-day list
 * price stays the base number for every duration; the duration assignment
 * carries the percentage. That is the owner's instruction and it is also the
 * only arrangement that survives an edit: a merchandiser who changes the
 * 60-day discount changes one column rather than re-deriving three hundred and
 * seventy prices.
 *
 * **These are approximate and they are recorded as approximate.** They land as
 * `confirmed` rows because a plan cannot publish over a placeholder and the
 * owner decided publishing now was worth more than waiting — but the price list
 * is stamped `owner-approx-2026-08`, and the intent is explicitly that the owner
 * edits them afterwards through the price-list administration. A confirmed row
 * is a number somebody stands behind; this records who, and on what basis.
 */
final class SeedApproximatePlanPricesCommand extends Command
{
    use RunsInsideOneKitchen;

    /**
     * The owner's per-day base, in whole currency units of the price list.
     */
    private const array BASE_PER_DAY = [
        'breakfast' => 6,
        'lunch' => 9,
        'dinner' => 9,
        'snack' => 4,
    ];

    private const float PREMIUM_UPLIFT = 1.15;

    /** Lowest energy band −10%, highest +10%, linear between. */
    private const float BAND_LOWEST = 0.90;

    private const float BAND_HIGHEST = 1.10;

    /** Duration code → discount percent. */
    private const array DURATION_DISCOUNTS = [
        'one-off' => 0.0,
        '5-days' => 0.0,
        '20-days' => 5.0,
        '40-days' => 10.0,
        '60-days' => 15.0,
    ];

    private const string SOURCE_REF = 'owner-approx-2026-08';

    protected $signature = 'kitchen:seed-approximate-plan-prices
        {--org= : The kitchen organisation whose plans to price (defaults to the configured one)}
        {--list= : The plan price list code (defaults to <org-prefix>-plans-usd)}
        {--channel=web-shop : The sales channel the list is assigned to}
        {--dry-run : Print the matrix and write nothing}';

    protected $description = 'Seed the owner-authorised approximate plan prices and activate the plan tariff.';

    /** @var list<array{plan: string, configuration: string, tier: string, band: string, per_day: string, minor: int, was: string}> */
    private array $matrix = [];

    public function handle(
        PriceEntryService $entries,
        PriceListService $lists,
        ChannelPriceListService $channels,
    ): int {
        // Artisan resolves a command once and reuses the instance, so the
        // matrix has to be cleared rather than assumed empty: two runs in one
        // process would otherwise print the first run's rows again beneath the
        // second's.
        $this->matrix = [];

        if ($this->refusesThisEnvironment('kitchen:seed-approximate-plan-prices')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Approximate plan prices — mode: %s · organisation: %s · environment: %s',
            $dryRun ? 'dry-run' : 'live',
            $organisation->slug,
            $this->laravel->environment(),
        ));
        $this->line('');

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, function (string $organisationId) use ($entries, $lists, $channels, $dryRun): int {
            $priceList = $this->resolvePriceList($organisationId);

            if (! $priceList instanceof PriceList) {
                return self::FAILURE;
            }

            $prepared = $this->computeEntries($organisationId, $priceList);

            if ($prepared === []) {
                $this->components->warn('This organisation has no active plan configuration to price.');

                return self::SUCCESS;
            }

            $this->renderMatrix($priceList, $dryRun);

            if ($dryRun) {
                $this->section('Would also');
                $this->line('  · set duration discounts on every plan variant duration of this organisation');
                $this->line(sprintf('  · activate the price list "%s"', $priceList->code));
                $this->line(sprintf('  · assign it to the "%s" sales channel', (string) $this->option('channel')));

                return self::SUCCESS;
            }

            try {
                $this->applyPrices($entries, $priceList, $prepared);
                $discounts = $this->applyDurationDiscounts($organisationId);
                $this->activate($lists, $channels, $priceList, $organisationId);

                $this->section('Applied');
                $this->line(sprintf('  %-32s %d', 'Confirmed price rows', count($prepared)));
                $this->line(sprintf('  %-32s %d', 'Duration discounts set', $discounts));
                $this->line(sprintf('  %-32s %s', 'Price list status', 'active'));
                $this->line(sprintf('  %-32s %s', 'Channel assignment', (string) $this->option('channel')));
            } catch (Throwable $exception) {
                $this->components->error('The price seeding failed.');
                $this->line('  '.$exception->getMessage());

                return self::FAILURE;
            }

            return self::SUCCESS;
        });

        return $exit;
    }

    /**
     * The per-configuration price set, computed from the owner's rule.
     *
     * @return list<array{catalogue_item_id: string, catalogue_item_variant_id: string, unit_amount_minor: int, price_status: string}>
     */
    private function computeEntries(string $organisationId, PriceList $priceList): array
    {
        $profiles = PlanVariantProfile::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get();

        if ($profiles->isEmpty()) {
            return [];
        }

        $items = CatalogueItem::withoutTenancy()
            ->whereIn('id', $profiles->pluck('catalogue_item_id')->unique()->all())
            ->get()
            ->keyBy(static fn (CatalogueItem $item): string => (string) $item->getKey());

        $variants = CatalogueItemVariant::withoutTenancy()
            ->whereIn('id', $profiles->pluck('catalogue_item_variant_id')->all())
            ->get()
            ->keyBy(static fn (CatalogueItemVariant $variant): string => (string) $variant->getKey());

        $combinations = MealCombinationOption::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get()
            ->keyBy(static fn (MealCombinationOption $row): string => (string) $row->getKey());

        $bands = EnergyBand::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderBy('display_order')
            ->get();

        $bandFactors = $this->bandFactors($bands);

        /** @var list<array{catalogue_item_id: string, catalogue_item_variant_id: string, unit_amount_minor: int, price_status: string}> $prepared */
        $prepared = [];

        $sorted = $profiles->sortBy([
            fn (PlanVariantProfile $p): string => (string) ($items[(string) $p->catalogue_item_id]->name_en ?? ''),
            fn (PlanVariantProfile $p): string => (string) ($combinations[(string) $p->meal_combination_option_id]->code ?? ''),
            fn (PlanVariantProfile $p): string => $p->service_tier->value,
        ]);

        foreach ($sorted as $profile) {
            $variant = $variants[(string) $profile->catalogue_item_variant_id] ?? null;
            $combination = $combinations[(string) $profile->meal_combination_option_id] ?? null;

            if ($variant === null || $combination === null) {
                continue;
            }

            // Only active configurations are priced. An inactive cell is not
            // for sale, and a price on it would be a number nobody can buy at.
            if ($variant->status->value !== 'active') {
                continue;
            }

            $perDay = $this->perDayAmount($profile, $combination);
            $tier = $profile->service_tier->value;

            if ($tier === 'premium') {
                $perDay *= self::PREMIUM_UPLIFT;
            }

            $bandCode = '(none)';

            if ($profile->energy_band_id !== null && isset($bandFactors[(string) $profile->energy_band_id])) {
                [$bandCode, $factor] = $bandFactors[(string) $profile->energy_band_id];
                $perDay *= $factor;
            }

            // Rounded to the minor unit at the end, once. Rounding each factor
            // in turn would make the premium of a scaled band differ from the
            // scaled band of a premium, and a matrix that disagrees with itself
            // by a cent is a matrix somebody has to reconcile by hand.
            $minor = (int) round($perDay * 100);

            $prepared[] = [
                'catalogue_item_id' => (string) $profile->catalogue_item_id,
                'catalogue_item_variant_id' => (string) $variant->getKey(),
                'unit_amount_minor' => $minor,
                'price_status' => PriceStatus::Confirmed->value,
            ];

            $this->matrix[] = [
                'plan' => (string) ($items[(string) $profile->catalogue_item_id]->name_en ?? '?'),
                'configuration' => $combination->code,
                'tier' => $tier,
                'band' => $bandCode,
                'per_day' => number_format($minor / 100, 2),
                'minor' => $minor,
                'was' => $this->existingState($priceList, (string) $variant->getKey()),
            ];
        }

        return $prepared;
    }

    /**
     * The per-day sum before tier and band: what the combination includes, plus
     * the snacks the configuration carries.
     */
    private function perDayAmount(PlanVariantProfile $profile, MealCombinationOption $combination): float
    {
        $amount = 0.0;

        if ($combination->includes_breakfast) {
            $amount += self::BASE_PER_DAY['breakfast'];
        }

        if ($combination->includes_lunch) {
            $amount += self::BASE_PER_DAY['lunch'];
        }

        if ($combination->includes_dinner) {
            $amount += self::BASE_PER_DAY['dinner'];
        }

        return $amount + ($profile->snacks_per_day * self::BASE_PER_DAY['snack']);
    }

    /**
     * Band identifier → [code, factor], linear from −10% at the lowest band to
     * +10% at the highest.
     *
     * A kitchen with one band gets the neutral 1.0 rather than −10%: with
     * nothing to be lower than, "lowest" is not a discount, it is the only
     * price there is.
     *
     * @param  Collection<int, EnergyBand>  $bands
     * @return array<string, array{0: string, 1: float}>
     */
    private function bandFactors(Collection $bands): array
    {
        $count = $bands->count();

        if ($count === 0) {
            return [];
        }

        $factors = [];
        $index = 0;

        foreach ($bands as $band) {
            $position = $count === 1 ? 0.5 : $index / ($count - 1);

            $factors[(string) $band->getKey()] = [
                $band->code,
                self::BAND_LOWEST + (self::BAND_HIGHEST - self::BAND_LOWEST) * $position,
            ];

            $index++;
        }

        return $factors;
    }

    /**
     * What the tariff says about this configuration today — so the matrix can
     * show the placeholder it replaces rather than only the number it writes.
     */
    private function existingState(PriceList $priceList, string $variantId): string
    {
        $row = DB::table('price_list_items')
            ->where('price_list_id', $priceList->getKey())
            ->where('catalogue_item_variant_id', $variantId)
            ->whereNull('effective_to')
            ->first();

        if ($row === null) {
            return '—';
        }

        return $row->price_status === PriceStatus::Confirmed->value
            ? number_format(((int) $row->unit_amount_minor) / 100, 2)
            : (string) $row->price_status;
    }

    /**
     * @param  list<array{catalogue_item_id: string, catalogue_item_variant_id: string, unit_amount_minor: int, price_status: string}>  $prepared
     */
    private function applyPrices(PriceEntryService $entries, PriceList $priceList, array $prepared): void
    {
        // Set-replace against the standing rows: the placeholders close with an
        // end date and a supersession pointer to the confirmed row that
        // replaced them, and nothing is deleted. That is the whole reason to go
        // through the service rather than write the table — the history of what
        // a plan was priced at is evidence, and this is the only writer that
        // keeps it.
        $entries->replace($priceList, $prepared, $priceList->lock_version);

        // Stamped per row rather than per run. `(organisation_id,
        // source_system, source_ref)` is unique, which is the table saying that
        // a provenance reference identifies one row and not a batch — so the
        // decision reference is the prefix and the configuration it priced is
        // the rest. A single shared ref would collide on the second row and,
        // worse, would make "which price did decision X set" unanswerable for
        // seventy-three of the seventy-four it set.
        foreach ($prepared as $entry) {
            DB::table('price_list_items')
                ->where('price_list_id', $priceList->getKey())
                ->where('catalogue_item_variant_id', $entry['catalogue_item_variant_id'])
                ->whereNull('effective_to')
                ->whereNull('source_ref')
                ->update([
                    'source_system' => 'dec1_owner_approximation',
                    'source_ref' => self::SOURCE_REF.'/'.$entry['catalogue_item_variant_id'],
                ]);
        }
    }

    /**
     * The duration column: 0 / 0 / 5 / 10 / 15 per cent.
     */
    private function applyDurationDiscounts(string $organisationId): int
    {
        $durations = PlanDuration::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get()
            ->keyBy(static fn (PlanDuration $row): string => (string) $row->getKey());

        $updated = 0;

        foreach (PlanVariantDuration::withoutTenancy()->where('organisation_id', $organisationId)->get() as $assignment) {
            $duration = $durations[(string) $assignment->plan_duration_id] ?? null;

            if ($duration === null || ! array_key_exists($duration->code, self::DURATION_DISCOUNTS)) {
                continue;
            }

            $discount = self::DURATION_DISCOUNTS[$duration->code];

            if ($assignment->discount_percent !== null && abs((float) $assignment->discount_percent - $discount) < 0.005) {
                continue;
            }

            PlanVariantDuration::withoutTenancy()
                ->whereKey($assignment->getKey())
                ->update(['discount_percent' => $discount, 'updated_at' => now()]);

            $updated++;
        }

        return $updated;
    }

    /**
     * Activate the tariff and point the channel at it — in that order, because
     * a channel assigned to a draft list quotes from nothing.
     */
    private function activate(
        PriceListService $lists,
        ChannelPriceListService $channels,
        PriceList $priceList,
        string $organisationId,
    ): void {
        $channelCode = (string) $this->option('channel');

        $channel = SalesChannel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('code', $channelCode)
            ->first();

        if (! $channel instanceof SalesChannel) {
            $this->components->warn(sprintf('No "%s" sales channel in this organisation; the list is left unassigned.', $channelCode));
        } else {
            $priceList->refresh();
            $channels->replace($priceList, [['sales_channel_id' => (string) $channel->getKey()]], $priceList->lock_version);
        }

        $priceList->refresh();

        if ($priceList->status === PriceListStatus::Active) {
            return;
        }

        $lists->publish($priceList, $priceList->lock_version);
    }

    private function resolvePriceList(string $organisationId): ?PriceList
    {
        $code = $this->stringOption('list');

        $query = PriceList::withoutTenancy()->where('organisation_id', $organisationId);

        $priceList = $code === null
            ? (clone $query)->where('code', 'like', '%-plans-%')->orderBy('code')->first()
            : (clone $query)->where('code', $code)->first();

        if (! $priceList instanceof PriceList) {
            $this->components->error(sprintf(
                'No plan price list found%s. Name one with --list.',
                $code === null ? ' (looked for a code matching "%-plans-%")' : ' with the code "'.$code.'"',
            ));

            return null;
        }

        return $priceList;
    }

    private function renderMatrix(PriceList $priceList, bool $dryRun): void
    {
        $this->section(sprintf('Price matrix — %s (%s)', $priceList->code, $priceList->currency_code));

        $this->table(
            ['Plan', 'Configuration', 'Tier', 'Band', 'Was', $dryRun ? 'Would be / day' : 'Per day'],
            array_map(
                static fn (array $row): array => [
                    $row['plan'],
                    $row['configuration'],
                    $row['tier'],
                    $row['band'],
                    $row['was'],
                    $row['per_day'],
                ],
                $this->matrix,
            ),
        );

        $this->section('Duration discounts');

        foreach (self::DURATION_DISCOUNTS as $code => $percent) {
            $this->line(sprintf('  %-10s %5.2f%%', $code, $percent));
        }

        $this->line('');
        $this->line('  The per-day list price is the base for every duration; the discount column above is');
        $this->line('  what the duration changes. Nothing is baked into the price row.');
    }
}
