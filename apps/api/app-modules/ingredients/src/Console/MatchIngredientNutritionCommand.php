<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Console;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Nutrition\NutritionReferenceService;
use Healthy360\Ingredients\Nutrition\ProviderUnavailable;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Contracts\Filesystem\FileNotFoundException;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use JsonException;

final class MatchIngredientNutritionCommand extends Command
{
    protected $signature = 'ingredients:match-nutrition {--org= : Organisation UUID or slug} {--write= : Export review JSON} {--apply= : Apply reviewed JSON}';

    protected $description = 'Review and apply USDA references for a tenant’s ingredients without nutrition.';

    public function handle(TenantContext $context, DatabaseTenantContext $database, NutritionReferenceService $references, IngredientCatalogueService $catalogue): int
    {
        $org = $this->option('org');
        $write = $this->option('write');
        $apply = $this->option('apply');
        if (! is_string($org) || $org === '' || (is_string($write) === is_string($apply))) {
            $this->error('Provide --org and exactly one of --write or --apply.');

            return self::FAILURE;
        }
        $organisation = Organisation::query()->where('slug', $org)->first();
        if ($organisation === null && Str::isUuid($org)) {
            $organisation = Organisation::query()->find($org);
        }
        if ($organisation === null) {
            $this->error('Organisation not found.');

            return self::FAILURE;
        }
        $id = (string) $organisation->getKey();
        $ambient = $context->toArray();
        try {
            return $database->during(null, $id, null, function () use ($context, $id, $write, $apply, $references, $catalogue): int {
                $context->restore(['user_id' => null, 'organisation_id' => $id, 'branch_id' => null]);
                if (is_string($write)) {
                    $rows = [];
                    foreach (Ingredient::query()->where('organisation_id', $id)->whereNull('nutrition_per_100g')->whereNull('nutrition_derived_from_version_id')->excludingPackaging()->orderBy('id')->cursor() as $ingredient) {
                        try {
                            $candidates = array_slice($references->search($ingredient->name_en), 0, 3);
                        } catch (ProviderUnavailable $exception) {
                            $this->error($exception->getMessage().' Export stopped; no review file was overwritten.');

                            return self::FAILURE;
                        }
                        $rows[] = ['organisation_id' => $id, 'ingredient_id' => (string) $ingredient->getKey(), 'ingredient_name' => $ingredient->name_en, 'lock_version' => $ingredient->lock_version, 'candidates' => $candidates, 'accept' => null, 'preparation_confirmed' => false];
                    }
                    if (File::put($write, json_encode(['version' => 1, 'organisation_id' => $id, 'rows' => $rows], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
                        $this->error('The review file could not be written.');

                        return self::FAILURE;
                    }
                    $this->info('Exported '.count($rows).' ingredients.');

                    return self::SUCCESS;
                }

                return $this->applyReview((string) $apply, $id, $catalogue);
            });
        } catch (JsonException|FileNotFoundException $exception) {
            $this->error('Invalid review file: '.$exception->getMessage());

            return self::FAILURE;
        } finally {
            $context->restore($ambient);
        }
    }

    private function applyReview(string $path, string $organisationId, IngredientCatalogueService $catalogue): int
    {
        $document = json_decode(File::get($path), true, flags: JSON_THROW_ON_ERROR);
        if (! is_array($document) || ($document['version'] ?? null) !== 1 || ($document['organisation_id'] ?? null) !== $organisationId || ! is_array($document['rows'] ?? null)) {
            $this->error('The review file structure or organisation is invalid.');

            return self::FAILURE;
        }
        $counts = ['applied' => 0, 'already_applied' => 0, 'rejected' => 0, 'stale' => 0, 'unprocessed' => 0, 'not_accepted' => 0];
        $outage = false;
        foreach ($document['rows'] as $row) {
            if (is_array($row) && ($row['organisation_id'] ?? null) === $organisationId && array_key_exists('accept', $row) && $row['accept'] === null) {
                $counts['not_accepted']++;
                $this->line((string) ($row['ingredient_id'] ?? '?').': not_accepted — No reference approved; left unchanged.');

                continue;
            }
            $status = 'rejected';
            $reason = 'Invalid or unaccepted review row.';
            if (is_array($row) && ($row['organisation_id'] ?? null) === $organisationId && is_string($row['ingredient_id'] ?? null) && Str::isUuid($row['ingredient_id']) && is_string($row['accept'] ?? null) && ($row['preparation_confirmed'] ?? false) === true && is_array($row['candidates'] ?? null) && is_int($row['lock_version'] ?? null)) {
                $candidate = collect($row['candidates'])->first(fn (mixed $candidate): bool => is_array($candidate) && ($candidate['ref'] ?? null) === $row['accept'] && ($candidate['suitable'] ?? false) === true);
                $ingredient = Ingredient::query()->where('organisation_id', $organisationId)->find($row['ingredient_id']);
                if (is_array($candidate) && is_string($candidate['source_hash'] ?? null) && $ingredient !== null) {
                    if (($ingredient->nutrition_source['ref'] ?? null) === $row['accept'] && ($ingredient->nutrition_source['source_hash'] ?? null) === $candidate['source_hash']) {
                        $status = 'already_applied';
                        $reason = 'Reference and hash already applied.';
                    } elseif ($ingredient->lock_version !== $row['lock_version']) {
                        $status = 'stale';
                        $reason = 'Edited since export.';
                    } elseif ($ingredient->nutrition_per_100g !== null || $ingredient->nutrition_derived_from_version_id !== null || ! Ingredient::query()->excludingPackaging()->whereKey($ingredient->getKey())->exists()) {
                        $reason = 'Ingredient is no longer eligible.';
                    } elseif ($outage) {
                        $status = 'unprocessed';
                        $reason = 'Provider unavailable; rerun this file later.';
                    } else {
                        try {
                            $catalogue->updatePublic($ingredient, ['nutrition_reference' => $row['accept'], 'nutrition_reference_hash' => $candidate['source_hash'], 'nutrition_reference_confirmed' => true], $row['lock_version'], fresh: true);
                            $status = 'applied';
                            $reason = 'Reviewed reference applied.';
                        } catch (ProviderUnavailable $exception) {
                            $status = 'unprocessed';
                            $reason = $exception->getMessage();
                            $outage = true;
                        } catch (ApiException $exception) {
                            $reason = $exception->getMessage();
                        }
                    }
                }
            }
            $counts[$status]++;
            $this->line((is_array($row) ? (string) ($row['ingredient_id'] ?? '?') : '?').': '.$status.' — '.$reason);
        }
        $this->line(json_encode($counts, JSON_THROW_ON_ERROR));

        return $counts['rejected'] + $counts['stale'] + $counts['unprocessed'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
