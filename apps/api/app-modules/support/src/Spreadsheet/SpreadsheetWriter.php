<?php

declare(strict_types=1);

namespace Healthy360\Support\Spreadsheet;

use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Writes one sheet — a bold header row, then the rows — to a temporary .xlsx
 * and answers it as a download that deletes itself once sent.
 *
 * Every string is written as text, never as a formula: openspout would
 * otherwise turn a value beginning with `=` into one, and a name somebody
 * typed must not execute in the spreadsheet of whoever exports it.
 */
final class SpreadsheetWriter
{
    /**
     * @param  list<string>  $headers
     * @param  iterable<list<string|int|float|null>>  $rows
     */
    public function download(string $filename, array $headers, iterable $rows): BinaryFileResponse
    {
        $path = (string) tempnam(sys_get_temp_dir(), 'h360-xlsx-');
        $writer = new Writer;

        try {
            $writer->openToFile($path);
            $writer->addRow($this->row($headers, new Style(fontBold: true)));

            foreach ($rows as $row) {
                $writer->addRow($this->row($row));
            }
        } finally {
            $writer->close();
        }

        return response()->download($path, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control' => 'no-store',
        ])->deleteFileAfterSend();
    }

    /**
     * @param  list<string|int|float|null>  $values
     */
    private function row(array $values, ?Style $style = null): Row
    {
        return new Row(array_map(
            static fn (string|int|float|null $value): Cell => is_string($value) && $value !== ''
                ? new StringCell($value, $style)
                : Cell::fromValue($value, $style),
            $values,
        ));
    }
}
