<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Kitchens\Import\Runtime\GreenLifeImport;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * The private GreenLife importer's front door (master plan v2 §4.11).
 *
 * A command rather than an endpoint, and that is a security decision as much as
 * an ergonomic one. The source is a folder of confidential workbook exports on
 * somebody's disk: there is no upload, no multipart body, no temporary file on a
 * shared volume and no HTTP surface an attacker could reach. The
 * `catalogue-import` limiter is registered for the import **API** a later phase
 * may add; nothing here consumes it, and the command says so rather than
 * pretending to be rate-limited.
 *
 * **Environment-allowlisted, and it refuses out loud.** `config('kitchens.import
 * .environments')` is `local,testing` by default. Running it anywhere else
 * prints why, names the environment it is in and the list it would have to be
 * in, and exits non-zero. A silent no-op would be worse than a refusal: an
 * operator would assume the import ran.
 *
 * **Audited at both ends**, with purpose of use `organisation_administration`.
 * The start event records the mode and the source folder; the finish event
 * records the counts and how many problems were found — never the problems
 * themselves, because an audit row is readable with `audit.view_organisation`
 * and would otherwise become a second, less guarded copy of the report.
 */
final class ImportGreenLifeCommand extends Command
{
    protected $signature = 'kitchen:import-greenlife
        {--source= : The folder holding the five workbook exports}
        {--dry-run : Do everything and roll it back; report what would be created}
        {--validate-only : Parse and report findings; never touch the database}
        {--org= : The organisation slug to import into (defaults to the configured one)}';

    protected $description = 'Import the private GreenLife workbook into one kitchen organisation.';

    public function handle(GreenLifeImport $import): int
    {
        $allowed = $this->allowedEnvironments();
        $environment = (string) $this->laravel->environment();

        if (! in_array($environment, $allowed, true)) {
            $this->components->error(sprintf(
                'kitchen:import-greenlife refuses to run in the "%s" environment.',
                $environment,
            ));
            $this->line('');
            $this->line('  This command reads confidential formulations, unit costs and supplier prices from a');
            $this->line('  folder on the operator\'s own disk and writes them into one organisation. It is');
            $this->line('  allowlisted to: '.implode(', ', $allowed).'.');
            $this->line('');
            $this->line('  Widen kitchens.import.environments (or GREENLIFE_IMPORT_ENVIRONMENTS) deliberately,');
            $this->line('  with a reviewer, if this is genuinely the right place to run it.');

            return self::FAILURE;
        }

        $source = $this->stringOption('source');

        if ($source === null) {
            $this->components->error('--source is required: the folder holding the five workbook exports.');

            return self::FAILURE;
        }

        $options = new ImportOptions(
            sourceDirectory: $source,
            organisationSlug: $this->stringOption('org') ?? (string) config('kitchens.import.organisation_slug', 'green-life-kitchen'),
            dryRun: (bool) $this->option('dry-run'),
            validateOnly: (bool) $this->option('validate-only'),
        );

        $report = new ImportReport($options, $environment);

        $this->components->info(sprintf(
            'GreenLife import — mode: %s · organisation: %s · environment: %s',
            $options->mode(),
            $options->organisationSlug,
            $environment,
        ));
        $this->line('  Source: '.$options->sourceDirectory);
        $this->line('');

        $import->auditStart($options);

        try {
            $import->run($options, $report);
        } catch (Throwable $exception) {
            $this->components->error('The import failed and nothing was written.');
            $this->line('  '.$exception->getMessage());

            return self::FAILURE;
        }

        $this->render($report, $options);

        $path = $this->writeReport($report, $options);

        if ($path !== null) {
            $this->line('');
            $this->components->info('Full report written to '.$path);
        }

        $import->auditFinish($options, $report);

        // A run with failures still exits zero: report-and-continue means a
        // failed line is an output, not a crash, and a non-zero exit would make
        // every CI wrapper treat a perfectly good import of 28 sheets as broken
        // because one spice is not in the dictionary yet. The failure counts and
        // the unresolved list are how a human decides.
        return self::SUCCESS;
    }

    private function render(ImportReport $report, ImportOptions $options): void
    {
        $this->section('Counts');

        $rows = [];

        foreach ($report->countsSnapshot() as $entity => $buckets) {
            $rows[] = [
                $entity,
                $options->writes() ? (string) $buckets['created'] : '—',
                $options->writes() ? '—' : (string) $buckets['would_create'],
                (string) $buckets['skipped_existing'],
                (string) $buckets['failed'],
            ];
        }

        if ($rows === []) {
            $this->line('  (nothing — the run did not reach the write stage)');
        } else {
            $this->table(['Entity', 'Created', 'Would create', 'Skipped (existing)', 'Failed'], $rows);
        }

        $this->section('Source manifest');

        foreach ($report->toArray()['manifest'] as $entry) {
            $this->line(sprintf(
                '  %-40s %s  %s',
                $entry['file'],
                substr($entry['sha256'], 0, 16).'…',
                match ($entry['changed_since_previous']) {
                    true => 'CHANGED since the last recorded run',
                    false => 'unchanged',
                    default => 'no previous run recorded',
                },
            ));
        }

        $this->listSection('Unresolved designations', array_map(
            static fn (array $row): string => sprintf(
                '%s — %s (%s)',
                $row['designation'],
                $row['effect'],
                implode(', ', $row['occurrences']),
            ),
            $report->unresolvedSnapshot(),
        ), 'every designation resolved');

        $this->listSection('Incomplete sheets', array_map(
            static fn (array $row): string => sprintf('%s — %d line(s) excluded: %s', $row['sheet'], count($row['excluded_lines']), implode('; ', $row['excluded_lines'])),
            $report->incompleteSheetsSnapshot(),
        ), 'no sheet lost a line');

        $this->listSection('Allergen review — READ THIS BEFORE PUBLISHING ANY LABEL', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->allergenReviewSnapshot(),
        ), 'nothing to escalate', error: true);

        $this->listSection('Data-quality findings', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->findingsSnapshot(),
        ), 'no findings');

        $this->listSection('Quarantine', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->quarantineSnapshot(),
        ), 'nothing quarantined');

        $this->listSection('Known gaps — what the source does not contain', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->knownGapsSnapshot(),
        ), 'no gaps recorded');
    }

    /**
     * @param  list<string>  $lines
     */
    private function listSection(string $title, array $lines, string $emptyMessage, bool $error = false): void
    {
        $this->section($title.' ('.count($lines).')');

        if ($lines === []) {
            $this->line('  '.$emptyMessage);

            return;
        }

        foreach ($lines as $line) {
            $error ? $this->components->warn('  · '.$line) : $this->line('  · '.$line);
        }
    }

    private function section(string $title): void
    {
        $this->line('');
        $this->line('── '.$title.' '.str_repeat('─', max(3, 72 - mb_strlen($title))));
    }

    /**
     * The JSON report, on the local disk under a gitignored path.
     *
     * A validate-only run writes one too: the whole point of that mode is to
     * hand somebody the findings, and "run it again and read the scrollback" is
     * not handing somebody anything.
     */
    private function writeReport(ImportReport $report, ImportOptions $options): ?string
    {
        $directory = (string) config('kitchens.import.report_path', 'import-reports');
        $name = sprintf('%s/%s-%s.json', $directory, now()->format('Ymd-His'), $options->mode());

        $json = json_encode($report->toArray(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($json === false) {
            $this->components->warn('The run report could not be serialised, so no JSON file was written.');

            return null;
        }

        Storage::disk('local')->put($name, $json);

        return Storage::disk('local')->path($name);
    }

    /**
     * @return list<string>
     */
    private function allowedEnvironments(): array
    {
        /** @var array<int, mixed> $allowed */
        $allowed = (array) config('kitchens.import.environments', ['local', 'testing']);

        return array_values(array_map(strval(...), $allowed));
    }

    private function stringOption(string $name): ?string
    {
        $value = $this->option($name);

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
