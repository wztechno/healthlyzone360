<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Services\RecipeListQuery;
use Healthy360\Recipes\Services\RecipeSpreadsheetService;
use Healthy360\Recipes\Services\RecipeSummaries;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Spreadsheet\SpreadsheetWriter;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * GET /api/v1/catalogue/recipes/export — the recipe book as a workbook, narrowed by the same
 * filters the list takes (and refused where the list refuses) — and GET …/import-template, the
 * headers and one example row (its route sets the `template` default).
 *
 * The whole filtered set, not a page: the export is what a kitchen edits and sends back.
 */
final class RecipeExportController
{
    public function __construct(
        private readonly RecipeListQuery $list,
        private readonly RecipeSummaries $summaries,
        private readonly RecipeSpreadsheetService $spreadsheet,
        private readonly SpreadsheetWriter $writer,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): BinaryFileResponse
    {
        if (($request->route()?->defaults['template'] ?? false) === true) {
            return $this->writer->download('recipes-import-template.xlsx', array_values(RecipeSpreadsheetService::HEADERS), $this->spreadsheet->templateRows());
        }

        $recipes = $this->list->filtered($request, $this->summaries->sellersVisible())
            ->orderBy('recipes.created_at')
            ->orderBy('recipes.id')
            ->get();

        return $this->writer->download(
            'recipes-'.now()->format('Y-m-d').'.xlsx',
            $this->spreadsheet->exportHeaders(),
            $this->spreadsheet->exportRows($recipes),
        );
    }
}
