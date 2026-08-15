<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * Whether anything has looked inside the file for malware.
 *
 * **Every document B1 stores is `not_scanned`**, and this enum exists so that
 * fact is in the data rather than only in a risk register. Sniffing the
 * leading bytes proves a PDF is a PDF; it proves nothing about what the PDF
 * contains, and a reviewer opening an attachment from a stranger deserves to
 * be told which of those two things has happened.
 *
 * `clean` and `infected` are declared and unreachable in this phase. That is
 * deliberate: the column's vocabulary is what the scanner integration
 * (INT-008) will fill in, and defining it now means the gate is a wiring job
 * rather than a migration. Nothing in B1 may present a document as safe.
 */
enum DocumentScanStatus: string
{
    case NotScanned = 'not_scanned';

    case Clean = 'clean';

    case Infected = 'infected';

    /**
     * Whether the platform has any basis for saying the file is safe to open.
     *
     * Only `clean` does — `not_scanned` is an absence of evidence and must
     * never be rendered as an absence of malware.
     */
    public function isKnownSafe(): bool
    {
        return $this === self::Clean;
    }
}
