<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;

/**
 * The workbook's allergen wording, mapped onto the fourteen canonical codes.
 *
 * A closed table with no fallback. An allergen class the workbook names and
 * this map does not know is reported unmapped and dropped — never guessed at,
 * never fuzzily matched onto the nearest code. The whole point of a code-keyed
 * regulatory vocabulary (§4.6) is that "Cereals/Gluten" and `gluten` are the
 * same identity by decision rather than by resemblance.
 *
 * Two of the workbook's own markers survive the mapping, because they carry
 * information the code alone cannot:
 *
 * - **`*` — coconut.** A tree nut under United States law and not an EU
 *   allergen at all. It maps to `tree_nut` with market scope `us_only`, so an
 *   EU label does not acquire a nut warning the regulation does not ask for and
 *   a US one does not lose one it does.
 * - **`~` — sulphites.** The workbook's own note is "possible in vinegar, dried
 *   fruit, pickles, molasses — verify per supplier". That is not a
 *   determination; it is a question. It maps to `sulphites` with verification
 *   status `requires_supplier_confirmation`, which is the state that says
 *   exactly that.
 */
final class AllergenClassMap
{
    /**
     * Workbook wording (lower-cased, whitespace-collapsed, markers stripped) →
     * canonical allergen code.
     *
     * @var array<string, string>
     */
    private const array CODES = [
        'milk' => 'milk',
        'eggs' => 'egg',
        'egg' => 'egg',
        'fish' => 'fish',
        'crustaceans' => 'crustaceans',
        'molluscs' => 'mollusc',
        'tree nuts' => 'tree_nut',
        'peanuts' => 'peanut',
        'sesame' => 'sesame',
        'cereals/gluten' => 'gluten',
        'cereals / gluten' => 'gluten',
        'gluten' => 'gluten',
        'soybeans' => 'soy',
        'soya' => 'soy',
        'mustard' => 'mustard',
        'celery' => 'celery',
        'sulphites' => 'sulphites',
        'lupin' => 'lupin',
    ];

    /**
     * Resolve one class as the workbook wrote it.
     *
     * @return array{code: string, market_scope: AllergenMarketScope, verification_status: AllergenVerificationStatus, verbatim: string}|null
     */
    public static function resolve(string $verbatim): ?array
    {
        $trimmed = trim($verbatim);
        $usOnly = str_contains($trimmed, '*');
        $verify = str_contains($trimmed, '~');

        $bare = trim(str_replace(['*', '~'], '', $trimmed));
        $key = mb_strtolower((string) preg_replace('/\s+/u', ' ', $bare));

        if ($key === '' || $key === 'none' || $key === '—' || $key === '-') {
            return null;
        }

        $code = self::CODES[$key] ?? null;

        if ($code === null) {
            return null;
        }

        return [
            'code' => $code,
            'market_scope' => $usOnly ? AllergenMarketScope::UsOnly : AllergenMarketScope::All,
            'verification_status' => $verify
                ? AllergenVerificationStatus::RequiresSupplierConfirmation
                : AllergenVerificationStatus::Unverified,
            'verbatim' => $trimmed,
        ];
    }

    /**
     * Whether the workbook's wording is its way of saying "no regulated
     * allergen", which is a statement and not a silence — and is therefore
     * reported rather than skipped.
     */
    public static function isExplicitNone(string $verbatim): bool
    {
        return mb_strtolower(trim(str_replace(['*', '~'], '', $verbatim))) === 'none';
    }
}
