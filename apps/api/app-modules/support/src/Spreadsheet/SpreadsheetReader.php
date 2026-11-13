<?php

declare(strict_types=1);

namespace Healthy360\Support\Spreadsheet;

use DateInterval;
use DateTimeInterface;
use Illuminate\Validation\ValidationException;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Reader\XLSX\Options;
use OpenSpout\Reader\XLSX\Reader;
use Throwable;

/**
 * Reads the first sheet of an uploaded .xlsx into rows keyed by column key.
 *
 * Headers are matched loosely — case, spaces and punctuation are ignored — so
 * `Name (EN)`, `name en` and `name_en` all land on the same column. Row numbers
 * are the sheet's own (empty rows are preserved while reading), so an error
 * report can point at the row a person sees in Excel.
 *
 * Every refusal is a 422 `ValidationException` on `file`; a sheet that is not an
 * .xlsx at all, or breaks halfway through, says so rather than surfacing as a 500.
 */
final class SpreadsheetReader
{
    /**
     * @param  array<string, string>  $columns  key => header text as the template prints it, e.g. ['name_en' => 'Name (EN)']
     * @param  list<string>  $requiredAnyOf  at least one of these KEYS must be present in the header row
     * @return array{rows: list<array{row: int, values: array<string, string|null>, example: bool}>, ignored_columns: list<string>}
     *
     * @throws ValidationException
     */
    public function read(string $path, array $columns, array $requiredAnyOf, int $maxRows = 1000): array
    {
        $reader = new Reader(new Options(SHOULD_PRESERVE_EMPTY_ROWS: true));

        try {
            $reader->open($path);

            foreach ($reader->getSheetIterator() as $sheet) {
                return $this->readSheet($sheet->getRowIterator(), $columns, $requiredAnyOf, $maxRows);
            }

            return ['rows' => [], 'ignored_columns' => []];
        } catch (ValidationException $e) {
            throw $e;
        } catch (Throwable) {
            throw ValidationException::withMessages(['file' => 'Not a readable .xlsx file.']);
        } finally {
            $reader->close();
        }
    }

    /**
     * @param  iterable<int, Row>  $sheetRows
     * @param  array<string, string>  $columns
     * @param  list<string>  $requiredAnyOf
     * @return array{rows: list<array{row: int, values: array<string, string|null>, example: bool}>, ignored_columns: list<string>}
     */
    private function readSheet(iterable $sheetRows, array $columns, array $requiredAnyOf, int $maxRows): array
    {
        /** @var array<int, string>|null $map cell index => column key, once the header row is found */
        $map = null;
        $ignored = [];
        $rows = [];
        $exampleKey = array_key_first($columns);

        foreach ($sheetRows as $rowNumber => $row) {
            $cells = array_map($this->cellValue(...), $row->cells);

            if ($map === null) {
                if (array_filter($cells, static fn (?string $value): bool => $value !== null) === []) {
                    continue;
                }

                [$map, $ignored] = $this->mapHeaders($cells, $columns, $requiredAnyOf);

                continue;
            }

            $values = [];
            foreach ($map as $index => $key) {
                $values[$key] = $cells[$index] ?? null;
            }

            if (array_filter($values, static fn (?string $value): bool => $value !== null) === []) {
                continue;
            }

            if (count($rows) >= $maxRows) {
                throw ValidationException::withMessages(['file' => "Split the sheet: at most {$maxRows} rows per file."]);
            }

            $rows[] = [
                'row' => $rowNumber,
                'values' => $values,
                'example' => $exampleKey !== null && mb_strtoupper($values[$exampleKey] ?? '') === 'EXAMPLE',
            ];
        }

        if ($map === null) {
            $this->refuseMissingHeaders($columns, $requiredAnyOf);
        }

        return ['rows' => $rows, 'ignored_columns' => $ignored];
    }

    /**
     * @param  array<int, string|null>  $cells
     * @param  array<string, string>  $columns
     * @param  list<string>  $requiredAnyOf
     * @return array{0: array<int, string>, 1: list<string>}
     */
    private function mapHeaders(array $cells, array $columns, array $requiredAnyOf): array
    {
        $lookup = [];
        foreach ($columns as $key => $header) {
            $lookup[self::normalise($header)] = $key;
            $lookup[self::normalise($key)] = $key;
        }

        $map = [];
        $ignored = [];
        foreach ($cells as $index => $header) {
            if ($header === null) {
                continue;
            }

            $key = $lookup[self::normalise($header)] ?? null;

            if ($key === null) {
                $ignored[] = $header;

                continue;
            }

            if (in_array($key, $map, true)) {
                throw ValidationException::withMessages(['file' => "The column \"{$columns[$key]}\" appears more than once."]);
            }

            $map[$index] = $key;
        }

        if (array_intersect($requiredAnyOf, $map) === []) {
            $this->refuseMissingHeaders($columns, $requiredAnyOf);
        }

        return [$map, $ignored];
    }

    /**
     * @param  array<string, string>  $columns
     * @param  list<string>  $requiredAnyOf
     */
    private function refuseMissingHeaders(array $columns, array $requiredAnyOf): never
    {
        $expected = implode(', ', array_map(static fn (string $key): string => '"'.($columns[$key] ?? $key).'"', $requiredAnyOf));

        throw ValidationException::withMessages(['file' => "The header row needs at least one of: {$expected}."]);
    }

    private function cellValue(Cell $cell): ?string
    {
        $value = match (true) {
            $cell instanceof Cell\FormulaCell => $cell->getComputedValue(),
            $cell instanceof Cell\TextRunCell => $cell->getStringValue(),
            default => $cell->getValue(),
        };

        $text = match (true) {
            is_string($value) => trim($value),
            is_int($value) => (string) $value,
            is_float($value) => floor($value) === $value && abs($value) < PHP_INT_MAX ? (string) (int) $value : (string) $value,
            is_bool($value) => $value ? '1' : '0',
            $value instanceof DateTimeInterface => $value->format('Y-m-d'),
            $value instanceof DateInterval => $value->format('%H:%I:%S'),
            default => '',
        };

        return $text === '' ? null : $text;
    }

    private static function normalise(string $header): string
    {
        return (string) preg_replace('/[^\p{L}\p{N}]+/u', '', mb_strtolower($header));
    }
}
