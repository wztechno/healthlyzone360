<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\ReferenceData\Models\Currency;
use Illuminate\Console\Command;
use Throwable;

/**
 * Carry the catalogue's B2B and B2C list prices back onto the technical sheet
 * that produces them, as `recipe_versions.b2b_price_amount` /
 * `b2c_price_amount` — the two figures the recipe editor's Costing tab reads
 * its gross margin from.
 *
 * ## Why this is its own command and not part of the recipe import
 *
 * `kitchen:import-v6-recipes` writes what the *technical sheet* says, verbatim,
 * and the sheets carry no selling price at all — their money is unit costs. The
 * prices live on the other side of the link, in the price lists the *catalogue*
 * import wrote (`healthy360-b2b-usd`, `healthy360-b2c-usd`). Folding this into
 * the recipe importer would put a figure the sheet does not state inside a
 * writer whose whole contract is that it transcribes.
 *
 * So this reads only the database, needs no confidential workbook, and can be
 * re-run whenever a tariff changes.
 *
 * ## The arithmetic, and the one place it refuses to guess
 *
 * A price list quotes a **pack**: `unit_amount_minor` against a variant whose
 * `catalogue_item_pack_variants` row states the pack's size. The recipe column
 * is a price for **one unit of the version's yield**. So:
 *
 *     per yield unit = (unit_amount_minor / 10^currency.minor_units) / pack_quantity
 *
 * The division is what makes the two channels comparable: the v6 sauces sell
 * B2B by the kilo and B2C in 300 g bottles, so the raw pack prices read $5.00
 * and $3.00 — B2C apparently cheaper — where the honest per-kilo figures are
 * $5.00 and $10.00. Storing the pack prices would have made every B2C margin
 * wrong in the same direction.
 *
 * **A pack quoted in a unit the yield is not measured in is skipped, not
 * converted.** A mass-to-piece conversion needs a piece weight this pair does
 * not state, and inventing one would produce a plausible wrong number in a
 * margin — the failure this whole surface exists to avoid.
 *
 * ## What it will not touch
 *
 * A published version is immutable (plan §4.7), so a recipe whose only version
 * is published is reported and left alone: repricing it means opening a draft,
 * which is a human act. Existing prices are left alone too unless
 * `--overwrite`, so a figure somebody typed by hand outranks the tariff.
 *
 * Every write goes through {@link RecipeVersionService::update()} rather than
 * touching the model, so each one bumps the lock version and lands in the audit
 * log the same way an operator's edit does.
 */
final class PriceRecipesFromCatalogueCommand extends Command
{
    use RunsInsideOneKitchen;

    /** The pack-variant codes `V6CatalogueWriter` writes, one per channel. */
    private const string B2B_VARIANT = 'b2b';

    private const string B2C_VARIANT = 'b2c';

    /** Scale for the intermediate division; the column stores six places. */
    private const int SCALE = 12;

    protected $signature = 'kitchen:price-recipes-from-catalogue
        {--org= : The kitchen organisation (defaults to the configured import slug)}
        {--overwrite : Replace prices that are already set; without it, only empty ones are filled}
        {--dry-run : Report what would change and write nothing}';

    protected $description = 'Copy each linked catalogue item\'s B2B/B2C list price onto its recipe version, per unit of yield.';

    public function handle(RecipeVersionService $versions): int
    {
        if ($this->refusesThisEnvironment('kitchen:price-recipes-from-catalogue')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $overwrite = (bool) $this->option('overwrite');

        $this->components->info(sprintf(
            'Price recipes from the catalogue — organisation: %s%s%s',
            $organisation->slug,
            $dryRun ? ' · dry-run' : '',
            $overwrite ? ' · overwrite' : '',
        ));

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, function (string $organisationId) use (
            $versions,
            $dryRun,
            $overwrite,
        ): int {
            $minorUnits = $this->minorUnitsByCurrency();

            $priced = [];
            $skipped = [];

            $items = CatalogueItem::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereNotNull('recipe_id')
                ->orderBy('name_en')
                ->get();

            if ($items->isEmpty()) {
                $this->components->warn('No catalogue item in this organisation names a recipe — run kitchen:import-v6-recipes first.');

                return self::SUCCESS;
            }

            foreach ($items as $item) {
                $recipe = Recipe::withoutTenancy()->find($item->recipe_id);

                if (! $recipe instanceof Recipe) {
                    continue;
                }

                $version = $this->editableVersion((string) $recipe->getKey());

                if (! $version instanceof RecipeVersion) {
                    $skipped[] = [$recipe->name_en, '—', 'no editable version (a published version is immutable; open a draft first)'];

                    continue;
                }

                if ($version->yield_unit_id === null) {
                    $skipped[] = [$recipe->name_en, 'v'.$version->version_number, 'the version states no yield unit, so "per unit of yield" has no meaning'];

                    continue;
                }

                $b2b = $this->channelPrice($item, self::B2B_VARIANT, $version, $minorUnits);
                $b2c = $this->channelPrice($item, self::B2C_VARIANT, $version, $minorUnits);

                if ($b2b === null && $b2c === null) {
                    $skipped[] = [$recipe->name_en, 'v'.$version->version_number, 'no open confirmed price on a pack quoted in the yield unit'];

                    continue;
                }

                // One currency for both amounts — the column holds one, and the
                // CHECK refuses an amount without it. Two tariffs in different
                // money is a price list, not a pair of columns.
                $currencies = array_unique(array_filter([$b2b['currency'] ?? null, $b2c['currency'] ?? null]));

                if (count($currencies) > 1) {
                    $skipped[] = [$recipe->name_en, 'v'.$version->version_number, 'B2B and B2C are quoted in different currencies ('.implode(' / ', $currencies).')'];

                    continue;
                }

                $changes = [];

                if ($b2b !== null && ($overwrite || $version->b2b_price_amount === null)) {
                    $changes['b2b_price_amount'] = $b2b['amount'];
                }

                if ($b2c !== null && ($overwrite || $version->b2c_price_amount === null)) {
                    $changes['b2c_price_amount'] = $b2c['amount'];
                }

                if ($changes === []) {
                    $skipped[] = [$recipe->name_en, 'v'.$version->version_number, 'already priced (pass --overwrite to replace)'];

                    continue;
                }

                $changes['price_currency_code'] = (string) reset($currencies);

                $priced[] = [
                    $recipe->name_en,
                    'v'.$version->version_number,
                    $this->display($changes['b2b_price_amount'] ?? $version->b2b_price_amount),
                    $this->display($changes['b2c_price_amount'] ?? $version->b2c_price_amount),
                    $changes['price_currency_code'],
                ];

                if ($dryRun) {
                    continue;
                }

                try {
                    $versions->update($version, $changes, (int) $version->lock_version);
                } catch (Throwable $error) {
                    array_pop($priced);
                    $skipped[] = [$recipe->name_en, 'v'.$version->version_number, 'refused: '.$error->getMessage()];
                }
            }

            $this->section($dryRun ? 'Would price' : 'Priced');

            if ($priced === []) {
                $this->line('  nothing to price');
            } else {
                $this->table(['Recipe', 'Version', 'B2B / yield unit', 'B2C / yield unit', 'Currency'], $priced);
            }

            if ($skipped !== []) {
                $this->section('Left alone ('.count($skipped).')');
                $this->table(['Recipe', 'Version', 'Why'], $skipped);
            }

            $this->line('');
            $this->components->info(sprintf(
                '%d recipe version(s) %s, %d left alone.',
                count($priced),
                $dryRun ? 'would be priced' : 'priced',
                count($skipped),
            ));

            return self::SUCCESS;
        });

        return $exit;
    }

    /**
     * The version a price may be written to: the highest-numbered one that is
     * still editable. A published version is deliberately not a candidate.
     */
    private function editableVersion(string $recipeId): ?RecipeVersion
    {
        return RecipeVersion::withoutTenancy()
            ->where('recipe_id', $recipeId)
            ->whereIn('status', ['draft', 'review_required'])
            ->orderByDesc('version_number')
            ->first();
    }

    /**
     * The open, confirmed price for one channel's pack, divided down to one
     * unit of the version's yield.
     *
     * `null` whenever the figure cannot be stated honestly: no such variant, no
     * open price, a placeholder or market price rather than a real one, a pack
     * with no stated size, or a pack quoted in a unit the yield is not measured
     * in.
     *
     * @param  array<string, int>  $minorUnits
     * @return array{amount: string, currency: string}|null
     */
    private function channelPrice(
        CatalogueItem $item,
        string $variantCode,
        RecipeVersion $version,
        array $minorUnits,
    ): ?array {
        $variant = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('code', $variantCode)
            ->first();

        if (! $variant instanceof CatalogueItemVariant) {
            return null;
        }

        $price = PriceListItem::withoutTenancy()
            ->where('catalogue_item_variant_id', $variant->getKey())
            ->whereNull('effective_to')
            ->where('price_status', PriceStatus::Confirmed->value)
            ->whereNotNull('unit_amount_minor')
            ->orderByDesc('effective_from')
            ->first();

        if (! $price instanceof PriceListItem) {
            return null;
        }

        $pack = CatalogueItemPackVariant::withoutTenancy()
            ->where('catalogue_item_variant_id', $variant->getKey())
            ->first();

        // A pack with no size states a price for "one of these" and this column
        // is a price per unit of yield; the two are only the same number by
        // coincidence. A unit mismatch is the same refusal for the same reason.
        if (! $pack instanceof CatalogueItemPackVariant) {
            return null;
        }

        if ($pack->pack_unit_id !== $version->yield_unit_id) {
            return null;
        }

        $quantity = (string) $pack->pack_quantity;

        if (! is_numeric($quantity) || bccomp($quantity, '0', self::SCALE) <= 0) {
            return null;
        }

        $list = PriceList::withoutTenancy()->find($price->price_list_id);

        if (! $list instanceof PriceList) {
            return null;
        }

        $currency = (string) $list->currency_code;
        $exponent = $minorUnits[$currency] ?? 2;
        $major = bcdiv((string) $price->unit_amount_minor, bcpow('10', (string) $exponent, 0), self::SCALE);

        return [
            // Six places, matching the column. The intermediate carries twelve
            // so a 300 g pack divides without the rounding landing in the fifth.
            'amount' => bcdiv($major, $quantity, 6),
            'currency' => $currency,
        ];
    }

    private function display(?string $amount): string
    {
        return $amount === null ? '—' : rtrim(rtrim($amount, '0'), '.');
    }

    /**
     * @return array<string, int>
     */
    private function minorUnitsByCurrency(): array
    {
        $out = [];

        foreach (Currency::query()->get(['code', 'minor_units']) as $currency) {
            $out[(string) $currency->code] = (int) $currency->minor_units;
        }

        return $out;
    }
}
