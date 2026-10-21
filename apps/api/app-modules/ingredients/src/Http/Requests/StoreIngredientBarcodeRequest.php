<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Healthy360\Ingredients\Models\IngredientBarcode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for adding a barcode, on both of its routes.
 *
 * The catalogue route names the ingredient in its path and takes either origin.
 * The receiver's route (`/inventory/ingredient-barcodes`) names it in the body
 * and takes producer's codes only: a receiver links what is on the pack, and
 * minting kitchen codes stays with the catalogue.
 */
class StoreIngredientBarcodeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function atReceiving(): bool
    {
        return $this->route('ingredient') === null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $origins = $this->atReceiving()
            ? [IngredientBarcode::ORIGIN_SUPPLIER]
            : [IngredientBarcode::ORIGIN_SUPPLIER, IngredientBarcode::ORIGIN_SYSTEM];

        return [
            'ingredient_id' => $this->atReceiving() ? ['required', 'uuid'] : ['prohibited'],
            'origin' => [$this->atReceiving() ? 'nullable' : 'required', 'string', Rule::in($origins)],
            // Long enough for a GS1 Digital Link URL.
            'code' => ['required_unless:origin,system', 'prohibited_if:origin,system', 'string', 'max:512'],
            'symbology' => ['nullable', 'string', 'max:32'],
            // Four places, as the column holds: 0.00001 would round to a zero the CHECK refuses.
            'pack_quantity' => ['nullable', 'numeric', 'decimal:0,4', 'min:0.0001', 'max:9999999999'],
            'pack_unit_code' => ['nullable', 'string', Rule::exists('measurement_units', 'code')],
        ];
    }
}
