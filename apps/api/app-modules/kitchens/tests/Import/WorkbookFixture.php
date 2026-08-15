<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Tests\Import;

use RuntimeException;

/**
 * Reads the synthetic mini-workbook the import tests run against.
 *
 * Every test in this directory drives its parser from these five files and
 * never from the private workbook. That is not only a confidentiality rule —
 * although it is that, and the real files are not in this repository and must
 * not be — it is what makes the assertions worth writing. A test written
 * against the real sheets could only assert what those sheets happen to
 * contain today; the fixture is built to contain one instance of every quirk
 * the parsers claim to handle, so a rule that stops working fails a test
 * instead of quietly producing a slightly wrong import.
 */
final class WorkbookFixture
{
    public const string INGREDIENTS = 'Ingredients, Sauces & Dressings.md';

    public const string RECIPES = 'Actual Data_Recipes.md';

    public const string PRODUCTS = 'Actual Data_Product List.md';

    public const string MEAL_PLANS = 'Meal Plan Structure (Revised).md';

    public const string CUSTOMERS = 'Customer Data Structure.md';

    public static function read(string $name): string
    {
        $path = dirname(__DIR__).'/Fixtures/workbook/'.$name;

        if (! is_file($path)) {
            throw new RuntimeException("The workbook fixture [{$name}] is missing from tests/Fixtures/workbook.");
        }

        return (string) file_get_contents($path);
    }
}
