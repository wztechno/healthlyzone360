<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Parsers;

use Healthy360\Kitchens\Import\Support\SheetReader;

/**
 * Two facts out of the customer-data workbook, and nothing else.
 *
 * That file is a specification for customer and B2B client records — profile
 * fields, dietary requirements, consent wording, payment terms — almost all
 * of which the platform already models or must model from its own schema
 * rather than from a spreadsheet. Two things in it are reference data the
 * delivery module needs and cannot derive: the names of the delivery windows,
 * and how many delivery zones the operator works in.
 *
 * **The windows have names and no times.** The dropdown lists Morning,
 * Afternoon and Evening; nowhere does the workbook say when a morning starts
 * or ends. Those boundaries are an operational commitment to a customer — the
 * difference between a delivery promise kept and one broken — so they are
 * left unset and `delivery_window_times_absent` says the source is silent
 * rather than letting anyone infer 08:00-12:00 from nothing.
 *
 * **The 125 zones are already platform reference data.** The heading names a
 * count and the cells below list the areas; the count is read back purely so
 * an import can be checked against what is already seeded, and
 * `delivery_areas_platform_seeded` records that this parser is not the route
 * by which they enter the system.
 *
 * The scan is deliberately whole-file. Both facts live in the dropdown
 * reference sheet today, and pinning the search to a sheet number would break
 * the day someone inserts a sheet above it — which, in a workbook that is
 * still being edited, is a matter of time.
 *
 * @phpstan-type Finding array{code:string, detail:string}
 * @phpstan-type DeliveryWindow array{code:string, name:string}
 */
final class CustomerDataParser
{
    /**
     * The column heading that introduces the delivery-window dropdown. The
     * sheet is a grid of unrelated dropdowns laid side by side, so a value is
     * only a delivery window by virtue of sitting under this heading.
     */
    private const string WINDOW_HEADING = 'delivery window';

    /**
     * `Delivery Areas  (125 zones — Lebanon / Mount-Lebanon; ...)`. Only the
     * count is taken; the country scope belongs to whoever seeded the areas.
     */
    private const string AREA_COUNT = '/delivery\s+areas.*?(\d+)\s*zones/iu';

    /**
     * @return array{delivery_windows: list<DeliveryWindow>, delivery_area_count: ?int, findings: list<Finding>}
     */
    public static function parse(string $markdown): array
    {
        /** @var list<DeliveryWindow> $windows */
        $windows = [];
        $areaCount = null;

        foreach (SheetReader::sheets($markdown) as $sheet) {
            $windows = $windows === [] ? self::deliveryWindows($sheet['rows']) : $windows;
            $areaCount ??= self::areaCount($sheet['rows']);
        }

        return [
            'delivery_windows' => $windows,
            'delivery_area_count' => $areaCount,
            'findings' => [
                [
                    'code' => 'delivery_window_times_absent',
                    'detail' => sprintf(
                        'The source names %d delivery window(s) and states no start or end time for any of them. The boundaries are a promise to a customer, so they are left unset rather than inferred.',
                        count($windows),
                    ),
                ],
                [
                    'code' => 'delivery_areas_platform_seeded',
                    'detail' => $areaCount === null
                        ? 'The source states no delivery-zone count. The delivery areas are platform reference data and are not imported from this file in any case.'
                        : sprintf(
                            'The source names %d delivery zones. They are already platform reference data, so the count is read back only as a cross-check and no area is imported from this file.',
                            $areaCount,
                        ),
                ],
            ],
        ];
    }

    /**
     * The values sitting under the "Delivery Window" heading, read downwards
     * until the column runs out.
     *
     * **The phrase alone is not enough, and this is the trap the source
     * sets.** The workbook names "Delivery Window" twice. Once as a *column
     * heading* over the three values, in the reference sheet's grid of
     * side-by-side dropdown groups; and once, several sheets earlier, in the
     * `Source list` column of a field *specification* — one row per customer
     * field, saying which dropdown populates it. Matching the string alone
     * finds the specification first and walks down the wrong column,
     * returning twelve field-spec labels that are not delivery windows and
     * look exactly like delivery windows to anything downstream.
     *
     * So a match must have the shape of a dropdown heading, not just the
     * text: it must sit in a row of sibling headings — several short labels,
     * no sentences, no row numbers, no dashes — with an actual value directly
     * beneath it. The specification row fails on all three counts, and the
     * scan simply carries on to the next candidate.
     *
     * A blank ends the list. The reference sheet stacks several unrelated
     * dropdown groups in the same columns, separated by a blank in whichever
     * column runs out first, and reading past one would file "Business Type"
     * values as delivery windows.
     *
     * @param  list<list<string>>  $rows
     * @return list<DeliveryWindow>
     */
    private static function deliveryWindows(array $rows): array
    {
        foreach ($rows as $position => $row) {
            $column = self::headingColumn($row);

            if ($column === null || ! self::isDropdownHeadingRow($row, $rows[$position + 1] ?? null, $column)) {
                continue;
            }

            /** @var list<DeliveryWindow> $windows */
            $windows = [];

            foreach (array_slice($rows, $position + 1) as $below) {
                $value = $below[$column] ?? '';

                if ($value === '' || self::isDash($value) || SheetReader::isMergedBanner($below)) {
                    break;
                }

                $windows[] = ['code' => self::slug($value), 'name' => $value];
            }

            if ($windows !== []) {
                return $windows;
            }
        }

        return [];
    }

    /**
     * @param  list<string>  $row
     */
    private static function headingColumn(array $row): ?int
    {
        foreach ($row as $column => $cell) {
            if (SheetReader::fold($cell) === self::WINDOW_HEADING) {
                return $column;
            }
        }

        return null;
    }

    /**
     * Is this a row of dropdown headings, with a value under this one?
     *
     * @param  list<string>  $row
     * @param  list<string>|null  $below
     */
    private static function isDropdownHeadingRow(array $row, ?array $below, int $column): bool
    {
        if (SheetReader::isMergedBanner($row)) {
            return false;
        }

        $siblings = 0;

        foreach ($row as $position => $cell) {
            if (trim($cell) === '') {
                continue;
            }

            if (! self::isHeadingCell($cell)) {
                return false;
            }

            if ($position !== $column) {
                $siblings++;
            }
        }

        if ($siblings < 2) {
            return false;
        }

        $value = $below[$column] ?? '';

        return $below !== null && ! SheetReader::isMergedBanner($below) && $value !== '' && ! self::isDash($value);
    }

    /**
     * A short label rather than a sentence, a row number or a placeholder.
     *
     * The three exclusions are the three things a field-specification row
     * puts beside its source-list name: a row number in the first column,
     * prose descriptions ending in a full stop, and an em dash wherever a
     * field has no source list.
     */
    private static function isHeadingCell(string $cell): bool
    {
        $trimmed = trim($cell);

        return mb_strlen($trimmed) <= 40
            && ! str_ends_with($trimmed, '.')
            && preg_match('/^\d+$/', $trimmed) !== 1
            && ! self::isDash($trimmed);
    }

    private static function isDash(string $value): bool
    {
        return in_array(trim($value), ['—', '–', '-'], true);
    }

    /**
     * @param  list<list<string>>  $rows
     */
    private static function areaCount(array $rows): ?int
    {
        foreach ($rows as $row) {
            foreach ($row as $cell) {
                if (preg_match(self::AREA_COUNT, $cell, $matches) === 1) {
                    return (int) $matches[1];
                }
            }
        }

        return null;
    }

    private static function slug(string $value): string
    {
        return trim(strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', $value)), '-');
    }
}
