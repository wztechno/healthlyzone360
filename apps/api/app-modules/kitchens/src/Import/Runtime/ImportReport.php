<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Carbon\CarbonImmutable;

/**
 * Everything a run learned, accumulated as it goes and rendered twice: once to
 * the console for the operator watching, and once to a JSON file for the person
 * who has to answer a question about it three weeks later.
 *
 * **The report is the product.** A kitchen importer that prints "done, 412
 * rows" has told nobody anything: the interesting facts are that eleven
 * designations resolved to nothing, that five sheets label a per-kilo cost over
 * a piece count, that two ingredients carry an allergen contradiction the
 * source itself contains, and that the plan prices are placeholders because the
 * workbook has none. Those are the outputs a product owner signs off (master
 * plan v2, K1's next-phase gate); the row counts are how you check the run
 * finished.
 *
 * Six registers, kept apart because they are read by different people at
 * different times:
 *
 * - **counts** — created / skipped_existing / failed / would_create per entity.
 *   `skipped_existing` is the number that matters on a second run: it is the
 *   evidence that an operator's edits were not overwritten.
 * - **unresolved designations** — the raw-material names the curated dictionary
 *   does not cover. Each one costs a recipe line, and the list is the work item
 *   that closes the gap.
 * - **data-quality findings** — the 28-item ledger of appendix D, emitted as
 *   evidence rather than corrected.
 * - **allergen review** — the food-safety escalation. Separate from the quality
 *   findings on purpose: everything else on this page can wait, and this cannot.
 * - **quarantine** — what landed in `review_required`, and what came in flagged
 *   `requires_review` from the platform library.
 * - **known gaps** — what the source does not contain, stated so that a NULL in
 *   the database is never mistaken for a value nobody got round to typing.
 */
final class ImportReport
{
    /** @var array<string, array{created: int, skipped_existing: int, failed: int, would_create: int}> */
    private array $counts = [];

    /** @var array<string, array{designation: string, occurrences: list<string>, effect: string}> */
    private array $unresolved = [];

    /** @var list<array{code: string, detail: string, source_ref: string|null}> */
    private array $findings = [];

    /** @var list<array{code: string, detail: string, source_ref: string|null}> */
    private array $allergenReview = [];

    /** @var list<array{code: string, detail: string, source_ref: string|null}> */
    private array $quarantine = [];

    /** @var list<array{code: string, detail: string}> */
    private array $knownGaps = [];

    /** @var array<string, array{sheet: string, excluded_lines: list<string>}> */
    private array $incompleteSheets = [];

    /** @var list<array{file: string, sha256: string, bytes: int, changed_since_previous: bool|null}> */
    private array $manifest = [];

    private readonly CarbonImmutable $startedAt;

    private ?CarbonImmutable $finishedAt = null;

    public function __construct(
        private readonly ImportOptions $options,
        private readonly string $environment,
    ) {
        $this->startedAt = CarbonImmutable::now();
    }

    public function created(string $entity, int $times = 1): void
    {
        $this->bump($entity, $this->options->writes() ? 'created' : 'would_create', $times);
    }

    public function skipped(string $entity, int $times = 1): void
    {
        $this->bump($entity, 'skipped_existing', $times);
    }

    public function failed(string $entity, int $times = 1): void
    {
        $this->bump($entity, 'failed', $times);
    }

    /**
     * A raw-material designation the curated dictionary does not resolve.
     *
     * Recorded per designation with every place it occurs, rather than once per
     * occurrence: the work item is "decide what 'Demi Glace' is", and a list
     * repeating it four times makes a reviewer count instead of read.
     */
    public function unresolvedDesignation(string $designation, string $occurrence, string $effect): void
    {
        $key = mb_strtolower(trim($designation));

        $this->unresolved[$key] ??= ['designation' => $designation, 'occurrences' => [], 'effect' => $effect];

        if (! in_array($occurrence, $this->unresolved[$key]['occurrences'], true)) {
            $this->unresolved[$key]['occurrences'][] = $occurrence;
        }
    }

    public function finding(string $code, string $detail, ?string $sourceRef = null): void
    {
        $this->findings[] = ['code' => $code, 'detail' => $detail, 'source_ref' => $sourceRef];
    }

    /**
     * A parser's findings, in bulk.
     *
     * A finding that names its own source reference keeps it; the caller's is
     * the fallback, because a parser knows the sheet and the row and the writer
     * only knows the file.
     *
     * @param  list<array{code: string, detail: string, source_ref?: string|null}>  $findings
     */
    public function findings(array $findings, ?string $sourceRef = null): void
    {
        foreach ($findings as $finding) {
            $this->finding($finding['code'], $finding['detail'], $finding['source_ref'] ?? $sourceRef);
        }
    }

    public function allergenReviewItem(string $code, string $detail, ?string $sourceRef = null): void
    {
        $this->allergenReview[] = ['code' => $code, 'detail' => $detail, 'source_ref' => $sourceRef];
    }

    public function quarantineItem(string $code, string $detail, ?string $sourceRef = null): void
    {
        $this->quarantine[] = ['code' => $code, 'detail' => $detail, 'source_ref' => $sourceRef];
    }

    public function knownGap(string $code, string $detail): void
    {
        $this->knownGaps[] = ['code' => $code, 'detail' => $detail];
    }

    /**
     * A sheet that imported with lines missing. Flagged rather than abandoned:
     * §4.11's report-and-continue, and the deviation from fail-loudly-abort is
     * stated in the run's own output rather than only in a design document.
     */
    public function incompleteSheet(string $sheet, string $excludedLine): void
    {
        $this->incompleteSheets[$sheet] ??= ['sheet' => $sheet, 'excluded_lines' => []];
        $this->incompleteSheets[$sheet]['excluded_lines'][] = $excludedLine;
    }

    /**
     * @param  list<array{file: string, sha256: string, bytes: int, changed_since_previous: bool|null}>  $manifest
     */
    public function manifest(array $manifest): void
    {
        $this->manifest = $manifest;
    }

    public function finish(): void
    {
        $this->finishedAt = CarbonImmutable::now();
    }

    public function hasFailures(): bool
    {
        foreach ($this->counts as $entity) {
            if ($entity['failed'] > 0) {
                return true;
            }
        }

        return $this->unresolved !== [];
    }

    /**
     * @return array<string, array{created: int, skipped_existing: int, failed: int, would_create: int}>
     */
    public function countsSnapshot(): array
    {
        ksort($this->counts);

        return $this->counts;
    }

    public function countOf(string $entity, string $bucket): int
    {
        return $this->counts[$entity][$bucket] ?? 0;
    }

    /**
     * @return list<array{designation: string, occurrences: list<string>, effect: string}>
     */
    public function unresolvedSnapshot(): array
    {
        $rows = array_values($this->unresolved);

        usort($rows, static fn (array $a, array $b): int => strcmp($a['designation'], $b['designation']));

        return $rows;
    }

    /**
     * @return list<array{code: string, detail: string, source_ref: string|null}>
     */
    public function findingsSnapshot(): array
    {
        return $this->findings;
    }

    /**
     * @return list<array{code: string, detail: string, source_ref: string|null}>
     */
    public function allergenReviewSnapshot(): array
    {
        return $this->allergenReview;
    }

    /**
     * @return list<array{code: string, detail: string, source_ref: string|null}>
     */
    public function quarantineSnapshot(): array
    {
        return $this->quarantine;
    }

    /**
     * @return list<array{code: string, detail: string}>
     */
    public function knownGapsSnapshot(): array
    {
        return $this->knownGaps;
    }

    /**
     * @return list<array{sheet: string, excluded_lines: list<string>}>
     */
    public function incompleteSheetsSnapshot(): array
    {
        return array_values($this->incompleteSheets);
    }

    /**
     * The whole run as data. This is what is written to
     * storage/app/import-reports/<timestamp>.json and what a re-run reads back
     * to compare checksums.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'run' => [
                'started_at' => $this->startedAt->toIso8601String(),
                'finished_at' => $this->finishedAt?->toIso8601String(),
                'mode' => $this->options->mode(),
                'environment' => $this->environment,
                'source_directory' => $this->options->sourceDirectory,
                'organisation_slug' => $this->options->organisationSlug,
            ],
            'manifest' => $this->manifest,
            'counts' => $this->countsSnapshot(),
            'unresolved_designations' => $this->unresolvedSnapshot(),
            'incomplete_sheets' => $this->incompleteSheetsSnapshot(),
            'data_quality_findings' => $this->findings,
            'allergen_review' => $this->allergenReview,
            'quarantine' => $this->quarantine,
            'known_gaps' => $this->knownGaps,
        ];
    }

    private function bump(string $entity, string $bucket, int $times): void
    {
        $row = $this->counts[$entity] ?? ['created' => 0, 'skipped_existing' => 0, 'failed' => 0, 'would_create' => 0];

        $this->counts[$entity] = [
            'created' => $row['created'] + ($bucket === 'created' ? $times : 0),
            'skipped_existing' => $row['skipped_existing'] + ($bucket === 'skipped_existing' ? $times : 0),
            'failed' => $row['failed'] + ($bucket === 'failed' ? $times : 0),
            'would_create' => $row['would_create'] + ($bucket === 'would_create' ? $times : 0),
        ];
    }
}
