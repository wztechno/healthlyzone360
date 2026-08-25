<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\V6\V6CatalogueData;
use Healthy360\Kitchens\Import\V6\V6CatalogueWriter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Imports the committed v6 catalogue (sauces, dressings, meals, resale
 * products) into one kitchen organisation.
 *
 * Unlike `kitchen:import-workbook`, whose source is a folder of confidential
 * exports on an operator's disk, this command reads a **committed** document
 * (`app-modules/kitchens/database/data/v6-catalogue.json`) — names,
 * categories, allergens, coarse composition text and selling prices; no
 * costs, no formulation quantities. It is still environment-allowlisted and
 * audited, because it writes a whole catalogue into one organisation and
 * that is not something to do to production by accident.
 *
 * The organisation default is the command's own (`green-life-kitchen`, the
 * real kitchen) — deliberately NOT the shared `kitchens.import
 * .organisation_slug` config, so this command's default can never silently
 * redirect the legacy importer or vice versa.
 */
final class ImportV6CatalogueCommand extends Command
{
    protected $signature = 'kitchen:import-v6
        {--org=green-life-kitchen : The organisation slug to import into}
        {--source= : Override the committed v6-catalogue.json (used by tests)}
        {--dry-run : Do everything and roll it back; report what would be created}
        {--publish : After a writing import, activate B2C/B2B tariffs and publish ready items}';

    protected $description = 'Import the committed v6 catalogue (sauces, dressings, meals, resale products) into one kitchen organisation.';

    public function handle(V6CatalogueWriter $writer): int
    {
        $allowed = $this->allowedEnvironments();
        $environment = (string) $this->laravel->environment();

        if (! in_array($environment, $allowed, true)) {
            $this->components->error(sprintf('kitchen:import-v6 refuses to run in the "%s" environment.', $environment));
            $this->line('');
            $this->line('  It writes a whole catalogue into one organisation and is allowlisted to: '.implode(', ', $allowed).'.');
            $this->line('  Widen kitchens.import.environments (or KITCHEN_WORKBOOK_IMPORT_ENVIRONMENTS) deliberately if this');
            $this->line('  is genuinely the right place to run it.');

            return self::FAILURE;
        }

        $source = $this->stringOption('source');

        $options = new ImportOptions(
            sourceDirectory: $source ?? V6CatalogueData::committedPath(),
            organisationSlug: $this->stringOption('org') ?? 'green-life-kitchen',
            dryRun: (bool) $this->option('dry-run'),
            validateOnly: false,
        );

        $report = new ImportReport($options, $environment);

        $this->components->info(sprintf(
            'v6 catalogue import — mode: %s · organisation: %s · environment: %s',
            $options->mode(),
            $options->organisationSlug,
            $environment,
        ));
        $this->line('  Source: '.$options->sourceDirectory);
        $this->line('');

        $writer->auditStart($options);

        try {
            $writer->run($options, $report, $source);
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

        $writer->auditFinish($options, $report);

        if ($options->writes() && (bool) $this->option('publish')) {
            $this->line('');
            $this->components->info('Making imported items buyable…');

            $activate = $this->call('kitchen:activate-imported-tariffs', ['--org' => $options->organisationSlug]);

            if ($activate !== self::SUCCESS) {
                return self::FAILURE;
            }

            $publish = $this->call('kitchen:publish-ready', ['--org' => $options->organisationSlug]);

            if ($publish !== self::SUCCESS) {
                return self::FAILURE;
            }
        } elseif ($options->writes()) {
            $this->line('');
            $this->line('  Imported rows stay draft until tariffs are active and items pass readiness.');
            $this->line(sprintf('  Next: kitchen:activate-imported-tariffs --org=%s', $options->organisationSlug));
            $this->line(sprintf('        kitchen:publish-ready --org=%s', $options->organisationSlug));
            $this->line('  Or re-run with --publish.');
        }

        return self::SUCCESS;
    }

    private function render(ImportReport $report, ImportOptions $options): void
    {
        $this->line('');
        $this->line('── Counts '.str_repeat('─', 64));

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

        $rows === []
            ? $this->line('  (nothing — the run did not reach the write stage)')
            : $this->table(['Entity', 'Created', 'Would create', 'Skipped (existing)', 'Failed'], $rows);

        $this->listSection('Allergen review — READ THIS BEFORE PUBLISHING ANY LABEL', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->allergenReviewSnapshot(),
        ), 'nothing to escalate', error: true);

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
        $this->line('');
        $this->line('── '.$title.' ('.count($lines).') '.str_repeat('─', max(3, 60 - mb_strlen($title))));

        if ($lines === []) {
            $this->line('  '.$emptyMessage);

            return;
        }

        foreach ($lines as $line) {
            $error ? $this->components->warn('  · '.$line) : $this->line('  · '.$line);
        }
    }

    private function writeReport(ImportReport $report, ImportOptions $options): ?string
    {
        $directory = (string) config('kitchens.import.report_path', 'import-reports');
        $name = sprintf('%s/%s-v6-%s.json', $directory, now()->format('Ymd-His'), $options->mode());

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
