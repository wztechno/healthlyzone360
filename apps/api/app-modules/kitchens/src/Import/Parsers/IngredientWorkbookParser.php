<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Parsers;

use Healthy360\Kitchens\Import\Support\SheetReader;

/**
 * The ingredient master, the fifteen cooking sauces, the fourteen salad
 * dressings, and the allergen key that ties them together.
 *
 * Only one of those four lists is new information. The 215-row master is
 * already platform reference data — `IngredientMasterSeeder` transcribed it,
 * flags and all — so it is parsed here purely so that an import can be
 * cross-checked against what was seeded, and never to write ingredients a
 * second time. The sauces and dressings are the payload: named formulations
 * with an allergen class and, unusually and valuably, the specific ingredient
 * that triggers each class.
 *
 * **Allergen markers survive intact.** `Tree nuts*` is not `Tree nuts`, and
 * `Sulphites~` is not `Sulphites`. The asterisk means coconut, which is a
 * regulated allergen in the United States and not in the EU; the tilde means
 * "possible above the labelling threshold, verify per supplier". Both are
 * market-scope and verification-status decisions that the allergen tables
 * model explicitly, and stripping the marker here would hand the caller a
 * class that looks certain and is not. The markers are therefore kept in the
 * string, and each one also raises a finding, so a mapping that ignores the
 * suffix cannot do so quietly.
 *
 * **"None" is a claim, not a gap.** The workbook's own key says "None = not a
 * regulated allergen", so a None row yields an empty class list rather than a
 * null, and raises `allergen_class_none` naming the sauce or dressing. That
 * finding is *not* raised for the ingredient master, and the asymmetry is
 * deliberate: roughly three-quarters of the 215 master rows are None, they
 * have already been reviewed once during seeding — including the recorded
 * burghul/pita contradiction — and 150 copies of the same finding would bury
 * the two dozen that concern a sellable formulation. The markers still fire
 * on master rows, because those are decisions nobody has made yet.
 *
 * **Nothing is resolved to an ingredient.** `typical_ingredients` is split
 * into strings and stopped there. Matching "cream / yogurt" to rows in the
 * ingredient library is a job with a human in it, and a parser that guessed
 * would produce a formulation the kitchen never wrote.
 *
 * @phpstan-type Finding array{code:string, detail:string, source_ref:?string}
 * @phpstan-type AllergenSource array{class:string, ingredient:string}
 * @phpstan-type MasterRow array{source_ref:string, name:string, category:?string, subcategory:?string, allergen_classes:list<string>, notes:?string}
 * @phpstan-type PreparationRow array{source_ref:string, name:string, typical_ingredients:list<string>, allergen_classes:list<string>, allergen_sources:list<AllergenSource>, notes:?string}
 */
final class IngredientWorkbookParser
{
    /**
     * The identifier prefixes the workbook gives its three lists.
     *
     * Rows are classified by their own identifier rather than by which sheet
     * they sit on. The sheet order is a fact about one export; `SC-04` is a
     * fact about the row, and a re-export that moved a sheet would otherwise
     * silently file fourteen dressings as sauces.
     */
    private const string MASTER_PREFIX = 'IG-';

    private const string SAUCE_PREFIX = 'SC-';

    private const string DRESSING_PREFIX = 'DR-';

    /**
     * The dashes the workbook uses between an allergen class and the
     * ingredient that causes it. Em dash is the export's own; the other two
     * are what a person types when the em dash is inconvenient.
     */
    private const string CLASS_SOURCE_SEPARATOR = '/\s+[—–-]\s+/u';

    /**
     * @return array{master: list<MasterRow>, sauces: list<PreparationRow>, dressings: list<PreparationRow>, allergen_key: list<array{class:string, note:string}>, findings: list<Finding>}
     */
    public static function parse(string $markdown): array
    {
        /** @var list<MasterRow> $master */
        $master = [];
        /** @var list<PreparationRow> $sauces */
        $sauces = [];
        /** @var list<PreparationRow> $dressings */
        $dressings = [];
        /** @var list<array{class:string, note:string}> $key */
        $key = [];
        /** @var list<Finding> $findings */
        $findings = [];

        foreach (SheetReader::sheets($markdown) as $sheet) {
            $isKeySheet = false;
            $headerSeen = false;

            foreach ($sheet['rows'] as $row) {
                // The merged title above each list and the merged caveat below
                // it both render as one value repeated across the width. Both
                // are decoration; neither is a row.
                if (SheetReader::isMergedBanner($row)) {
                    continue;
                }

                if (! $headerSeen) {
                    $headerSeen = true;
                    $isKeySheet = SheetReader::fold($row[0] ?? '') === 'allergen class';

                    continue;
                }

                $identifier = $row[0] ?? '';

                if ($isKeySheet) {
                    if ($identifier !== '') {
                        $key[] = ['class' => $identifier, 'note' => $row[1] ?? ''];
                    }

                    continue;
                }

                if (str_starts_with($identifier, self::MASTER_PREFIX)) {
                    $classes = self::allergenClasses($row[4] ?? '');
                    $findings = array_merge($findings, self::markerFindings($identifier, $row[1] ?? '', $classes));

                    $master[] = [
                        'source_ref' => $identifier,
                        'name' => $row[1] ?? '',
                        'category' => SheetReader::cell($row, 2),
                        'subcategory' => SheetReader::cell($row, 3),
                        'allergen_classes' => $classes,
                        'notes' => SheetReader::cell($row, 5),
                    ];

                    continue;
                }

                if (! str_starts_with($identifier, self::SAUCE_PREFIX) && ! str_starts_with($identifier, self::DRESSING_PREFIX)) {
                    continue;
                }

                $parsed = self::preparation($row);
                $findings = array_merge($findings, $parsed['findings']);

                if (str_starts_with($identifier, self::SAUCE_PREFIX)) {
                    $sauces[] = $parsed['row'];
                } else {
                    $dressings[] = $parsed['row'];
                }
            }
        }

        return [
            'master' => $master,
            'sauces' => $sauces,
            'dressings' => $dressings,
            'allergen_key' => $key,
            'findings' => $findings,
        ];
    }

    /**
     * @param  list<string>  $row
     * @return array{row: PreparationRow, findings: list<Finding>}
     */
    private static function preparation(array $row): array
    {
        $identifier = $row[0] ?? '';
        $name = $row[1] ?? '';
        $classes = self::allergenClasses($row[3] ?? '');

        /** @var list<Finding> $findings */
        $findings = self::markerFindings($identifier, $name, $classes);

        if (self::saysNone($row[3] ?? '')) {
            $findings[] = [
                'code' => 'allergen_class_none',
                'detail' => sprintf(
                    '%s "%s" is tagged "None", which this workbook uses for "not a regulated allergen" rather than "not yet assessed". It is read as carrying no allergen classes.',
                    $identifier,
                    $name,
                ),
                'source_ref' => $identifier,
            ];
        }

        return [
            'row' => [
                'source_ref' => $identifier,
                'name' => $name,
                'typical_ingredients' => self::splitOutsideBrackets($row[2] ?? '', ','),
                'allergen_classes' => $classes,
                'allergen_sources' => self::allergenSources($row[4] ?? ''),
                'notes' => SheetReader::cell($row, 5),
            ],
            'findings' => $findings,
        ];
    }

    /**
     * @return list<string>
     */
    private static function allergenClasses(string $cell): array
    {
        if (self::saysNone($cell)) {
            return [];
        }

        return array_values(array_filter(
            self::splitOutsideBrackets($cell, ','),
            static fn (string $class): bool => SheetReader::fold($class) !== 'none',
        ));
    }

    private static function saysNone(string $cell): bool
    {
        return SheetReader::fold($cell) === 'none';
    }

    /**
     * `Tree nuts — cashew; Milk — cream / yogurt` into two pairs.
     *
     * The ingredient side is kept whole. "cream / yogurt" is the workbook
     * saying either one may be the source, and splitting it into two would
     * invent a formulation containing both.
     *
     * @return list<AllergenSource>
     */
    private static function allergenSources(string $cell): array
    {
        /** @var list<AllergenSource> $sources */
        $sources = [];

        foreach (self::splitOutsideBrackets($cell, ';') as $clause) {
            if (SheetReader::fold($clause) === '' || in_array(trim($clause), ['—', '–', '-'], true)) {
                continue;
            }

            $parts = preg_split(self::CLASS_SOURCE_SEPARATOR, $clause, 2) ?: [];

            $sources[] = ['class' => trim($parts[0]), 'ingredient' => trim($parts[1] ?? '')];
        }

        return $sources;
    }

    /**
     * @param  list<string>  $classes
     * @return list<Finding>
     */
    private static function markerFindings(string $identifier, string $name, array $classes): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        foreach ($classes as $class) {
            if (str_ends_with($class, '*')) {
                $findings[] = [
                    'code' => 'allergen_marker_us_only',
                    'detail' => sprintf(
                        '%s "%s" carries the class "%s". The asterisk is the workbook\'s marker for coconut, a tree nut under US law and not an EU allergen, so the class applies in one market and not the other.',
                        $identifier,
                        $name,
                        $class,
                    ),
                    'source_ref' => $identifier,
                ];
            }

            if (str_ends_with($class, '~')) {
                $findings[] = [
                    'code' => 'allergen_marker_verify_supplier',
                    'detail' => sprintf(
                        '%s "%s" carries the class "%s". The tilde is the workbook\'s marker for "possible above the labelling threshold — verify per supplier", so the class is unconfirmed rather than established.',
                        $identifier,
                        $name,
                        $class,
                    ),
                    'source_ref' => $identifier,
                ];
            }
        }

        return $findings;
    }

    /**
     * Split on a delimiter, except where it sits inside brackets.
     *
     * SC-11 lists "shawarma spices (allspice, cinnamon, cardamom, clove)" as
     * one ingredient. A plain `explode(',')` would turn that into four, three
     * of which would be fragments of a qualifier rather than ingredients, and
     * the caller matching names against the library would go looking for
     * something called "clove)".
     *
     * @return list<string>
     */
    private static function splitOutsideBrackets(string $text, string $delimiter): array
    {
        /** @var list<string> $parts */
        $parts = [];
        $buffer = '';
        $depth = 0;

        foreach (mb_str_split($text) as $character) {
            if ($character === '(') {
                $depth++;
            } elseif ($character === ')') {
                $depth = max(0, $depth - 1);
            }

            if ($character === $delimiter && $depth === 0) {
                $parts[] = $buffer;
                $buffer = '';

                continue;
            }

            $buffer .= $character;
        }

        $parts[] = $buffer;

        return array_values(array_filter(
            array_map(trim(...), $parts),
            static fn (string $part): bool => $part !== '',
        ));
    }
}
