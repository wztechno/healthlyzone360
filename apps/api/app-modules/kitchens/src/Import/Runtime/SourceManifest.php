<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use RuntimeException;

/**
 * The five source files, their contents and their fingerprints.
 *
 * **Why checksums.** The workbook is edited by people, exported by hand and
 * carried around on a laptop. Two runs a month apart against "the same" folder
 * are routinely not the same folder, and the symptom of that — a re-run that
 * creates rows nobody expected, or one that skips rows somebody had just added
 * — is otherwise indistinguishable from an importer bug. Recording a sha256 per
 * file in the run report, and comparing against the previous report's, turns it
 * into a sentence: "Actual Data_Recipes.md changed since the run on 12 March".
 *
 * A changed file is a **warning, not a refusal**. Insert-if-absent is safe
 * against a changed source by construction: existing rows are left exactly as
 * they are, so a re-run against an edited workbook adds what is new and touches
 * nothing else. Refusing would be theatre — and would block the legitimate case
 * where somebody fixed a typo the last run reported.
 */
final readonly class SourceManifest
{
    public const string INGREDIENTS = 'Ingredients, Sauces & Dressings.md';

    public const string RECIPES = 'Actual Data_Recipes.md';

    public const string PRODUCTS = 'Actual Data_Product List.md';

    public const string PLANS = 'Meal Plan Structure (Revised).md';

    public const string CUSTOMERS = 'Customer Data Structure.md';

    /**
     * @param  array<string, string>  $contents  file name → raw markdown
     * @param  list<array{file: string, sha256: string, bytes: int, changed_since_previous: bool|null}>  $entries
     */
    private function __construct(
        private array $contents,
        private array $entries,
    ) {}

    /**
     * @return list<string>
     */
    public static function expectedFiles(): array
    {
        return [self::INGREDIENTS, self::RECIPES, self::PRODUCTS, self::PLANS, self::CUSTOMERS];
    }

    /**
     * Read and fingerprint the folder.
     *
     * A missing file **is** fatal, and this is the one place the importer keeps
     * fail-loudly-abort. A partial workbook produces a partial world — plans
     * with no products, recipes with no ingredients — and the counts would look
     * plausible. Better to refuse before the first write than to leave somebody
     * reconciling a half-imported kitchen.
     *
     * @param  array<string, string>  $previousChecksums  file name → sha256 from the last run's report
     *
     * @throws RuntimeException
     */
    public static function read(string $directory, array $previousChecksums = []): self
    {
        $directory = rtrim($directory, '/\\');
        $contents = [];
        $entries = [];
        $missing = [];

        foreach (self::expectedFiles() as $file) {
            $path = $directory.DIRECTORY_SEPARATOR.$file;
            $raw = is_file($path) ? file_get_contents($path) : false;

            if ($raw === false) {
                $missing[] = $file;

                continue;
            }

            $checksum = hash('sha256', $raw);
            $previous = $previousChecksums[$file] ?? null;

            $contents[$file] = $raw;
            $entries[] = [
                'file' => $file,
                'sha256' => $checksum,
                'bytes' => strlen($raw),
                'changed_since_previous' => $previous === null ? null : $previous !== $checksum,
            ];
        }

        if ($missing !== []) {
            throw new RuntimeException(sprintf(
                'The source folder [%s] is missing %d of the %d expected workbook exports: %s. '
                .'A partial workbook produces a partial world, so nothing is imported.',
                $directory,
                count($missing),
                count(self::expectedFiles()),
                implode(', ', $missing),
            ));
        }

        return new self($contents, $entries);
    }

    public function contentOf(string $file): string
    {
        return $this->contents[$file] ?? throw new RuntimeException("The source file [{$file}] was not read.");
    }

    /**
     * @return list<array{file: string, sha256: string, bytes: int, changed_since_previous: bool|null}>
     */
    public function entries(): array
    {
        return $this->entries;
    }

    /**
     * The files whose fingerprint differs from the previous run's.
     *
     * @return list<string>
     */
    public function changedFiles(): array
    {
        return array_values(array_map(
            static fn (array $entry): string => $entry['file'],
            array_filter($this->entries, static fn (array $entry): bool => $entry['changed_since_previous'] === true),
        ));
    }
}
