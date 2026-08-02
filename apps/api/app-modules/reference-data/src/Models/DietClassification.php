<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Models;

use Carbon\CarbonImmutable;
use Healthy360\ReferenceData\Database\Factories\DietClassificationFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * A diet pattern the platform recognises — the vocabulary a catalogue item is
 * tagged with and a customer filters by.
 *
 * A **preference filter, never a medical restriction**. What a dish contains
 * is its derived allergen set, computed from a published recipe version's
 * frozen label or from the item's own ingredient rows; a `gluten_free` tag
 * says the kitchen sells it as part of a gluten-free line. Nothing reads one
 * to answer the other.
 *
 * @property string $id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property int $display_order
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class DietClassification extends BaseModel
{
    /** @use HasFactory<DietClassificationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'display_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }
}
