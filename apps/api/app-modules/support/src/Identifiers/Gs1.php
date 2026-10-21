<?php

declare(strict_types=1);

namespace Healthy360\Support\Identifiers;

use Carbon\CarbonImmutable;

/**
 * GS1 identifiers, read once for every module (ingredient barcodes, receiving,
 * production lots).
 *
 * {@see parse()} accepts every form a pack or a scanner produces:
 *
 * - bare digits — GTIN-8, UPC-A, EAN-13, GTIN-14, or an 8-digit UPC-E when the
 *   camera says the symbol was UPC-E;
 * - any AIM symbology prefix (`]E0`, `]C1`, `]d2`, …), stripped first;
 * - a raw GS1-128 / DataMatrix element string, with ASCII 29 separators or none;
 * - the human-readable `(01)…(10)…` line printed under the bars;
 * - a GS1 Digital Link URL: path `/01/<gtin>[/10/<lot>][/21/<serial>]`, AIs in
 *   the query.
 *
 * Every value is validated — a GTIN by its check digit, a date by a real month
 * and day, a lot by length and the GS1 character set — and an unknown AI, a bad
 * value or trailing data makes the whole scan unreadable. **A wrong value is
 * refused, never trimmed or matched to the nearest.**
 *
 * ## Boundaries are never guessed
 *
 * Parentheses, a group separator and a Digital Link path mark every boundary.
 * A raw scan with none of them is decodable only because GS1 puts the fixed-length
 * AIs first and the one variable-length AI last, and a scanner that dropped a
 * separator produces the same string: `10ABC17261130` is equally
 * `(10)ABC17261130` and `(10)ABC(17)261130`. So a variable-length field read to
 * the end of a separator-free scan is taken literally, to the end, **never
 * split**, and the scan says `boundaryVerified = false` for a person to check.
 */
final class Gs1
{
    /** ASCII 29, what a scanner sends in place of FNC1. */
    public const string GROUP_SEPARATOR = "\x1D";

    /** Fixed-length AIs and their data lengths; the 4-digit 31nn–36nn measures are 6 as well. */
    private const array FIXED_LENGTH = ['00' => 18, '01' => 14, '02' => 14, '11' => 6, '13' => 6, '15' => 6, '17' => 6];

    /** Variable-length AIs and their maximum lengths; 91–99 (company internal) run to 90. */
    private const array VARIABLE_LENGTH = ['10' => 20, '21' => 20, '37' => 8];

    private const array DATE_AIS = ['11', '13', '15', '17'];

    private const array CHECKED_AIS = ['00', '01', '02'];

    /** AIM symbology ids that carry GS1 element strings: GS1-128, DataMatrix, QR, DataBar, DotCode. */
    private const array GS1_AIM_IDS = [']C1', ']d2', ']Q3', ']e0', ']J1'];

    /** Camera symbologies that may carry a GS1 element string without saying so. */
    private const array GS1_CAMERA_SYMBOLOGIES = ['code128', 'datamatrix'];

    /** GS1 AI encodable character set 82. */
    public const string CSET_82 = '/^[!"%&\'()*+,\-.\/0-9:;<=>?A-Z_a-z]+$/';

    /**
     * The GS1 mod-10 check digit — weights 3, 1, 3, … from the right, so one
     * function serves any length.
     */
    public static function checkDigit(string $digits): int
    {
        $sum = 0;

        foreach (array_reverse(str_split($digits)) as $index => $digit) {
            $sum += (int) $digit * ($index % 2 === 0 ? 3 : 1);
        }

        return (10 - $sum % 10) % 10;
    }

    /**
     * @param  ?string  $symbology  the camera's symbol type (`upc_e`, `ean13`, …); a wedge scanner sends none
     */
    public static function parse(string $scan, ?string $symbology = null): ?Gs1Scan
    {
        $read = self::read($scan, $symbology);

        return $read instanceof Gs1Scan ? $read : null;
    }

    /**
     * Why {@see parse()} refused this scan — `check_digit` or `unreadable` — or
     * null when it did not.
     */
    public static function refusal(string $scan, ?string $symbology = null): ?string
    {
        $read = self::read($scan, $symbology);

        return is_string($read) ? $read : null;
    }

    /**
     * A GS1 `YYMMDD`: `YY` is 20YY, and a day of `00` is the month's last day.
     */
    public static function date(string $yymmdd): ?CarbonImmutable
    {
        if (preg_match('/^(\d{2})(\d{2})(\d{2})$/', $yymmdd, $parts) !== 1) {
            return null;
        }

        [$year, $month, $day] = [2000 + (int) $parts[1], (int) $parts[2], (int) $parts[3]];

        if ($month < 1 || $month > 12) {
            return null;
        }

        $first = CarbonImmutable::parse(sprintf('%04d-%02d-01', $year, $month));

        if ($day === 0) {
            return $first->endOfMonth()->startOfDay();
        }

        return checkdate($month, $day, $year) ? $first->setDay($day) : null;
    }

    /**
     * A code whose digits change from pack to pack: a GTIN-14 with indicator 9,
     * or a GTIN-13 from prefix 02 or 20–29 (weighed-item and in-store labels).
     */
    public static function isVariableMeasure(string $gtin): bool
    {
        return $gtin[0] === '9' || str_starts_with($gtin, '002') || str_starts_with($gtin, '02');
    }

    /**
     * A GTIN-13 from prefix 04 — GS1's Restricted Circulation Numbers, for use
     * inside one company. Padded to fourteen digits that is `004…`.
     */
    public static function isRestrictedCirculation(string $gtin): bool
    {
        return str_starts_with($gtin, '004');
    }

    private static function read(string $scan, ?string $symbology): Gs1Scan|string
    {
        $scan = trim($scan);
        $aim = preg_match('/^\][A-Za-z][0-9A-Za-z]/', $scan) === 1 ? substr($scan, 0, 3) : null;

        if ($aim !== null) {
            $scan = substr($scan, 3);
        }

        // A GS1 AIM id, or a leading FNC1 sent as a group separator, says this is an element
        // string: `]C115261130` is (15)261130, never an EAN-8 whose check digit fails.
        $elementString = in_array($aim, self::GS1_AIM_IDS, true) || str_starts_with($scan, self::GROUP_SEPARATOR);
        $scan = ltrim($scan, self::GROUP_SEPARATOR);

        if ($scan === '') {
            return 'unreadable';
        }

        if (preg_match('#^https?://#i', $scan) === 1) {
            return self::readDigitalLink($scan);
        }

        // A camera cannot say whether a Code 128 or DataMatrix symbol was the GS1 kind, so its
        // digits are read as an element string first and as a bare GTIN only when they are not one.
        if (in_array($symbology, self::GS1_CAMERA_SYMBOLOGIES, true) && ctype_digit($scan)) {
            $read = self::readRaw($scan);

            if ($read instanceof Gs1Scan) {
                return $read;
            }
        }

        if (! $elementString && ctype_digit($scan) && in_array(strlen($scan), [8, 12, 13, 14], true)) {
            $digits = strlen($scan) === 8 && $symbology === 'upc_e' ? self::expandUpcE($scan) : $scan;

            if ($digits === null) {
                return 'unreadable';
            }

            $gtin = str_pad($digits, 14, '0', STR_PAD_LEFT);
            $invalid = self::invalid('01', $gtin);

            return $invalid ?? new Gs1Scan($gtin, ['01' => $gtin], true);
        }

        return str_starts_with($scan, '(') ? self::readBracketed($scan) : self::readRaw($scan);
    }

    /**
     * The line printed under the bars. Every AI is in parentheses, so every
     * boundary is marked.
     */
    private static function readBracketed(string $scan): Gs1Scan|string
    {
        preg_match_all('/\((\d{2,4})\)([^()]*)/', $scan, $matches, PREG_SET_ORDER);

        if (implode('', array_column($matches, 0)) !== $scan) {
            return 'unreadable';
        }

        $elements = [];

        foreach ($matches as [, $ai, $value]) {
            if (self::lengthOf($ai) === null || isset($elements[$ai])) {
                return 'unreadable';
            }

            $elements[$ai] = $value;
        }

        return self::scan($elements, true);
    }

    private static function readRaw(string $scan): Gs1Scan|string
    {
        $elements = [];
        $verified = true;
        $hasSeparator = str_contains($scan, self::GROUP_SEPARATOR);
        $position = 0;

        while ($position < strlen($scan)) {
            $ai = substr($scan, $position, 2);

            if (preg_match('/^3[1-6]$/', $ai) === 1) {
                $ai = substr($scan, $position, 4);
            }

            $spec = self::lengthOf($ai);

            if ($spec === null || isset($elements[$ai])) {
                return 'unreadable';
            }

            [$length, $variable] = $spec;
            $start = $position + strlen($ai);

            if ($variable) {
                $end = strpos($scan, self::GROUP_SEPARATOR, $start);

                if ($end === false) {
                    $end = strlen($scan);
                    $verified = $verified && $hasSeparator;
                }

                $elements[$ai] = substr($scan, $start, $end - $start);
                $position = $end + 1;
            } else {
                $elements[$ai] = substr($scan, $start, $length);
                $position = $start + $length;

                if (($scan[$position] ?? '') === self::GROUP_SEPARATOR) {
                    $position++;
                }
            }
        }

        return self::scan($elements, $verified);
    }

    private static function readDigitalLink(string $url): Gs1Scan|string
    {
        $parts = parse_url($url);

        if ($parts === false
            || preg_match('#/01/(\d{8}|\d{12,14})(?:/10/([^/?]+))?(?:/21/([^/?]+))?/?$#', $parts['path'] ?? '', $path) !== 1) {
            return 'unreadable';
        }

        $elements = ['01' => str_pad($path[1], 14, '0', STR_PAD_LEFT)];

        foreach (['10' => 2, '21' => 3] as $ai => $group) {
            if (($path[$group] ?? '') !== '') {
                $elements[$ai] = rawurldecode($path[$group]);
            }
        }

        parse_str($parts['query'] ?? '', $query);

        foreach ($query as $key => $value) {
            $key = (string) $key;

            // Non-AI parameters (linkType, context, …) are the resolver's business.
            if (! ctype_digit($key)) {
                continue;
            }

            if (! is_string($value) || self::lengthOf($key) === null || isset($elements[$key])) {
                return 'unreadable';
            }

            $elements[$key] = $value;
        }

        return self::scan($elements, true);
    }

    /**
     * @param  array<int|string, string>  $elements  AI => value; PHP keeps `10` as an int key
     */
    private static function scan(array $elements, bool $verified): Gs1Scan|string
    {
        foreach ($elements as $ai => $value) {
            // PHP turns a numeric-string key such as '10' into an int.
            $invalid = self::invalid((string) $ai, $value);

            if ($invalid !== null) {
                return $invalid;
            }
        }

        return new Gs1Scan($elements['01'] ?? null, $elements, $verified);
    }

    /**
     * Data length and whether it varies, for an AI this parser knows.
     *
     * @return ?array{int, bool}
     */
    private static function lengthOf(string $ai): ?array
    {
        return match (true) {
            isset(self::FIXED_LENGTH[$ai]) => [self::FIXED_LENGTH[$ai], false],
            isset(self::VARIABLE_LENGTH[$ai]) => [self::VARIABLE_LENGTH[$ai], true],
            preg_match('/^9[1-9]$/', $ai) === 1 => [90, true],
            preg_match('/^3[1-6]\d\d$/', $ai) === 1 => [6, false],
            default => null,
        };
    }

    /**
     * Why a value is not a valid one for its AI, or null when it is.
     */
    private static function invalid(string $ai, string $value): ?string
    {
        [$length, $variable] = self::lengthOf($ai) ?? [0, false];

        if ($variable) {
            $valid = strlen($value) <= $length
                && preg_match($ai === '37' ? '/^\d+$/' : self::CSET_82, $value) === 1;

            return $valid ? null : 'unreadable';
        }

        if (strlen($value) !== $length || ! ctype_digit($value)) {
            return 'unreadable';
        }

        if (in_array($ai, self::CHECKED_AIS, true) && self::checkDigit(substr($value, 0, -1)) !== (int) $value[-1]) {
            return 'check_digit';
        }

        return in_array($ai, self::DATE_AIS, true) && self::date($value) === null ? 'unreadable' : null;
    }

    /**
     * UPC-E's eight digits to the UPC-A they stand for (number system 0 or 1).
     */
    private static function expandUpcE(string $digits): ?string
    {
        if ($digits[0] !== '0' && $digits[0] !== '1') {
            return null;
        }

        [$d1, $d2, $d3, $d4, $d5, $d6] = str_split(substr($digits, 1, 6));

        $body = match ($d6) {
            '0', '1', '2' => $d1.$d2.$d6.'0000'.$d3.$d4.$d5,
            '3' => $d1.$d2.$d3.'00000'.$d4.$d5,
            '4' => $d1.$d2.$d3.$d4.'00000'.$d5,
            default => $d1.$d2.$d3.$d4.$d5.'0000'.$d6,
        };

        return $digits[0].$body.$digits[7];
    }
}
