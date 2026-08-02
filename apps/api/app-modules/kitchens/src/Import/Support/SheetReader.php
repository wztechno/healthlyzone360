<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Support;

/**
 * The one place that knows what the workbook's markdown looks like.
 *
 * The private GreenLife workbook reaches this codebase as five markdown
 * files, each an export of an Excel workbook: a line `Sheet<N>:<title>` at
 * column zero, a blank line, then one or more pipe tables. Every parser in
 * `Import\Parsers` starts here, so the shape of a sheet is defined once
 * rather than five times.
 *
 * **A sheet is a flat list of rows, not a list of tables.** Excel's own
 * notion of where one table ends and the next begins did not survive the
 * export — sheet 3 of the meal-plan file holds three logically separate
 * blocks (combinations, calorie bands, durations) in what the markdown
 * renders as one continuous run of rows, and the recipe sheets put the
 * header block, the raw-material block and the cost block in a single table.
 * Preserving table boundaries would therefore give the parsers a division
 * that is real in the markdown and meaningless in the data. They find their
 * own blocks by reading the rows, which is what a person does.
 *
 * **Anything that is neither a `Sheet` heading nor a table row is dropped.**
 * Blank lines, HTML comments, stray prose: none of them carry data, and a
 * reader that tripped over a comment would make the test fixtures
 * unmaintainable. Rows appearing before the first `Sheet` heading belong to
 * no sheet and are discarded for the same reason.
 *
 * **Merged cells arrive as repetition.** A cell merged across six columns
 * exports as the same string six times, which is why `collapseRepeats()`
 * exists and why "is this row a banner?" is a question about repetition
 * rather than about formatting.
 */
final class SheetReader
{
    /**
     * A markdown table separator: `| --- | --- |`, in any of the alignment
     * spellings.
     */
    private const string SEPARATOR_CELL = '/^:?-+:?$/';

    /**
     * Every sheet in the file, in the order the export wrote them.
     *
     * `index` is the number in the heading rather than the position in the
     * list, because the parsers' findings name sheets the way a human opening
     * the workbook would ("sheet 25"), and a file that omitted a sheet would
     * otherwise silently renumber every finding after it.
     *
     * @return list<array{index:int, title:string, rows:list<list<string>>}>
     */
    public static function sheets(string $markdown): array
    {
        /** @var list<array{index:int, title:string, rows:list<list<string>>}> $sheets */
        $sheets = [];
        $current = null;

        foreach (preg_split('/\r\n|\r|\n/', $markdown) ?: [] as $line) {
            $heading = self::heading($line);

            if ($heading !== null) {
                if ($current !== null) {
                    $sheets[] = $current;
                }

                $current = ['index' => $heading['index'], 'title' => $heading['title'], 'rows' => []];

                continue;
            }

            if ($current === null) {
                continue;
            }

            $cells = self::cells($line);

            if ($cells === null || self::isSeparator($cells)) {
                continue;
            }

            $current['rows'][] = $cells;
        }

        if ($current !== null) {
            $sheets[] = $current;
        }

        return $sheets;
    }

    /**
     * Drop consecutive duplicates and trailing blanks — the shape a merged
     * cell leaves behind.
     *
     * `['Designation', 'Caesar Sauce', 'Caesar Sauce', '', '', '']` becomes
     * `['Designation', 'Caesar Sauce']`. Only *consecutive* duplicates go:
     * two lines that both cost `0.3` are two lines, and a rule that
     * de-duplicated across a row would quietly delete one of them.
     *
     * @param  list<string>  $cells
     * @return list<string>
     */
    public static function collapseRepeats(array $cells): array
    {
        /** @var list<string> $kept */
        $kept = [];

        foreach ($cells as $cell) {
            if ($kept !== [] && $kept[count($kept) - 1] === $cell) {
                continue;
            }

            $kept[] = $cell;
        }

        while ($kept !== [] && $kept[count($kept) - 1] === '') {
            array_pop($kept);
        }

        return $kept;
    }

    /**
     * Is this row one value merged across the whole width?
     *
     * That is how the export renders every banner the workbook uses: the
     * `Description` / `Production` / `Raw Materiel` / `Cost` dividers inside a
     * technical sheet, the merged title above each list, and the merged
     * caveat below it. Deciding by repetition rather than by matching the
     * sentence keeps the parsers from carrying copies of a confidential
     * workbook's prose around in constants.
     *
     * @param  list<string>  $cells
     */
    public static function isMergedBanner(array $cells): bool
    {
        return count(self::collapseRepeats($cells)) === 1;
    }

    /**
     * A cell by position, with blank read as absent.
     *
     * The workbook's trailing columns are full of empty strings that mean
     * exactly what a missing column means, so the two are collapsed here
     * once instead of at every call site.
     *
     * @param  list<string>  $cells
     */
    public static function cell(array $cells, int $index): ?string
    {
        $value = $cells[$index] ?? '';

        return $value === '' ? null : $value;
    }

    /**
     * Case-folded, whitespace-collapsed form, for matching a label against a
     * known vocabulary.
     *
     * The source spells the same thing `Cleansing  Plan` in one sheet and
     * `Cleansing Plan` in another, and `Frozen ` with a trailing space in a
     * third. Comparison happens on this form; the verbatim string is what
     * gets stored and reported.
     */
    public static function fold(?string $value): string
    {
        if ($value === null) {
            return '';
        }

        return mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $value)));
    }

    /**
     * @return array{index:int, title:string}|null
     */
    private static function heading(string $line): ?array
    {
        if (! str_starts_with($line, 'Sheet')) {
            return null;
        }

        if (preg_match('/^Sheet\s*(\d+)\s*:?\s*(.*)$/u', rtrim($line), $matches) !== 1) {
            return null;
        }

        return ['index' => (int) $matches[1], 'title' => trim($matches[2])];
    }

    /**
     * @return list<string>|null
     */
    private static function cells(string $line): ?array
    {
        $trimmed = trim($line);

        if (! str_starts_with($trimmed, '|')) {
            return null;
        }

        $inner = substr($trimmed, 1);

        if (str_ends_with($inner, '|')) {
            $inner = substr($inner, 0, -1);
        }

        return array_map(trim(...), explode('|', $inner));
    }

    /**
     * @param  list<string>  $cells
     */
    private static function isSeparator(array $cells): bool
    {
        if ($cells === []) {
            return false;
        }

        foreach ($cells as $cell) {
            if (preg_match(self::SEPARATOR_CELL, $cell) !== 1) {
                return false;
            }
        }

        return true;
    }
}
