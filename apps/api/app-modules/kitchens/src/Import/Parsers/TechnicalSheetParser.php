<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Parsers;

use Healthy360\Kitchens\Import\Support\Numeric;
use Healthy360\Kitchens\Import\Support\SheetReader;

/**
 * The 29 technical sheets: what a preparation is made of, and what the
 * workbook claims it costs.
 *
 * Each sheet is one recipe on one page — a header block naming it, a
 * raw-material block listing its lines, a `Total:` row, and a cost block. The
 * pages were typed by hand over a long period, and this parser's job is to
 * read them **exactly as typed** and then say, out loud, everywhere the
 * typing does not agree with itself. It resolves nothing. A designation is
 * kept as written, misspelling and all, because "Cripsy Spice" is evidence of
 * how a kitchen actually labels a tub and the person reconciling it to the
 * ingredient master needs to see the tub's label, not this parser's guess at
 * what it meant.
 *
 * **Position, not header text.** Sheet 25's raw-material header has an empty
 * cell where every other sheet writes `Q.`, so keying line data on the header
 * would drop the quantity column from that one sheet and produce eight lines
 * with no amounts — a silently under-costed recipe, which is the worst
 * failure this importer has. Once the block has started, columns are read as
 * `Designation | U. | Q. | U.P. | T | Comments` by index, and the blank
 * header cell becomes a `header_incomplete` finding instead of a data loss.
 * Anything past index 5 is ignored: sheet 7 carries a seventh column of
 * legend prose ("U = Unit", and a sentence about converting everything to a
 * one-kilogram basis) that would otherwise leak into a line's comment.
 *
 * **The yield is genuinely ambiguous and is reported as such.** Three shapes
 * are unambiguous — `130 (7 kg)` is 130 pieces weighing 7 kg, `3.336` is a
 * mass because a count cannot have a fractional part, and a missing row is
 * missing. The fourth, a bare integer such as `97` or `16`, could be either,
 * and the only evidence on the page is the sheet's own cost block: a sheet
 * that goes on to quote "1 Piece Production Cost" and never mentions a
 * kilogram was almost certainly counting pieces. That inference is applied,
 * and a `yield_shape_ambiguous` finding is raised **every time** — including
 * when the cost block decides it cleanly — because the caller is writing a
 * yield into a database and deserves to know it came from an inference rather
 * than from the cell.
 *
 * **Cross-sheet findings live at the top level.** Two facts cannot be
 * attributed to one sheet: that two sheets share a designation, and that the
 * same ingredient carries wildly different unit prices on different pages.
 * Hanging either off "the last sheet parsed" would make a report's contents
 * depend on the order of the file, so `parse()` returns
 * `['sheets' => ..., 'findings' => ...]` and those two codes appear only in
 * the second list.
 *
 * Nothing here touches the database, the container or the filesystem: it
 * takes a markdown string and returns arrays, so the rules above are testable
 * against a synthetic fixture rather than against a confidential workbook.
 *
 * The numeric fields below are annotated `numeric-string` rather than
 * `string`. That is the same type in the wire sense — every one of them is
 * still a plain PHP string, exactly as the contract says — and it records the
 * guarantee the caller depends on: anything non-null here can go straight
 * into `bcadd` without being re-validated.
 *
 * @phpstan-type Finding array{code:string, detail:string}
 * @phpstan-type SheetLine array{row:int, designation:string, unit:?string, quantity:numeric-string|null, unit_price:numeric-string|null, line_total:numeric-string|null, comment:?string}
 * @phpstan-type SheetYield array{raw:?string, label:?string, shape:string, quantity:numeric-string|null, unit:?string, piece_count:?int}
 * @phpstan-type CostLabel array{label:string, amount:numeric-string|null}
 * @phpstan-type SheetTotals array{input_quantity:numeric-string|null, input_total:numeric-string|null}
 * @phpstan-type TechnicalSheet array{sheet_index:int, designation:string, kind:?string, yield:SheetYield, lines:list<SheetLine>, totals:SheetTotals, cost_labels:list<CostLabel>, waste_percent:numeric-string|null, findings:list<Finding>}
 */
final class TechnicalSheetParser
{
    /**
     * The scale bcmath works at here. Twelve places is far more than the
     * source's four, which is the point: the comparisons below decide whether
     * a difference is real, and a comparison done at the source's own
     * precision would call every rounding a discrepancy.
     */
    private const int SCALE = 12;

    /**
     * Header-block labels, folded. Only these rows are read from the block;
     * everything else above the raw-material header — the `Description`
     * banner, the two repeated confidentiality notices, the photo
     * placeholders, the `Production` and `Raw Materiel` dividers — is ignored
     * by not being on the list. Recognising the noise positively, rather than
     * matching its wording, means this parser carries no copy of the private
     * workbook's prose.
     *
     * @var list<string>
     */
    private const array HEADER_LABELS = ['designation', 'kind', 'quantity produced', 'quantity produced (yield)', 'yield'];

    /**
     * The labels that name a yield, in the two spellings the workbook uses
     * plus the bare one that sheets 28 and 29 switched to.
     *
     * @var list<string>
     */
    private const array YIELD_LABELS = ['quantity produced', 'quantity produced (yield)', 'yield'];

    /**
     * `130 (7 kg)`: a piece count with the batch mass in brackets. The only
     * yield spelling in the workbook that answers both questions at once.
     */
    private const string PIECES_AND_MASS = '/^\s*(\d+)\s*\(\s*([\d.,]+)\s*(kg|Kg|KG)\s*\)\s*$/';

    /**
     * Units the workbook is entitled to write without comment. Everything
     * else — `Kg`, `k`, `kg.` — is a spelling of one of these and is reported
     * so that whoever maps units to the reference table sees the variants
     * rather than discovering them later as unmapped rows.
     *
     * @var list<string>
     */
    private const array CANONICAL_UNITS = ['kg', 'Piece', 'L'];

    /**
     * Units that measure something continuous. Used only by the
     * `unit_implausible` check, which asks whether a line counted in pieces
     * is the same thing another line weighed.
     *
     * @var list<string>
     */
    private const array MEASURED_UNITS = ['kg', 'k', 'g', 'gr', 'l', 'lt', 'ltr', 'litre', 'liter'];

    /**
     * @var list<string>
     */
    private const array PIECE_UNITS = ['piece', 'pieces', 'pc', 'pcs'];

    /**
     * Every sheet in file order, plus the findings that belong to no single
     * sheet.
     *
     * @return array{sheets: list<TechnicalSheet>, findings: list<Finding>}
     */
    public static function parse(string $markdown): array
    {
        /** @var list<TechnicalSheet> $sheets */
        $sheets = [];

        foreach (SheetReader::sheets($markdown) as $sheet) {
            $sheets[] = self::parseSheet($sheet['index'], $sheet['rows']);
        }

        // Deferred to a second pass because the question it answers — "is this
        // designation weighed anywhere else in the file?" — cannot be answered
        // while the file is still being read.
        $sheets = self::withImplausibleUnitFindings($sheets);

        return [
            'sheets' => $sheets,
            'findings' => array_merge(self::duplicateDesignations($sheets), self::unitPriceOutliers($sheets)),
        ];
    }

    /**
     * @param  list<list<string>>  $rows
     * @return TechnicalSheet
     */
    private static function parseSheet(int $index, array $rows): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        $rawHeaderAt = self::locateRawHeader($rows);
        $header = self::readHeaderBlock(array_slice($rows, 0, $rawHeaderAt ?? count($rows)));

        if ($rawHeaderAt === null) {
            $findings[] = [
                'code' => 'raw_material_block_missing',
                'detail' => sprintf(
                    'Sheet %d has no raw-material header row (a "Designation" row whose second cell heads the unit column), so no lines were read from it.',
                    $index,
                ),
            ];

            $body = ['lines' => [], 'totals' => ['input_quantity' => null, 'input_total' => null], 'cost_labels' => [], 'findings' => []];
        } else {
            $findings = array_merge($findings, self::headerCompleteness($index, $rows[$rawHeaderAt]));
            $body = self::readBody($index, array_slice($rows, $rawHeaderAt + 1));
            $findings = array_merge($findings, $body['findings']);
        }

        /** @var list<SheetLine> $lines */
        $lines = $body['lines'];
        /** @var list<CostLabel> $costLabels */
        $costLabels = $body['cost_labels'];
        /** @var SheetTotals $totals */
        $totals = $body['totals'];

        $yield = self::readYield($index, $header, $costLabels, $findings);

        $findings = array_merge(
            $findings,
            self::auditLines($index, $lines),
            self::auditTotals($index, $lines, $totals),
            self::auditBasisLabels($index, $costLabels, $yield),
        );

        return [
            'sheet_index' => $index,
            'designation' => $header['designation']['value'] ?? '',
            'kind' => $header['kind']['value'] ?? null,
            'yield' => $yield,
            'lines' => $lines,
            'totals' => $totals,
            'cost_labels' => $costLabels,
            'waste_percent' => self::wastePercent($costLabels),
            'findings' => $findings,
        ];
    }

    /**
     * Where the raw-material block starts.
     *
     * The workbook's own convention is "a `Designation` row whose second cell
     * heads the unit column", and that is what is matched. It is tried twice,
     * strictest first: a second cell that *is* the unit heading (`U.` or `U`),
     * then the looser "starts with U" the brief describes. The second pass
     * skips the sheet's first `Designation` row, which is the title row and
     * would otherwise be mistaken for the block header the day somebody names
     * a preparation "Umami Sauce".
     *
     * @param  list<list<string>>  $rows
     */
    private static function locateRawHeader(array $rows): ?int
    {
        $designationRows = [];

        foreach ($rows as $position => $row) {
            if (($row[0] ?? '') !== 'Designation') {
                continue;
            }

            $designationRows[] = $position;

            if (preg_match('/^U\.?$/i', $row[1] ?? '') === 1) {
                return $position;
            }
        }

        foreach ($designationRows as $rank => $position) {
            if ($rank === 0) {
                continue;
            }

            if (str_starts_with($rows[$position][1] ?? '', 'U')) {
                return $position;
            }
        }

        return null;
    }

    /**
     * The named values above the raw-material block.
     *
     * @param  list<list<string>>  $rows
     * @return array<string, array{label:string, value:string}>
     */
    private static function readHeaderBlock(array $rows): array
    {
        $header = [];

        foreach ($rows as $row) {
            $label = $row[0] ?? '';
            $key = SheetReader::fold($label);

            if (! in_array($key, self::HEADER_LABELS, true)) {
                continue;
            }

            // First writing wins. A repeated label would mean the sheet
            // states the same fact twice, and taking the later one would
            // silently prefer whichever the export happened to put last.
            $header[$key] ??= ['label' => $label, 'value' => $row[1] ?? ''];
        }

        return $header;
    }

    /**
     * A blank in one of the four columns a line is read from.
     *
     * @param  list<string>  $headerRow
     * @return list<Finding>
     */
    private static function headerCompleteness(int $index, array $headerRow): array
    {
        $names = [1 => 'unit', 2 => 'quantity', 3 => 'unit price', 4 => 'line total'];
        $blank = [];

        foreach ($names as $position => $name) {
            if (($headerRow[$position] ?? '') === '') {
                $blank[] = sprintf('column %d (%s)', $position + 1, $name);
            }
        }

        if ($blank === []) {
            return [];
        }

        return [[
            'code' => 'header_incomplete',
            'detail' => sprintf(
                'Sheet %d\'s raw-material header has no text in %s. Line data on this sheet is read by column position rather than by header text, so the column is still read.',
                $index,
                implode(' and ', $blank),
            ),
        ]];
    }

    /**
     * The lines, the `Total:` row and the cost block, read by position.
     *
     * @param  list<list<string>>  $rows
     * @return array{lines: list<SheetLine>, totals: SheetTotals, cost_labels: list<CostLabel>, findings: list<Finding>}
     */
    private static function readBody(int $index, array $rows): array
    {
        /** @var list<SheetLine> $lines */
        $lines = [];
        /** @var list<CostLabel> $costLabels */
        $costLabels = [];
        /** @var list<Finding> $findings */
        $findings = [];
        $totals = ['input_quantity' => null, 'input_total' => null];

        $stage = 'lines';
        $bannerSeen = false;

        foreach ($rows as $row) {
            $first = $row[0] ?? '';

            // Banners are the export's rendering of a merged divider. Skipping
            // them by shape rather than by wording means a sheet that lost its
            // `Total:` row still stops reading lines at the cost block instead
            // of turning "Total Production Cost" into an ingredient.
            if (SheetReader::isMergedBanner($row)) {
                if (SheetReader::fold($first) === 'cost') {
                    $bannerSeen = true;
                    $stage = 'cost';
                }

                continue;
            }

            if ($stage === 'lines') {
                if (str_starts_with(SheetReader::fold($first), 'total:')) {
                    $totals = [
                        'input_quantity' => Numeric::parse($row[2] ?? null),
                        'input_total' => Numeric::parse($row[4] ?? null),
                    ];

                    $findings = array_merge($findings, self::scientificFindings($index, 'the Total row', [
                        'quantity' => $row[2] ?? null,
                        'total' => $row[4] ?? null,
                    ]));

                    // The `Total:` row ends the lines, and everything after it
                    // up to the chef's signature is the cost block. The `Cost`
                    // banner is skipped when present rather than required: one
                    // sheet in the workbook does not have one, and a reader
                    // that waited for it would return an empty cost block and
                    // no waste coefficient for that page.
                    $stage = 'cost';

                    continue;
                }

                if ($first === '') {
                    continue;
                }

                $number = count($lines) + 1;

                $lines[] = [
                    'row' => $number,
                    'designation' => $first,
                    'unit' => SheetReader::cell($row, 1),
                    'quantity' => Numeric::parse($row[2] ?? null),
                    'unit_price' => Numeric::parse($row[3] ?? null),
                    'line_total' => Numeric::parse($row[4] ?? null),
                    'comment' => SheetReader::cell($row, 5),
                ];

                $findings = array_merge($findings, self::scientificFindings($index, sprintf('row %d "%s"', $number, $first), [
                    'quantity' => $row[2] ?? null,
                    'unit price' => $row[3] ?? null,
                    'line total' => $row[4] ?? null,
                ]));

                continue;
            }

            if (str_starts_with(SheetReader::fold($first), 'chef signature')) {
                break;
            }

            if ($first === '') {
                continue;
            }

            $costLabels[] = ['label' => $first, 'amount' => Numeric::parse($row[1] ?? null)];
        }

        if ($costLabels !== [] && ! $bannerSeen) {
            $findings[] = [
                'code' => 'cost_block_banner_absent',
                'detail' => sprintf(
                    'Sheet %d runs its cost rows straight on from the Total row with no "Cost" divider, unlike the rest of the workbook. The block was read anyway, from the Total row to the signature line; the structural difference is recorded here rather than absorbed.',
                    $index,
                ),
            ];
        }

        return ['lines' => $lines, 'totals' => $totals, 'cost_labels' => $costLabels, 'findings' => $findings];
    }

    /**
     * @param  array<string, ?string>  $cells
     * @return list<Finding>
     */
    private static function scientificFindings(int $index, string $where, array $cells): array
    {
        $findings = [];

        foreach ($cells as $name => $cell) {
            if (! Numeric::isScientific($cell)) {
                continue;
            }

            $findings[] = [
                'code' => 'scientific_notation',
                'detail' => sprintf(
                    'Sheet %d, %s: the %s is written "%s" and reads as %s.',
                    $index,
                    $where,
                    $name,
                    (string) $cell,
                    (string) Numeric::parse($cell),
                ),
            ];
        }

        return $findings;
    }

    /**
     * Read the yield row, and say how much of the reading was inference.
     *
     * @param  array<string, array{label:string, value:string}>  $header
     * @param  list<CostLabel>  $costLabels
     * @param  list<Finding>  $findings
     * @return SheetYield
     */
    private static function readYield(int $index, array $header, array $costLabels, array &$findings): array
    {
        $row = null;

        foreach (self::YIELD_LABELS as $key) {
            if (isset($header[$key])) {
                $row = $header[$key];

                break;
            }
        }

        $absent = ['raw' => null, 'label' => null, 'shape' => 'absent', 'quantity' => null, 'unit' => null, 'piece_count' => null];

        if ($row === null || trim($row['value']) === '') {
            $findings[] = [
                'code' => 'yield_missing',
                'detail' => sprintf(
                    'Sheet %d has no Quantity Produced, Quantity Produced (Yield) or Yield row, so nothing on it can be costed per unit of output.',
                    $index,
                ),
            ];

            return $absent;
        }

        $raw = $row['value'];
        $findings = array_merge($findings, self::scientificFindings($index, 'the yield row', ['yield' => $raw]));

        if (preg_match(self::PIECES_AND_MASS, $raw, $matches) === 1) {
            return [
                'raw' => $raw,
                'label' => $row['label'],
                'shape' => 'pieces_and_mass',
                'quantity' => Numeric::parse($matches[2]),
                'unit' => 'kg',
                'piece_count' => (int) $matches[1],
            ];
        }

        $number = Numeric::parse($raw);

        if ($number === null) {
            // The row is there and unreadable, which is a different problem
            // from the row being absent — so the detail says which it is
            // rather than reusing the sentence about a missing row.
            $findings[] = [
                'code' => 'yield_missing',
                'detail' => sprintf(
                    'Sheet %d states a yield of "%s", which is not a number and not a piece count with a mass in brackets, so no yield could be read.',
                    $index,
                    $raw,
                ),
            ];

            return ['raw' => $raw, 'label' => $row['label'], 'shape' => 'absent', 'quantity' => null, 'unit' => null, 'piece_count' => null];
        }

        if (str_contains($number, '.')) {
            return [
                'raw' => $raw,
                'label' => $row['label'],
                'shape' => 'decimal_mass',
                'quantity' => $number,
                'unit' => 'kg',
                'piece_count' => null,
            ];
        }

        $pieceLabel = self::labelMatching($costLabels, '/\bpiece\b/i');
        $massLabel = self::labelMatching($costLabels, '/\bkg\b/i');

        $asPieces = $pieceLabel !== null && $massLabel === null;

        $findings[] = [
            'code' => 'yield_shape_ambiguous',
            'detail' => sprintf(
                'Sheet %d states a yield of "%s" with no unit. %s',
                $index,
                $raw,
                match (true) {
                    $asPieces => sprintf('Its cost block names a piece ("%s") and no kilogram, so the figure is read as a piece count.', $pieceLabel),
                    $pieceLabel === null && $massLabel !== null => sprintf('Its cost block names a kilogram ("%s") and no piece, so the figure is read as kilograms.', $massLabel),
                    $pieceLabel !== null => sprintf('Its cost block names both a piece ("%s") and a kilogram ("%s"), which decides nothing, so the figure is read as kilograms.', $pieceLabel, (string) $massLabel),
                    default => 'Its cost block names neither a piece nor a kilogram, so the figure is read as kilograms.',
                },
            ),
        ];

        return [
            'raw' => $raw,
            'label' => $row['label'],
            'shape' => 'bare_integer',
            'quantity' => $asPieces ? null : $number,
            'unit' => $asPieces ? null : 'kg',
            'piece_count' => $asPieces ? (int) $number : null,
        ];
    }

    /**
     * @param  list<CostLabel>  $costLabels
     */
    private static function labelMatching(array $costLabels, string $pattern): ?string
    {
        foreach ($costLabels as $cost) {
            if (preg_match($pattern, $cost['label']) === 1) {
                return $cost['label'];
            }
        }

        return null;
    }

    /**
     * The waste coefficient, as a bare number.
     *
     * Matched on "waste" plus a percentage anywhere in the label, which is
     * what makes `Add Waste Coefficient 3%` and `3% Waste Coeffecient` — the
     * same figure, spelled two ways across the workbook, one of them
     * misspelled — come out as the same `"3"`.
     *
     * @param  list<CostLabel>  $costLabels
     * @return numeric-string|null
     */
    private static function wastePercent(array $costLabels): ?string
    {
        foreach ($costLabels as $cost) {
            if (preg_match('/waste/i', $cost['label']) !== 1) {
                continue;
            }

            if (preg_match('/(\d+(?:\.\d+)?)\s*%/', $cost['label'], $matches) === 1) {
                return Numeric::parse($matches[1]);
            }
        }

        return null;
    }

    /**
     * Line-level checks: arithmetic, units and free ingredients.
     *
     * @param  list<SheetLine>  $lines
     * @return list<Finding>
     */
    private static function auditLines(int $index, array $lines): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        foreach ($lines as $line) {
            $where = sprintf('Sheet %d, row %d "%s"', $index, $line['row'], $line['designation']);

            if ($line['quantity'] !== null && $line['unit_price'] !== null && $line['line_total'] !== null) {
                $expected = bcmul($line['quantity'], $line['unit_price'], self::SCALE);

                if (self::differsBy($expected, $line['line_total'], '0.005')) {
                    $findings[] = [
                        'code' => 'line_total_mismatch',
                        'detail' => sprintf(
                            '%s: %s × %s = %s, but the line states %s.',
                            $where,
                            Numeric::forDisplay($line['quantity']),
                            Numeric::forDisplay($line['unit_price']),
                            Numeric::forDisplay($expected),
                            Numeric::forDisplay($line['line_total']),
                        ),
                    ];
                }
            }

            if ($line['unit'] !== null && ! in_array($line['unit'], self::CANONICAL_UNITS, true)) {
                $findings[] = [
                    'code' => 'unit_spelling_variant',
                    'detail' => sprintf('%s: the unit is written "%s", which is not one of kg, Piece or L.', $where, $line['unit']),
                ];
            }

            if ($line['unit_price'] !== null && bccomp($line['unit_price'], '0', self::SCALE) === 0) {
                $findings[] = [
                    'code' => 'zero_unit_price',
                    'detail' => sprintf('%s: the unit price is 0, so the line adds nothing to the sheet\'s cost.', $where),
                ];
            }
        }

        return $findings;
    }

    /**
     * The `Total:` row against the lines above it.
     *
     * Both checks fire on sheets where the disagreement is understood — ten
     * sheets restate the *yield* in the total-quantity cell rather than the
     * input weight, which is a consistent habit rather than a mistake. They
     * are still reported. A habit that makes a stated total mean two
     * different things on two different pages is precisely what an import
     * report exists to surface, and suppressing it here would leave the
     * caller writing whichever meaning happened to be typed.
     *
     * @param  list<SheetLine>  $lines
     * @param  SheetTotals  $totals
     * @return list<Finding>
     */
    private static function auditTotals(int $index, array $lines, array $totals): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        $quantitySum = '0';
        $totalSum = '0';

        foreach ($lines as $line) {
            if ($line['quantity'] !== null) {
                $quantitySum = bcadd($quantitySum, $line['quantity'], self::SCALE);
            }

            if ($line['line_total'] !== null) {
                $totalSum = bcadd($totalSum, $line['line_total'], self::SCALE);
            }
        }

        if ($totals['input_total'] !== null && self::differsBy($totalSum, $totals['input_total'], '0.01')) {
            $findings[] = [
                'code' => 'input_total_mismatch',
                'detail' => sprintf(
                    'Sheet %d states a Total of %s while its %d lines add up to %s.',
                    $index,
                    Numeric::forDisplay($totals['input_total']),
                    count($lines),
                    Numeric::forDisplay($totalSum),
                ),
            ];
        }

        if ($totals['input_quantity'] !== null && self::differsBy($quantitySum, $totals['input_quantity'], '0.001')) {
            $findings[] = [
                'code' => 'input_quantity_mismatch',
                'detail' => sprintf(
                    'Sheet %d states a Total quantity of %s while its %d lines add up to %s. Several sheets restate the yield in this cell instead of the input weight.',
                    $index,
                    Numeric::forDisplay($totals['input_quantity']),
                    count($lines),
                    Numeric::forDisplay($quantitySum),
                ),
            ];
        }

        return $findings;
    }

    /**
     * A cost block that quotes a basis the yield cannot supply.
     *
     * Four sheets quote "1 Piece Production Cost" over a yield written as a
     * fraction of a kilogram. One of the two is wrong and the page does not
     * say which, so both readings are preserved — the yield in `yield`, the
     * wording in `cost_labels` — and this finding records that they disagree.
     *
     * @param  list<CostLabel>  $costLabels
     * @param  SheetYield  $yield
     * @return list<Finding>
     */
    private static function auditBasisLabels(int $index, array $costLabels, array $yield): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        $pieceLabel = self::labelMatching($costLabels, '/\bpiece\b/i');
        $massLabel = self::labelMatching($costLabels, '/\bkg\b/i');

        if ($pieceLabel !== null && $yield['piece_count'] === null) {
            $findings[] = [
                'code' => 'basis_label_conflict',
                'detail' => sprintf('Sheet %d\'s cost block names a piece ("%s") while its yield carries no piece count.', $index, $pieceLabel),
            ];
        }

        if ($massLabel !== null && $yield['quantity'] === null) {
            $findings[] = [
                'code' => 'basis_label_conflict',
                'detail' => sprintf('Sheet %d\'s cost block names a kilogram ("%s") while its yield carries no mass.', $index, $massLabel),
            ];
        }

        return $findings;
    }

    /**
     * Lines counted in pieces whose designation is weighed somewhere else.
     *
     * Sheet 8 lists "Milk Liquid" twice — once in kilograms and once in
     * pieces — and the second reading makes a quarter of a piece of milk cost
     * 2.45. The rule is written generally rather than against that row: any
     * designation that appears both counted and measured anywhere in the file
     * is flagged wherever it is counted, because the unit column is the one
     * field a costing cannot recover from being wrong about.
     *
     * @param  list<TechnicalSheet>  $sheets
     * @return list<TechnicalSheet>
     */
    private static function withImplausibleUnitFindings(array $sheets): array
    {
        /** @var array<string, true> $measured */
        $measured = [];

        foreach ($sheets as $sheet) {
            foreach ($sheet['lines'] as $line) {
                if (self::unitKind($line['unit']) === 'measured') {
                    $measured[SheetReader::fold($line['designation'])] = true;
                }
            }
        }

        foreach ($sheets as $position => $sheet) {
            foreach ($sheet['lines'] as $line) {
                $key = SheetReader::fold($line['designation']);

                if (self::unitKind($line['unit']) !== 'piece' || ! isset($measured[$key])) {
                    continue;
                }

                $sheets[$position]['findings'][] = [
                    'code' => 'unit_implausible',
                    'detail' => sprintf(
                        'Sheet %d, row %d "%s" is counted in %s, while the same designation is measured by weight or volume elsewhere in the file.',
                        $sheet['sheet_index'],
                        $line['row'],
                        $line['designation'],
                        (string) $line['unit'],
                    ),
                ];
            }
        }

        return $sheets;
    }

    /**
     * @param  list<TechnicalSheet>  $sheets
     * @return list<Finding>
     */
    private static function duplicateDesignations(array $sheets): array
    {
        /** @var array<string, array{name:string, sheets:list<int>}> $seen */
        $seen = [];

        foreach ($sheets as $sheet) {
            $key = SheetReader::fold($sheet['designation']);

            if ($key === '') {
                continue;
            }

            $seen[$key] ??= ['name' => $sheet['designation'], 'sheets' => []];
            $seen[$key]['sheets'][] = $sheet['sheet_index'];
        }

        /** @var list<Finding> $findings */
        $findings = [];

        foreach ($seen as $entry) {
            if (count($entry['sheets']) < 2) {
                continue;
            }

            $findings[] = [
                'code' => 'duplicate_designation_across_sheets',
                'detail' => sprintf(
                    '"%s" is the designation of sheets %s. They are separate pages with separate formulations, so importing them as one recipe would discard whichever was read second.',
                    $entry['name'],
                    implode(' and ', array_map(strval(...), $entry['sheets'])),
                ),
            ];
        }

        return $findings;
    }

    /**
     * The same ingredient priced differently on different pages.
     *
     * The gate is a spread of more than 25% between the cheapest and dearest
     * writing of a designation, measured against the cheapest. That threshold
     * is a judgement, and it is deliberately loose: prices in this workbook
     * were typed over months of a moving market, so a tenth of a dollar
     * between two sheets is ordinary and would bury the report if reported.
     * A designation that is free on one page and priced on another always
     * fires — there is no percentage that makes zero a rounding of a price.
     *
     * **At least two sheets, always.** One sheet lists the same ingredient
     * twice at two prices because it buys it two ways — a litre of milk and a
     * carton of it — and that is a fact about the recipe rather than a
     * disagreement between pages. Comparing within a sheet would report it as
     * an inconsistency and teach the reader to ignore the code.
     *
     * @param  list<TechnicalSheet>  $sheets
     * @return list<Finding>
     */
    private static function unitPriceOutliers(array $sheets): array
    {
        /** @var array<string, array{name:string, prices:list<array{price:numeric-string, sheet:int}>}> $byDesignation */
        $byDesignation = [];

        foreach ($sheets as $sheet) {
            foreach ($sheet['lines'] as $line) {
                if ($line['unit_price'] === null) {
                    continue;
                }

                $key = SheetReader::fold($line['designation']);
                $byDesignation[$key] ??= ['name' => $line['designation'], 'prices' => []];

                foreach ($byDesignation[$key]['prices'] as $seen) {
                    if (bccomp($seen['price'], $line['unit_price'], self::SCALE) === 0 && $seen['sheet'] === $sheet['sheet_index']) {
                        continue 2;
                    }
                }

                $byDesignation[$key]['prices'][] = ['price' => $line['unit_price'], 'sheet' => $sheet['sheet_index']];
            }
        }

        /** @var list<Finding> $findings */
        $findings = [];

        foreach ($byDesignation as $entry) {
            $sheetsInvolved = array_unique(array_map(
                static fn (array $priced): int => $priced['sheet'],
                $entry['prices'],
            ));

            if (count($entry['prices']) < 2 || count($sheetsInvolved) < 2) {
                continue;
            }

            $lowest = $entry['prices'][0]['price'];
            $highest = $entry['prices'][0]['price'];

            foreach ($entry['prices'] as $priced) {
                if (bccomp($priced['price'], $lowest, self::SCALE) === -1) {
                    $lowest = $priced['price'];
                }

                if (bccomp($priced['price'], $highest, self::SCALE) === 1) {
                    $highest = $priced['price'];
                }
            }

            if (! self::spreadExceedsQuarter($lowest, $highest)) {
                continue;
            }

            $quoted = array_map(
                static fn (array $priced): string => sprintf('%s (sheet %d)', Numeric::forDisplay($priced['price']), $priced['sheet']),
                $entry['prices'],
            );

            $findings[] = [
                'code' => 'unit_price_outlier',
                'detail' => sprintf(
                    '"%s" carries unit prices that differ by more than 25%% across sheets: %s.',
                    $entry['name'],
                    implode(', ', $quoted),
                ),
            ];
        }

        return $findings;
    }

    /**
     * @param  numeric-string  $lowest
     * @param  numeric-string  $highest
     */
    private static function spreadExceedsQuarter(string $lowest, string $highest): bool
    {
        if (bccomp($lowest, '0', self::SCALE) === 0) {
            return bccomp($highest, '0', self::SCALE) === 1;
        }

        $spread = bcdiv(bcsub($highest, $lowest, self::SCALE), $lowest, self::SCALE);

        return bccomp($spread, '0.25', self::SCALE) === 1;
    }

    /**
     * Do two figures disagree by more than the tolerance, in either
     * direction?
     *
     * The magnitude is taken with bcmath rather than by stripping a sign off
     * the string, so the whole comparison stays inside the decimal domain.
     *
     * @param  numeric-string  $left
     * @param  numeric-string  $right
     * @param  numeric-string  $tolerance
     */
    private static function differsBy(string $left, string $right, string $tolerance): bool
    {
        $difference = bcsub($left, $right, self::SCALE);

        $magnitude = bccomp($difference, '0', self::SCALE) === -1
            ? bcsub('0', $difference, self::SCALE)
            : $difference;

        return bccomp($magnitude, $tolerance, self::SCALE) === 1;
    }

    /**
     * @return 'measured'|'piece'|'unknown'
     */
    private static function unitKind(?string $unit): string
    {
        $folded = rtrim(SheetReader::fold($unit), '.');

        if (in_array($folded, self::PIECE_UNITS, true)) {
            return 'piece';
        }

        if (in_array($folded, self::MEASURED_UNITS, true)) {
            return 'measured';
        }

        return 'unknown';
    }
}
