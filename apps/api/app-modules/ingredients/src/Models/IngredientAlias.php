<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Database\Factories\IngredientAliasFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Another name an ingredient answers to.
 *
 * The normalised form is written here, in a `saving` hook, rather than by
 * every call site: a designation lookup that misses because one writer forgot
 * to lower-case is an unresolved-ingredient report nobody can explain.
 *
 * @property string $id
 * @property string $ingredient_id
 * @property string $alias
 * @property string $alias_normalised
 * @property string|null $locale
 * @property string|null $source_system
 * @property string|null $source_ref
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::Internal, 'alias', 'alias_normalised')]
class IngredientAlias extends BaseModel
{
    /** @use HasFactory<IngredientAliasFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected static function booted(): void
    {
        static::saving(function (self $alias): void {
            $alias->alias = trim($alias->alias);
            $alias->alias_normalised = self::normalise($alias->alias);
        });
    }

    /**
     * Lower-cased, trimmed, internal whitespace collapsed to single spaces.
     * Deliberately conservative: it does not strip punctuation, transliterate
     * or stem, because "Paprika Sweet" and "Paprika Smoked" are different
     * ingredients and an over-eager normaliser would merge them (risk R4).
     */
    public static function normalise(string $alias): string
    {
        $collapsed = preg_replace('/\s+/u', ' ', trim($alias));

        return mb_strtolower($collapsed ?? trim($alias));
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }
}
