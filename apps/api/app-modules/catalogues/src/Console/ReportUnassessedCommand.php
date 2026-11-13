<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Console;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Console\Command;

/**
 * The dishes a release will take off sale, for the release notes.
 *
 * Published items only: anything else is not on sale to lose. Read-only, with no
 * `--fix`, because pressing "Assessed: contains none of these" is a statement
 * somebody has to make about the food.
 *
 * **No tenant context, across every kitchen.** `withoutTenancy()` lifts the
 * application scope, and the only row-level-secured tables behind the question are
 * read through `recipe_has_published_lines()`, so the answer is the same under the
 * runtime role as under the migrator.
 */
final class ReportUnassessedCommand extends Command
{
    protected $signature = 'catalogue:report-unassessed
        {--org= : Only this organisation, by slug. Every organisation when omitted}';

    protected $description = 'List the published catalogue items nobody has assessed for allergens. Changes nothing.';

    public function handle(): int
    {
        $query = CatalogueItem::withoutTenancy()
            ->where('status', CatalogueItemStatus::Published->value)
            ->whereNotIn('id', CatalogueItem::withoutTenancy()->allergensAssessed()->select('catalogue_items.id'));

        $slug = $this->option('org');

        if (is_string($slug) && $slug !== '') {
            $organisationId = Organisation::query()->where('slug', $slug)->value('id');

            if ($organisationId === null) {
                $this->components->error("No organisation has the slug [{$slug}].");

                return self::FAILURE;
            }

            $query->where('organisation_id', $organisationId);
        }

        $items = $query->orderBy('organisation_id')->orderBy('name_en')->get();

        /** @var array<string, string> $organisations */
        $organisations = Organisation::query()
            ->whereKey($items->pluck('organisation_id')->unique()->all())
            ->pluck('slug', 'id')
            ->all();

        if ($items->isNotEmpty()) {
            $this->table(
                ['Organisation', 'Item', 'Type', 'Slug', 'ID'],
                $items->map(static fn (CatalogueItem $item): array => [
                    $organisations[$item->organisation_id] ?? $item->organisation_id,
                    $item->name_en,
                    $item->item_type->value,
                    $item->slug,
                    (string) $item->getKey(),
                ])->all(),
            );
        }

        $this->line(sprintf('%d published item(s) not assessed for allergens.', $items->count()));

        return self::SUCCESS;
    }
}
