<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientBarcode;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Identifiers\Gs1;
use Healthy360\Support\Identifiers\Gs1Scan;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Every write to `ingredient_barcodes`, and the one read a scanner needs
 * (docs/requirements/ingredient-barcodes-plan.md §3–§4).
 *
 * - **Link** a producer's code: any GTIN-8/12/13/14 a pack carries, normalised
 *   to fourteen digits, refused when its digits change from pack to pack or
 *   when it sits in the `04` kitchen range.
 * - **Generate** a kitchen code: `04` + a never-decreasing per-organisation
 *   counter + check digit. Never `MAX(gtin) + 1` — deleting the highest code
 *   would then hand its number, already printed on a label, to the next
 *   ingredient.
 * - **Remove** one.
 * - **Resolve** a scan to its link, or to nothing.
 *
 * A barcode on a platform ingredient is legal: the row is the kitchen's own.
 * Forking an ingredient does not move its barcodes (plan §2.5) — the fork gets
 * a new, empty shelf while the stock stays on the source's, so moving them
 * would steer scans away from the stock.
 *
 * Audit metadata says `gtin`, never `barcode`: the recorder redacts any key
 * containing `code`.
 */
final readonly class IngredientBarcodeService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private UnitConversionService $units,
    ) {}

    /**
     * The kitchen code for counter value `$number`, padded to fourteen digits.
     * The first is `00400000000015`, printed `0400000000015`.
     */
    public static function kitchenGtin(int $number): string
    {
        $body = '04'.str_pad((string) $number, 10, '0', STR_PAD_LEFT);

        return '0'.$body.Gs1::checkDigit($body);
    }

    /**
     * Link a producer's code to this ingredient.
     *
     * @throws ApiException
     */
    public function link(
        Ingredient $ingredient,
        string $code,
        ?string $symbology,
        ?string $packQuantity,
        ?string $packUnitCode,
        bool $atReceiving = false,
    ): IngredientBarcode {
        $gtin = (string) $this->read($code, $symbology)->gtin;

        if (Gs1::isRestrictedCirculation($gtin)) {
            throw $this->invalid('reserved');
        }

        [$quantity, $unitId] = $this->pack($ingredient, $packQuantity, $packUnitCode);

        $this->assertFree($gtin);

        try {
            $barcode = DB::transaction(fn (): IngredientBarcode => $this->create(
                $ingredient,
                $gtin,
                IngredientBarcode::ORIGIN_SUPPLIER,
                $quantity,
                $unitId,
            ));
        } catch (UniqueConstraintViolationException) {
            // Somebody linked it between the check and the write.
            $this->assertFree($gtin);

            throw new ApiException(ErrorCode::BarcodeTaken);
        }

        $this->record('catalogue.ingredient_barcode_linked', $barcode, ['via' => $atReceiving ? 'receiving' : 'catalogue']);

        return $barcode;
    }

    /**
     * This ingredient's kitchen code, minted if it has none. Idempotent: the
     * second element is false when the code already existed.
     *
     * @return array{IngredientBarcode, bool}
     *
     * @throws ApiException
     */
    public function generate(Ingredient $ingredient, ?string $packQuantity, ?string $packUnitCode): array
    {
        $existing = $this->kitchenCodeOf($ingredient);

        if ($existing instanceof IngredientBarcode) {
            return [$existing, false];
        }

        [$quantity, $unitId] = $this->pack($ingredient, $packQuantity, $packUnitCode);
        $organisationId = (string) $this->context->organisationId();

        try {
            $barcode = DB::transaction(function () use ($ingredient, $organisationId, $quantity, $unitId): IngredientBarcode {
                // One statement: the row lock serialises concurrent mints, and the
                // value only climbs, so a deleted code's number is never reissued.
                $counter = DB::selectOne(
                    'INSERT INTO ingredient_barcode_counters (organisation_id, last_value) VALUES (?, 1)
                     ON CONFLICT (organisation_id) DO UPDATE SET last_value = ingredient_barcode_counters.last_value + 1
                     RETURNING last_value',
                    [$organisationId],
                    false,
                );

                return $this->create(
                    $ingredient,
                    self::kitchenGtin((int) $counter->last_value),
                    IngredientBarcode::ORIGIN_SYSTEM,
                    $quantity,
                    $unitId,
                );
            });
        } catch (UniqueConstraintViolationException $exception) {
            // A concurrent generate for the same ingredient won; its code is the answer.
            $existing = $this->kitchenCodeOf($ingredient);

            if ($existing instanceof IngredientBarcode) {
                return [$existing, false];
            }

            throw $exception;
        }

        $this->record('catalogue.ingredient_barcode_generated', $barcode);

        return [$barcode, true];
    }

    public function remove(IngredientBarcode $barcode): void
    {
        $barcode->delete();

        $this->record('catalogue.ingredient_barcode_removed', $barcode);
    }

    /**
     * What a scan says, and which ingredient in this kitchen holds its GTIN.
     * A readable code nobody has linked resolves to no link; a kitchen code that
     * was deleted is one of those, and still says it is a kitchen code.
     *
     * @return array{Gs1Scan, ?IngredientBarcode}
     *
     * @throws ApiException
     */
    public function resolve(string $code, ?string $symbology): array
    {
        $scan = $this->read($code, $symbology);

        $link = IngredientBarcode::query()
            ->with(['ingredient', 'packUnit'])
            ->where('gtin', $scan->gtin)
            ->first();

        return [$scan, $link];
    }

    /**
     * A scan that names one product, or a refusal saying why it does not.
     *
     * @throws ApiException
     */
    private function read(string $code, ?string $symbology): Gs1Scan
    {
        $scan = Gs1::parse($code, $symbology);

        if (! $scan instanceof Gs1Scan) {
            throw $this->invalid(Gs1::refusal($code, $symbology) ?? 'unreadable');
        }

        if ($scan->gtin === null) {
            throw $this->invalid('not_a_product_code');
        }

        if (Gs1::isVariableMeasure($scan->gtin)) {
            throw $this->invalid('variable_measure');
        }

        return $scan;
    }

    private function invalid(string $reason): ApiException
    {
        $message = match ($reason) {
            'check_digit' => 'One of the digits is wrong: the check digit does not match. Scan it again or retype it.',
            'variable_measure' => 'This is a weighed-item or price label, and its number changes with every pack. Pick the item and type the weight instead.',
            'reserved' => 'Codes starting 04 are kitchen codes. Make a kitchen barcode instead.',
            'not_a_product_code' => 'This scan carries no product code. Scan the product barcode on the pack.',
            default => 'This scan could not be read. Scan it again, or type the digits under the bars.',
        };

        return new ApiException(ErrorCode::BarcodeInvalid, $message, ['reason' => $reason]);
    }

    /**
     * "One scan = this much", stored as entered. The unit is the ingredient's
     * default unit unless one is named, and must convert to it; a package unit
     * (bag, can, pack) is a container, not a measure, and is refused.
     *
     * @return array{numeric-string|null, ?string} quantity and unit id
     *
     * @throws ApiException
     */
    private function pack(Ingredient $ingredient, ?string $quantity, ?string $unitCode): array
    {
        if ($quantity === null || ! is_numeric($quantity)) {
            if ($unitCode !== null) {
                throw new ApiException(ErrorCode::ValidationFailed, details: ['fields' => ['pack_quantity' => ['A pack unit needs a pack quantity.']]]);
            }

            return [null, null];
        }

        $default = $ingredient->defaultUnit;
        $unit = $unitCode === null ? $default : MeasurementUnit::query()->where('code', $unitCode)->first();

        if (! $unit instanceof MeasurementUnit
            || ! $default instanceof MeasurementUnit
            || $unit->dimension === 'package'
            || ! $this->units->canConvert($unit, $default)) {
            throw new ApiException(ErrorCode::ValidationFailed, details: ['fields' => ['pack_unit_code' => [
                'A pack size must be in the ingredient\'s own unit or one that converts to it; a bag, can or pack is not a measure.',
            ]]]);
        }

        return [$quantity, (string) $unit->getKey()];
    }

    /**
     * @throws ApiException naming the ingredient that holds the code
     */
    private function assertFree(string $gtin): void
    {
        $holder = IngredientBarcode::query()->with('ingredient')->where('gtin', $gtin)->first();

        if (! $holder instanceof IngredientBarcode) {
            return;
        }

        throw new ApiException(ErrorCode::BarcodeTaken, details: [
            'ingredient_id' => $holder->ingredient_id,
            'name_en' => $holder->ingredient?->name_en,
            'name_ar' => $holder->ingredient?->name_ar,
        ]);
    }

    private function kitchenCodeOf(Ingredient $ingredient): ?IngredientBarcode
    {
        return IngredientBarcode::query()
            ->with('packUnit')
            ->where('ingredient_id', $ingredient->getKey())
            ->where('origin', IngredientBarcode::ORIGIN_SYSTEM)
            ->first();
    }

    /**
     * @param  numeric-string|null  $quantity
     */
    private function create(Ingredient $ingredient, string $gtin, string $origin, ?string $quantity, ?string $unitId): IngredientBarcode
    {
        $barcode = new IngredientBarcode;
        $barcode->ingredient_id = (string) $ingredient->getKey();
        $barcode->gtin = $gtin;
        $barcode->origin = $origin;
        $barcode->pack_quantity = $quantity;
        $barcode->pack_unit_id = $unitId;
        $barcode->created_by = $this->context->userId();
        $barcode->save();

        return $barcode->load('packUnit');
    }

    /**
     * @param  array<string, string>  $extra
     */
    private function record(string $action, IngredientBarcode $barcode, array $extra = []): void
    {
        $this->audit->record(
            $action,
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: $barcode->ingredient_id,
            metadata: [
                'gtin' => $barcode->gtin,
                'origin' => $barcode->origin,
                'ingredient_id' => $barcode->ingredient_id,
                'pack_quantity' => $barcode->pack_quantity,
            ] + $extra,
        );
    }
}
