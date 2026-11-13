<?php

declare(strict_types=1);

namespace Healthy360\Support\Spreadsheet;

/**
 * What one spreadsheet import did, row by row, as the response body answers it.
 *
 * Unchanged rows are counted but never listed: a re-upload of an untouched
 * export would otherwise answer a thousand lines saying nothing happened.
 * Every other outcome names its sheet row and the record it touched, so the
 * person can find the line in the file they sent.
 */
final class ImportResult
{
    /** @var array{created: int, updated: int, unchanged: int, skipped: int, failed: int} */
    private array $counts = ['created' => 0, 'updated' => 0, 'unchanged' => 0, 'skipped' => 0, 'failed' => 0];

    /** @var list<array{row: int, outcome: 'created'|'updated'|'skipped'|'failed', reference: string|null, message: string|null}> */
    private array $rows = [];

    /** @var list<string> */
    private array $ignoredColumns = [];

    public function created(int $row, ?string $reference): void
    {
        $this->record($row, 'created', $reference, null);
    }

    public function updated(int $row, ?string $reference): void
    {
        $this->record($row, 'updated', $reference, null);
    }

    public function unchanged(): void
    {
        $this->counts['unchanged']++;
    }

    public function skipped(int $row, ?string $reference, string $message): void
    {
        $this->record($row, 'skipped', $reference, $message);
    }

    public function failed(int $row, ?string $reference, string $message): void
    {
        $this->record($row, 'failed', $reference, $message);
    }

    /**
     * @param  list<string>  $columns
     */
    public function ignoredColumns(array $columns): void
    {
        $this->ignoredColumns = $columns;
    }

    /**
     * @param  'created'|'updated'|'unchanged'|'skipped'|'failed'  $outcome
     */
    public function count(string $outcome): int
    {
        return $this->counts[$outcome];
    }

    /**
     * @return array{created: int, updated: int, unchanged: int, skipped: int, failed: int, ignored_columns: list<string>, rows: list<array{row: int, outcome: 'created'|'updated'|'skipped'|'failed', reference: string|null, message: string|null}>}
     */
    public function toArray(): array
    {
        return [
            ...$this->counts,
            'ignored_columns' => $this->ignoredColumns,
            'rows' => $this->rows,
        ];
    }

    /**
     * @param  'created'|'updated'|'skipped'|'failed'  $outcome
     */
    private function record(int $row, string $outcome, ?string $reference, ?string $message): void
    {
        $this->counts[$outcome]++;
        $this->rows[] = ['row' => $row, 'outcome' => $outcome, 'reference' => $reference, 'message' => $message];
    }
}
