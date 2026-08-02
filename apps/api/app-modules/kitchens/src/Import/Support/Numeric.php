<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Support;

/**
 * Reading a number out of a spreadsheet cell without ever becoming a float.
 *
 * Everything downstream of this class — line costs, yields, pack weights,
 * prices in minor units — is decimal arithmetic done with bcmath on strings
 * (master plan v2 §4.4, and see `RecipeCostingService` for the same rule
 * applied to storage). A parser that returned `float` would undo that in its
 * very first step: `(float) '0.9220'` is not `0.9220`, and by the time the
 * value reached bcmath it would already carry a binary rounding error that no
 * amount of later precision can remove. So every reading here is a
 * **numeric string**, produced by string surgery only.
 *
 * Three consequences of that decision are worth stating, because they look
 * like bugs until you know they are deliberate.
 *
 * 1. **Trailing zeros survive.** `0.9220` comes back as `"0.9220"`, not
 *    `"0.922"`. The workbook writes a yield to four places when the kitchen
 *    weighs to four places, and that is information about the measurement,
 *    not noise. bcmath does not care, and the import report can quote the
 *    cell back to a human exactly as they typed it.
 * 2. **Scientific notation is expanded, not evaluated.** The source contains
 *    `2E-3` in four sheets — Excel's rendering of a small quantity somebody
 *    typed as `0.002`. It is expanded by moving the decimal point through the
 *    digit string, so `2E-3` becomes `"0.002"` and `1.5E2` becomes `"150"`
 *    with no floating-point step anywhere in between. The caller still gets a
 *    `scientific_notation` finding, because a cell that renders as `2E-3` in
 *    a printed technical sheet is a transcription hazard whether or not this
 *    class reads it correctly.
 * 3. **`-0` is never returned.** Negative zero is a float concept that has no
 *    business in a decimal ledger, and `bccomp('-0', '0')` being `0` while
 *    `'-0' !== '0'` is exactly the kind of difference that makes two reports
 *    disagree. A zero is a zero, written without a sign.
 *
 * What is *not* accepted is as important as what is. A cell holding `-`, an
 * em dash, prose, or a comma in a position where it cannot be a thousands
 * separator returns `null` rather than a guess. The caller then has a blank
 * it can report, instead of a number nobody wrote.
 */
final class Numeric
{
    /**
     * Cells that mean "deliberately empty" in this workbook. The dashes are
     * the source's own way of saying "no allergen source" and "no value";
     * treating them as unparseable prose would be technically true and
     * practically useless, because the caller would then be unable to tell a
     * blank apart from a mangled number.
     *
     * @var list<string>
     */
    private const array BLANK_MARKERS = ['', '-', '--', '—', '–', 'n/a', 'na'];

    /**
     * A plain decimal, with or without a sign, in either of the two shapes
     * Excel emits (`12`, `12.`, `12.5`, `.5`).
     */
    private const string DECIMAL = '/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/';

    /**
     * The same, followed by an exponent, captured in the four pieces the
     * expansion needs: sign, integer digits, fraction digits, exponent.
     */
    private const string SCIENTIFIC = '/^([+-]?)(?=[\d.]*\d)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/';

    /**
     * Digits grouped in threes by commas, and only that. `1,234.5` is a
     * thousands separator; `1,5` is somebody's decimal comma or a typo, and
     * stripping the comma there would silently turn one and a half into
     * fifteen. The narrow pattern is the whole point.
     */
    private const string THOUSANDS = '/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/';

    /**
     * The number a cell holds, as a string bcmath can use, or null.
     *
     * Tolerated decoration, in the order it is removed: any whitespace
     * (including the non-breaking spaces Excel exports leave behind), a
     * leading `US$` or `$`, a trailing `%`, and comma thousands separators.
     * A trailing percent sign is dropped rather than divided by a hundred:
     * the only percentages in this workbook are waste coefficients written
     * as `3%`, and the caller wants the `3`.
     *
     * @return numeric-string|null
     */
    public static function parse(?string $cell): ?string
    {
        $value = self::clean($cell);

        if ($value === null) {
            return null;
        }

        if (preg_match(self::SCIENTIFIC, $value, $exponent) === 1) {
            return self::canonicalise(self::expandExponent($exponent));
        }

        if (preg_match(self::DECIMAL, $value) !== 1) {
            return null;
        }

        return self::canonicalise($value);
    }

    /**
     * Does this cell hold a number at all?
     *
     * Deliberately defined as "`parse()` would return something", so that a
     * caller can never find a cell this method calls numeric and `parse()`
     * calls null.
     */
    public static function isNumericCell(?string $cell): bool
    {
        return self::parse($cell) !== null;
    }

    /**
     * Was the number *written* in exponent form?
     *
     * Separate from `parse()` because the two questions have different
     * answers for the same cell: `2E-3` parses perfectly well and is still
     * worth a finding, since the person reading the printed sheet sees an
     * exponent where a quantity in kilograms should be.
     */
    public static function isScientific(?string $cell): bool
    {
        $value = self::clean($cell);

        return $value !== null && preg_match(self::SCIENTIFIC, $value) === 1;
    }

    /**
     * Trim a numeric string down to its shortest equal form, for use in
     * prose.
     *
     * Only ever used to build the sentence a human reads in a finding —
     * never to produce a value. `0.480000000000` from a twelve-place bcmath
     * multiplication reads as noise in "0.08 x 6 = 0.480000000000"; the
     * stored values keep every digit the source wrote.
     *
     * @param  numeric-string  $value
     */
    public static function forDisplay(string $value): string
    {
        if (! str_contains($value, '.')) {
            return $value;
        }

        $trimmed = rtrim(rtrim($value, '0'), '.');

        return $trimmed === '' || $trimmed === '-' ? '0' : $trimmed;
    }

    /**
     * Strip the decoration and reject the deliberate blanks, or null.
     */
    private static function clean(?string $cell): ?string
    {
        if ($cell === null) {
            return null;
        }

        // Unicode-aware, because Excel exports carry U+00A0 between the digit
        // groups of numbers a human formatted by hand.
        $value = (string) preg_replace('/[\p{Z}\s]+/u', '', $cell);

        if (in_array(mb_strtolower($value), self::BLANK_MARKERS, true)) {
            return null;
        }

        foreach (['US$', 'USD', '$'] as $prefix) {
            if (str_starts_with($value, $prefix)) {
                $value = substr($value, strlen($prefix));

                break;
            }
        }

        if (str_ends_with($value, '%')) {
            $value = substr($value, 0, -1);
        }

        if (preg_match(self::THOUSANDS, $value) === 1) {
            $value = str_replace(',', '', $value);
        }

        return $value === '' ? null : $value;
    }

    /**
     * Move the decimal point through the digits, the way you would on paper.
     *
     * `2E-3` is the digit string `2` with the point three places to the left
     * of where it sits; `1.5E2` is `15` with the point two places to the
     * right. Nothing is multiplied or divided, so nothing can be rounded.
     *
     * Takes the match rather than the cell, so that the pattern is applied
     * exactly once — the caller has already had to run it to know this is an
     * exponent at all, and a second application here would be a second place
     * for the two to drift apart.
     *
     * @param  array{0:string, 1:string, 2:string, 3:string, 4:string}  $matches
     */
    private static function expandExponent(array $matches): string
    {
        $sign = $matches[1] === '-' ? '-' : '';
        $integer = $matches[2];
        $fraction = $matches[3];
        $digits = $integer.$fraction;
        $point = strlen($integer) + (int) $matches[4];

        if ($point <= 0) {
            return $sign.'0.'.str_repeat('0', -$point).$digits;
        }

        if ($point >= strlen($digits)) {
            return $sign.ltrim($digits.str_repeat('0', $point - strlen($digits)), '0');
        }

        return $sign.ltrim(substr($digits, 0, $point), '0').'.'.substr($digits, $point);
    }

    /**
     * The last tidy-up: an explicit `+` removed, a bare leading or trailing
     * point given its zero, and a signed zero unsigned.
     *
     * The final `is_numeric` is not defensive theatre. It is the one place
     * that guarantees the promise in this class's return type, and bcmath's
     * failure mode is why it matters: handed a string it cannot read, bcmath
     * returns **zero** rather than raising, so a value that slipped through
     * here would not blow up downstream — it would quietly make an ingredient
     * free. A cell that survives the patterns above and still is not a number
     * is read as no number at all, which is what `parse()` already means by
     * null.
     *
     * @return numeric-string|null
     */
    private static function canonicalise(string $value): ?string
    {
        $negative = str_starts_with($value, '-');
        $digits = ltrim($value, '+-');

        if (str_starts_with($digits, '.')) {
            $digits = '0'.$digits;
        }

        if (str_ends_with($digits, '.')) {
            $digits = substr($digits, 0, -1);
        }

        if ($digits === '') {
            $digits = '0';
        }

        // A zero written with a minus is still a zero. See the class docblock.
        if (rtrim(str_replace('.', '', $digits), '0') === '') {
            $negative = false;
        }

        $result = ($negative ? '-' : '').$digits;

        return is_numeric($result) ? $result : null;
    }
}
