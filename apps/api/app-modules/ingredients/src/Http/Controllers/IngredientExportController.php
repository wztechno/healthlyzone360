<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Services\IngredientListQuery;
use Healthy360\Ingredients\Services\IngredientSpreadsheetService;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Spreadsheet\SpreadsheetWriter;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * GET /api/v1/catalogue/ingredients/export — the list as a workbook, narrowed and sorted by the
 * same query parameters the list takes — and GET …/import-template, the headers and one example
 * row (its route sets the `template` default).
 *
 * The whole filtered set, not a page: the export is what a kitchen edits and sends back.
 */
final class IngredientExportController
{
    public function __construct(
        private readonly IngredientListQuery $list,
        private readonly IngredientSpreadsheetService $spreadsheet,
        private readonly SpreadsheetWriter $writer,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): BinaryFileResponse
    {
        if (($request->route()?->defaults['template'] ?? false) === true) {
            return $this->writer->download('ingredients-import-template.xlsx', IngredientSpreadsheetService::HEADERS, $this->spreadsheet->templateRows());
        }

        $query = $this->list->filtered($request);
        $order = $this->list->ordering($request);

        if ($order !== null) {
            $order($query);
            $query->orderBy('ingredients.id');
        } else {
            $query->orderBy('ingredients.created_at')->orderBy('ingredients.id');
        }

        return $this->writer->download(
            'ingredients-'.now()->format('Y-m-d').'.xlsx',
            [...IngredientSpreadsheetService::HEADERS, ...IngredientSpreadsheetService::READ_ONLY_HEADERS],
            $this->spreadsheet->exportRows($query->get()),
        );
    }
}
