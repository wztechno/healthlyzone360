<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Parsers;

use Healthy360\Kitchens\Import\Support\SheetReader;

/**
 * The plan catalogue: seven plans, the combinations they are sold in, the
 * calorie bands and durations that vary their price, and a matrix of which
 * combination each plan actually offers.
 *
 * The sheet named "Plan Pricing (per day)" contains no prices. It is a grid
 * of `Y` marks — availability, not money — under a footnote saying prices are
 * daily and discounts depend on the number of days. That is the single most
 * important fact in this file, and it raises `plan_prices_absent` every time,
 * because a caller that saw a sheet called Pricing and wrote nothing to the
 * pricing tables would otherwise have to work out why on its own.
 *
 * **Nine combinations from two sheets.** The setup sheet lists five options
 * (free selection, the three pairs, full day) and the matrix adds four
 * singles as columns (breakfast, lunch, dinner, snack). Neither sheet holds
 * the whole vocabulary, so `combinations` is their union, returned in one
 * canonical order rather than in either sheet's order — a union has no source
 * order to inherit, and picking one sheet's would make the result depend on
 * which happened to be read first.
 *
 * **`meals_per_day` is never zero.** The schema requires a positive count,
 * for the same reason the plan document forbids a zero-day duration: a row
 * saying the customer receives nothing is not a product. A snack-only
 * combination therefore has `meals_per_day` of 1 with all three meal flags
 * false — one item is delivered and it is not breakfast, lunch or dinner,
 * which is a description rather than a fudge. Free Selection is the one real
 * assumption here: the source never says how many meals a day it covers, 1 is
 * the smallest number that satisfies the constraint, and
 * `free_selection_meals_per_day_assumed` says so out loud rather than letting
 * a `1` look like something the workbook wrote.
 *
 * **Durations lose their zero.** "No subscription | 0" is a one-off purchase,
 * not a subscription lasting no days, so it becomes `kind: one_off` with
 * `days: null`. The other four keep their day counts.
 *
 * **Plan names keep their double spaces.** `Cleansing  Plan` is spelled with
 * two spaces in two of the three sheets that name it and with one in the
 * third. The verbatim spelling is preserved and rows are matched on the
 * whitespace-collapsed, case-folded form, with `plan_name_whitespace`
 * recording that the match needed normalising. Silently trimming would make
 * the three sheets agree in the import and disagree in the workbook.
 *
 * **The meal-to-plan map is counted and refused.** Its own sheet title calls
 * it EXAMPLE data. It comes back as a row count with `imported: false`, so an
 * operator can see something is there without the platform serving a menu
 * nobody confirmed.
 *
 * @phpstan-type Finding array{code:string, detail:string}
 * @phpstan-type Plan array{plan_id:string, name:string, plan_type:'both'|'subscription'|'limited_time', plan_type_verbatim:string, status:string, notes:?string}
 * @phpstan-type Combination array{code:string, name:string, includes_breakfast:bool, includes_lunch:bool, includes_dinner:bool, meals_per_day:int, is_free_selection:bool}
 * @phpstan-type EnergyBand array{code:string, name:string, min_kcal:int, max_kcal:int}
 * @phpstan-type Duration array{code:string, name:string, kind:'one_off'|'fixed_days', days:?int}
 * @phpstan-type VariantColumn array{column:string, combination_code:string, tier:'standard'|'premium', includes_snacks:bool, meals_per_day:int, snacks_per_day:int}
 * @phpstan-type VariantAvailability array{plan_name:string, column:string, available:bool}
 */
final class MealPlanParser
{
    /**
     * The order `combinations` comes back in. See the class docblock: a union
     * of two sheets has no order of its own, so it is given one here — free
     * selection, then the four singles, then the three pairs, then the whole
     * day. A combination the workbook grows later and this list has not heard
     * of is appended in the order it was seen rather than dropped.
     *
     * @var list<string>
     */
    private const array COMBINATION_ORDER = [
        'free-selection',
        'breakfast',
        'lunch',
        'dinner',
        'snack',
        'breakfast-lunch',
        'breakfast-dinner',
        'lunch-dinner',
        'full-day',
    ];

    /**
     * @var array<string, 'both'|'subscription'|'limited_time'>
     */
    private const array PLAN_TYPES = [
        'both' => 'both',
        'subscription' => 'subscription',
        'limited time' => 'limited_time',
    ];

    /**
     * @return array{plans: list<Plan>, combinations: list<Combination>, energy_bands: list<EnergyBand>, durations: list<Duration>, variant_columns: list<VariantColumn>, variant_matrix: list<VariantAvailability>, meal_map: array{imported:false, row_count:int, reason:string}, findings: list<Finding>}
     */
    public static function parse(string $markdown): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        /** @var list<Plan> $plans */
        $plans = [];
        /** @var list<EnergyBand> $bands */
        $bands = [];
        /** @var list<Duration> $durations */
        $durations = [];
        /** @var list<string> $optionLabels */
        $optionLabels = [];
        /** @var list<VariantColumn> $columns */
        $columns = [];
        /** @var list<array{name:string, cells:list<string>}> $matrixRows */
        $matrixRows = [];

        $mealMapRows = 0;
        $mealMapTitle = null;
        $matrixTitle = null;

        // Sheets are recognised by the header row they contain rather than by
        // their position in the file, so a re-export that inserts a sheet does
        // not silently reassign every parser to the wrong table.
        foreach (SheetReader::sheets($markdown) as $sheet) {
            $rows = $sheet['rows'];

            if (self::headerRow($rows, 'plan id') !== null) {
                $plans = self::readPlans($rows, $findings);

                continue;
            }

            if (self::headerRow($rows, 'plan name') !== null) {
                $matrixTitle = $sheet['title'];
                [$columns, $matrixRows] = self::readMatrix($rows, $findings);

                continue;
            }

            if (self::headerRow($rows, 'meals') !== null) {
                $mealMapTitle = $sheet['title'];
                $mealMapRows = self::countDataRows($rows, 'meals');

                continue;
            }

            $setup = self::readSetup($rows);
            $optionLabels = array_merge($optionLabels, $setup['options']);
            $bands = array_merge($bands, $setup['bands']);
            $durations = array_merge($durations, $setup['durations']);
        }

        $combinations = self::combinations($optionLabels, $columns, $findings);

        $findings[] = [
            'code' => 'plan_prices_absent',
            'detail' => sprintf(
                'The sheet titled "%s" holds availability flags and no amounts, so no plan price was read from this file. Its own footnotes state only that prices are daily and that discounts depend on the number of days selected.',
                $matrixTitle ?? 'Plan Pricing',
            ),
        ];

        $findings[] = [
            'code' => 'meal_map_not_imported',
            'detail' => sprintf(
                'The meal-to-plan map holds %d rows and is flagged EXAMPLE data by the source\'s own sheet title ("%s"), so the rows are counted and not imported. A menu nobody has confirmed is worse than no menu.',
                $mealMapRows,
                $mealMapTitle ?? 'Meal-to-Plan Map',
            ),
        ];

        return [
            'plans' => $plans,
            'combinations' => $combinations,
            'energy_bands' => $bands,
            'durations' => $durations,
            'variant_columns' => $columns,
            'variant_matrix' => self::matrix($plans, $columns, $matrixRows, $findings),
            'meal_map' => [
                'imported' => false,
                'row_count' => $mealMapRows,
                'reason' => 'The source sheet title flags these rows as EXAMPLE data to be validated, so they are counted rather than imported.',
            ],
            'findings' => $findings,
        ];
    }

    /**
     * @param  list<list<string>>  $rows
     * @param  list<Finding>  $findings
     * @return list<Plan>
     */
    private static function readPlans(array $rows, array &$findings): array
    {
        /** @var list<Plan> $plans */
        $plans = [];

        foreach (self::dataRows($rows, 'plan id') as $row) {
            $verbatim = $row[2] ?? '';
            $type = self::PLAN_TYPES[SheetReader::fold($verbatim)] ?? null;

            if ($type === null) {
                // `both` is the widest reading. Narrowing a plan the source
                // did not classify would quietly remove a sale channel an
                // operator may already be relying on, and the verbatim value
                // plus this finding make the guess visible and reversible.
                $findings[] = [
                    'code' => 'plan_type_unmapped',
                    'detail' => sprintf(
                        'Plan "%s" is typed "%s", which is neither Both, Subscription nor Limited Time. It is read as "both", the widest of the three, and the source wording is kept in plan_type_verbatim.',
                        $row[1] ?? '',
                        $verbatim,
                    ),
                ];
            }

            $plans[] = [
                'plan_id' => $row[0] ?? '',
                'name' => $row[1] ?? '',
                'plan_type' => $type ?? 'both',
                'plan_type_verbatim' => $verbatim,
                'status' => $row[3] ?? '',
                'notes' => SheetReader::cell($row, 4),
            ];
        }

        return $plans;
    }

    /**
     * The three blocks of the setup sheet, which the export flattened into one
     * run of rows.
     *
     * Each block is introduced by a merged banner and followed by its own
     * header row. Recognising the banner by keyword rather than by exact text
     * means a retitled block ("Calorie Bands (impact price)" becoming
     * "Calorie Bands per day") still lands in the right list.
     *
     * @param  list<list<string>>  $rows
     * @return array{options: list<string>, bands: list<EnergyBand>, durations: list<Duration>}
     */
    private static function readSetup(array $rows): array
    {
        /** @var list<string> $options */
        $options = [];
        /** @var list<EnergyBand> $bands */
        $bands = [];
        /** @var list<Duration> $durations */
        $durations = [];

        $block = null;
        $awaitingHeader = false;

        foreach ($rows as $row) {
            if (SheetReader::isMergedBanner($row)) {
                $label = SheetReader::fold($row[0] ?? '');

                $block = match (true) {
                    str_contains($label, 'meal-combination') || str_contains($label, 'meal combination') => 'options',
                    str_contains($label, 'calorie band') => 'bands',
                    str_contains($label, 'subscription duration') => 'durations',
                    default => null,
                };

                $awaitingHeader = $block !== null;

                continue;
            }

            if ($block === null || ($row[0] ?? '') === '') {
                continue;
            }

            if ($awaitingHeader) {
                $awaitingHeader = false;

                continue;
            }

            if ($block === 'options') {
                $options[] = $row[0];

                continue;
            }

            if ($block === 'bands') {
                $bands[] = [
                    'code' => self::slug($row[0]),
                    'name' => $row[0],
                    'min_kcal' => (int) ($row[1] ?? '0'),
                    'max_kcal' => (int) ($row[2] ?? '0'),
                ];

                continue;
            }

            $durations[] = self::duration($row[0], $row[1] ?? '');
        }

        return ['options' => $options, 'bands' => $bands, 'durations' => $durations];
    }

    /**
     * @return Duration
     */
    private static function duration(string $name, string $days): array
    {
        $count = (int) $days;
        $oneOff = $count <= 0 || str_contains(SheetReader::fold($name), 'no subscription');

        return [
            'code' => $oneOff ? 'one-off' : self::slug($name),
            'name' => $name,
            'kind' => $oneOff ? 'one_off' : 'fixed_days',
            'days' => $oneOff ? null : $count,
        ];
    }

    /**
     * @param  list<list<string>>  $rows
     * @param  list<Finding>  $findings
     * @return array{0: list<VariantColumn>, 1: list<array{name:string, cells:list<string>}>}
     */
    private static function readMatrix(array $rows, array &$findings): array
    {
        $headerAt = self::headerRow($rows, 'plan name');

        /** @var list<VariantColumn> $columns */
        $columns = [];
        /** @var list<array{name:string, cells:list<string>}> $planRows */
        $planRows = [];

        if ($headerAt === null) {
            return [$columns, $planRows];
        }

        foreach (array_slice($rows[$headerAt], 1) as $heading) {
            if ($heading === '') {
                continue;
            }

            $columns[] = self::variantColumn($heading, $findings);
        }

        foreach (self::dataRows($rows, 'plan name') as $row) {
            $planRows[] = ['name' => $row[0], 'cells' => array_slice($row, 1)];
        }

        return [$columns, $planRows];
    }

    /**
     * One column of the availability matrix: what it offers and at what tier.
     *
     * @param  list<Finding>  $findings
     * @return VariantColumn
     */
    private static function variantColumn(string $heading, array &$findings): array
    {
        $tier = 'standard';
        $base = $heading;

        if (preg_match('/^(.*?)\s*\(\s*(standard|premium)\s*\)\s*$/i', $heading, $matches) === 1) {
            $base = trim($matches[1]);
            $tier = strtolower($matches[2]);
        }

        /** @var 'standard'|'premium' $tier */
        $combination = self::combination($base, $findings);

        // Premium is the workbook's word for "with snacks", stated in the
        // setup sheet's Includes Snacks column. A snack-only column carries
        // one snack for the same reason it carries one meal: it is the item.
        $snacks = match (true) {
            $tier === 'premium' => 1,
            $combination['code'] === 'snack' => 1,
            default => 0,
        };

        return [
            'column' => $heading,
            'combination_code' => $combination['code'],
            'tier' => $tier,
            'includes_snacks' => $snacks > 0,
            'meals_per_day' => $combination['meals_per_day'],
            'snacks_per_day' => $snacks,
        ];
    }

    /**
     * The union of the setup sheet's options and the matrix's columns.
     *
     * @param  list<string>  $optionLabels
     * @param  list<VariantColumn>  $columns
     * @param  list<Finding>  $findings
     * @return list<Combination>
     */
    private static function combinations(array $optionLabels, array $columns, array &$findings): array
    {
        /** @var array<string, Combination> $byCode */
        $byCode = [];

        foreach ($optionLabels as $label) {
            $combination = self::combination($label, $findings);
            $byCode[$combination['code']] ??= $combination;
        }

        foreach ($columns as $column) {
            if (isset($byCode[$column['combination_code']])) {
                continue;
            }

            // The four single-meal combinations exist only as matrix columns,
            // so their name is the column heading with any tier stripped.
            $name = (string) preg_replace('/\s*\((?:standard|premium)\)\s*$/i', '', $column['column']);
            $combination = self::combination($name, $findings);
            $byCode[$combination['code']] ??= $combination;
        }

        /** @var list<Combination> $ordered */
        $ordered = [];

        foreach (self::COMBINATION_ORDER as $code) {
            if (isset($byCode[$code])) {
                $ordered[] = $byCode[$code];
                unset($byCode[$code]);
            }
        }

        return array_merge($ordered, array_values($byCode));
    }

    /**
     * Read a combination out of its label.
     *
     * `Breakfast + Lunch` is two meals; `Full Day` is three and is spelled as
     * a phrase rather than as a sum; `Free Selection` is the customer choosing
     * and states no count at all.
     *
     * @param  list<Finding>  $findings
     * @return Combination
     */
    private static function combination(string $label, array &$findings): array
    {
        $folded = SheetReader::fold($label);

        if ($folded === 'free selection') {
            $findings[] = [
                'code' => 'free_selection_meals_per_day_assumed',
                'detail' => sprintf(
                    'The combination "%s" states no number of meals per day. The schema requires a positive count, so it is recorded as 1 — the smallest value that satisfies the constraint — and this finding records that the 1 is an assumption rather than something the workbook wrote.',
                    $label,
                ),
            ];

            return self::combinationRow('free-selection', $label, false, false, false, 1, true);
        }

        if ($folded === 'full day') {
            return self::combinationRow('full-day', $label, true, true, true, 3, false);
        }

        $parts = array_values(array_filter(array_map(trim(...), explode('+', $label)), static fn (string $part): bool => $part !== ''));
        $codes = array_map(self::slug(...), $parts);

        return self::combinationRow(
            implode('-', $codes) ?: self::slug($label),
            $label,
            in_array('breakfast', $codes, true),
            in_array('lunch', $codes, true),
            in_array('dinner', $codes, true),
            max(1, count($codes)),
            false,
        );
    }

    /**
     * @return Combination
     */
    private static function combinationRow(string $code, string $name, bool $breakfast, bool $lunch, bool $dinner, int $meals, bool $freeSelection): array
    {
        return [
            'code' => $code,
            'name' => $name,
            'includes_breakfast' => $breakfast,
            'includes_lunch' => $lunch,
            'includes_dinner' => $dinner,
            'meals_per_day' => $meals,
            'is_free_selection' => $freeSelection,
        ];
    }

    /**
     * Every (plan, column) pair, with `Y` read as offered and anything else —
     * including a blank — read as not offered.
     *
     * @param  list<Plan>  $plans
     * @param  list<VariantColumn>  $columns
     * @param  list<array{name:string, cells:list<string>}>  $matrixRows
     * @param  list<Finding>  $findings
     * @return list<VariantAvailability>
     */
    private static function matrix(array $plans, array $columns, array $matrixRows, array &$findings): array
    {
        /** @var array<string, string> $canonical */
        $canonical = [];

        foreach ($plans as $plan) {
            $canonical[SheetReader::fold($plan['name'])] = $plan['name'];
        }

        /** @var list<VariantAvailability> $availability */
        $availability = [];

        foreach ($matrixRows as $row) {
            $folded = SheetReader::fold($row['name']);
            $name = $canonical[$folded] ?? null;

            if ($name === null) {
                $findings[] = [
                    'code' => 'plan_row_unmatched',
                    'detail' => sprintf(
                        'The availability matrix has a row for "%s", which matches no plan in the plan list even after collapsing whitespace and folding case. Its availability flags are kept under the name the matrix uses.',
                        $row['name'],
                    ),
                ];

                $name = $row['name'];
            } else {
                $findings = array_merge($findings, self::whitespaceFindings($row['name'], $name));
            }

            foreach ($columns as $position => $column) {
                $availability[] = [
                    'plan_name' => $name,
                    'column' => $column['column'],
                    'available' => SheetReader::fold($row['cells'][$position] ?? '') === 'y',
                ];
            }
        }

        return $availability;
    }

    /**
     * @return list<Finding>
     */
    private static function whitespaceFindings(string $matrixName, string $planName): array
    {
        if ($matrixName !== $planName) {
            return [[
                'code' => 'plan_name_whitespace',
                'detail' => sprintf(
                    'The availability matrix spells this plan "%s" while the plan list spells it "%s". They were matched on the whitespace-collapsed, case-folded form; both spellings are kept as written.',
                    $matrixName,
                    $planName,
                ),
            ]];
        }

        $collapsed = trim((string) preg_replace('/\s+/u', ' ', $planName));

        if ($collapsed === $planName) {
            return [];
        }

        return [[
            'code' => 'plan_name_whitespace',
            'detail' => sprintf(
                'Plan "%s" carries repeated whitespace inside its name (it reads as "%s" once collapsed). The verbatim spelling is kept, and rows are matched on the collapsed form.',
                $planName,
                $collapsed,
            ),
        ]];
    }

    /**
     * @param  list<list<string>>  $rows
     */
    private static function headerRow(array $rows, string $foldedFirstCell): ?int
    {
        foreach ($rows as $position => $row) {
            if (! SheetReader::isMergedBanner($row) && SheetReader::fold($row[0] ?? '') === $foldedFirstCell) {
                return $position;
            }
        }

        return null;
    }

    /**
     * @param  list<list<string>>  $rows
     * @return list<list<string>>
     */
    private static function dataRows(array $rows, string $foldedHeaderCell): array
    {
        $headerAt = self::headerRow($rows, $foldedHeaderCell);

        if ($headerAt === null) {
            return [];
        }

        /** @var list<list<string>> $data */
        $data = [];

        foreach (array_slice($rows, $headerAt + 1) as $row) {
            if (SheetReader::isMergedBanner($row) || ($row[0] ?? '') === '') {
                continue;
            }

            $data[] = $row;
        }

        return $data;
    }

    /**
     * @param  list<list<string>>  $rows
     */
    private static function countDataRows(array $rows, string $foldedHeaderCell): int
    {
        return count(self::dataRows($rows, $foldedHeaderCell));
    }

    private static function slug(string $value): string
    {
        return trim(strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', $value)), '-');
    }
}
