<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Parsers;

use Healthy360\Kitchens\Import\Support\Numeric;
use Healthy360\Kitchens\Import\Support\SheetReader;

/**
 * The sellable product list: 64 rows, two channels, and a pack column that is
 * really four columns wearing one hat.
 *
 * The sheet is a single table — product, kind, category, the two units, then
 * a weight and a price for business customers and again for consumers. Almost
 * every hard decision in this parser comes from the same place: the "weight"
 * cells are free text a human wrote, and they encode a pack *size*, a pack
 * *format*, a *piece count* and sometimes two whole packs at once, in any
 * combination. `0.5 kg/1 kg` at `5.5-10` is two products with two prices;
 * `1 bag (10 piece) 1 KG` is one product described three ways; `1 Gallon
 * (5 L)` states a container and a volume and no mass at all.
 *
 * **A pack is only ever what the cell says.** `net_weight_grams` is filled in
 * when the label states a mass and left null otherwise, so a gallon stays a
 * gallon rather than becoming 3,780 grams of something whose density nobody
 * wrote down. The conversion the operator will eventually need is in the
 * comment column of four rows (`3.78 L`, `10 Kg`, `3 Kg`) and is reported as
 * a `purchasing_usage_unit_mismatch` finding with the comment quoted, because
 * a purchasing unit of Gallon against a usage unit of Kg is a real conversion
 * the platform has to be told about — not one it may infer.
 *
 * **Typos are evidence.** `Supllier`, `Diary`, `Pesto Saue` and `Americain`
 * are kept exactly as typed in `kind_verbatim`, `category_verbatim` and
 * `product`, with the normalised reading beside them, and each raises a
 * `source_typo` finding. The normalisation is this parser's opinion; the
 * spelling is the source's fact, and an importer that silently corrected it
 * would destroy the only signal a reviewer has that the two sheets naming
 * "Pesto Saue" and "Pesto Sauce" might be the same product.
 *
 * **Three price cells do not hold prices, and each is handled differently.**
 * "Depends on each day" is a market-priced product. It produces a price row
 * per pack with a **null** amount and the status `market_priced`, carrying
 * the cell's own wording in `note` — never a zero, which would have made
 * vegetables free. The row exists rather than being omitted because the
 * channel is the information: `is_market_priced` says the product is priced
 * daily and says nothing about whether that is true of the business list, the
 * consumer list or both, and the writer has to put the row on one tariff.
 * "Not applicable" is different and produces nothing at all — that is a
 * channel the source declined, not one it prices daily. One B2B cell holds
 * pack text where a number belongs, which produces no price and a
 * `price_cell_is_pack_text` finding. And one dual-pack row carries a single
 * price, which is applied to the larger pack only — pricing a half-kilogram
 * bag at the full kilogram's price would be a fabricated discount, and
 * leaving both unpriced would drop a product the kitchen sells.
 *
 * @phpstan-type Finding array{code:string, detail:string, source_ref:?string}
 * @phpstan-type Pack array{code:string, label:string, quantity:numeric-string|null, unit:?string, piece_count:?int, format:?string, net_weight_grams:?int}
 * @phpstan-type Price array{channel:'b2b'|'b2c', pack_code:?string, amount_minor:?int, status:'confirmed'|'market_priced', note:?string}
 * @phpstan-type ProductRow array{row:int, product:string, kind:?string, kind_verbatim:?string, category_code:?string, category_verbatim:?string, purchasing_unit:?string, usage_unit:?string, is_market_priced:bool, is_assorted:bool, member_designations:list<string>, packs:list<Pack>, prices:list<Price>, comments:?string, flags:list<string>}
 */
final class ProductListParser
{
    /**
     * Column positions. The sheet has one header row and never varies, but
     * the names are here so that the reads below say what they mean.
     */
    private const int COL_PRODUCT = 0;

    private const int COL_KIND = 1;

    private const int COL_CATEGORY = 2;

    private const int COL_PURCHASING_UNIT = 3;

    private const int COL_USAGE_UNIT = 4;

    private const int COL_B2B_WEIGHT = 5;

    private const int COL_B2B_PRICE = 6;

    private const int COL_B2C_WEIGHT = 7;

    private const int COL_B2C_PRICE = 8;

    private const int COL_COMMENTS = 9;

    /**
     * Source spelling, folded, to the platform's kind.
     *
     * @var array<string, string>
     */
    private const array KINDS = [
        'production' => 'production',
        'supplier' => 'supplier',
        'supllier' => 'supplier',
        'supplier & production' => 'both',
        'supplier and production' => 'both',
        'production & supplier' => 'both',
    ];

    /**
     * Source category, folded, to the platform product-category code. Folding
     * is what absorbs `Frozen ` with its trailing space; `diary` is here
     * because the source misspells dairy and the row still has to land in the
     * right category.
     *
     * @var array<string, string>
     */
    private const array CATEGORIES = [
        'poultry' => 'poultry',
        'meat' => 'meat',
        'frozen' => 'frozen',
        'sauce' => 'sauce',
        'toppings' => 'toppings',
        'oil' => 'oil',
        'condiment' => 'condiment',
        'bread' => 'bread',
        'diary' => 'dairy',
        'dairy' => 'dairy',
        'vegetables' => 'vegetables',
    ];

    /**
     * The misspellings this workbook is known to contain. Recorded, never
     * repaired — see the class docblock.
     *
     * @var list<string>
     */
    private const array KNOWN_TYPOS = ['Supllier', 'Diary', 'Pesto Saue', 'Americain'];

    /**
     * Container nouns that make a pack a pack rather than a loose weight.
     *
     * @var list<string>
     */
    private const array FORMATS = ['bottle', 'bag', 'can', 'gallon', 'bunch'];

    /**
     * What a unit measures. Two units in different rows of this table are a
     * conversion the platform is not told; two in the same row are one it has
     * to be. Anything absent from the list — the source's `kg or piece` — is
     * unknown, and an unknown makes no claim either way.
     *
     * @var array<string, string>
     */
    private const array UNIT_DIMENSIONS = [
        'kg' => 'mass',
        'kgs' => 'mass',
        'k' => 'mass',
        'g' => 'mass',
        'gr' => 'mass',
        'gram' => 'mass',
        'grams' => 'mass',
        'l' => 'volume',
        '1 l' => 'volume',
        'lt' => 'volume',
        'ltr' => 'volume',
        'litre' => 'volume',
        'liter' => 'volume',
        'piece' => 'count',
        'pieces' => 'count',
        'pc' => 'count',
        'gallon' => 'container',
        'can' => 'container',
        'bag' => 'container',
        'bunch' => 'container',
        'bottle' => 'container',
        'box' => 'container',
    ];

    /**
     * @return array{rows: list<ProductRow>, findings: list<Finding>}
     */
    public static function parse(string $markdown): array
    {
        /** @var list<ProductRow> $rows */
        $rows = [];
        /** @var list<Finding> $findings */
        $findings = [];

        foreach (SheetReader::sheets($markdown) as $sheet) {
            $started = false;
            $number = 0;

            foreach ($sheet['rows'] as $row) {
                if (SheetReader::isMergedBanner($row)) {
                    continue;
                }

                if (! $started) {
                    // The header row is the gate: everything above it is the
                    // export's decoration, everything below is a product.
                    $started = SheetReader::fold($row[0] ?? '') === 'product';

                    continue;
                }

                if (($row[self::COL_PRODUCT] ?? '') === '') {
                    continue;
                }

                $parsed = self::parseRow(++$number, $row);

                $rows[] = $parsed['row'];
                $findings = array_merge($findings, $parsed['findings']);
            }
        }

        return ['rows' => $rows, 'findings' => $findings];
    }

    /**
     * @param  list<string>  $cells
     * @return array{row: ProductRow, findings: list<Finding>}
     */
    private static function parseRow(int $number, array $cells): array
    {
        $product = $cells[self::COL_PRODUCT] ?? '';
        $kindVerbatim = SheetReader::cell($cells, self::COL_KIND);
        $categoryVerbatim = SheetReader::cell($cells, self::COL_CATEGORY);
        $purchasingUnit = SheetReader::cell($cells, self::COL_PURCHASING_UNIT);
        $usageUnit = SheetReader::cell($cells, self::COL_USAGE_UNIT);
        $comments = SheetReader::cell($cells, self::COL_COMMENTS);

        /** @var list<Finding> $findings */
        $findings = [];
        /** @var list<string> $flags */
        $flags = [];

        $kind = $kindVerbatim === null ? null : (self::KINDS[SheetReader::fold($kindVerbatim)] ?? null);

        if ($kindVerbatim !== null && $kind === null) {
            $findings[] = self::finding('kind_unmapped', $product, sprintf(
                'Row %d "%s" is of kind "%s", which is neither Production, Supplier nor Supplier & Production, so no kind was assigned.',
                $number,
                $product,
                $kindVerbatim,
            ));
        }

        $categoryCode = $categoryVerbatim === null ? null : (self::CATEGORIES[SheetReader::fold($categoryVerbatim)] ?? null);

        if ($categoryVerbatim !== null && $categoryCode === null) {
            $findings[] = self::finding('category_unmapped', $product, sprintf(
                'Row %d "%s" is in category "%s", which matches no platform product category, so the row was left uncategorised.',
                $number,
                $product,
                $categoryVerbatim,
            ));
        }

        $findings = array_merge($findings, self::typoFindings($number, $product, $kindVerbatim, $categoryVerbatim));
        $findings = array_merge($findings, self::unitMismatchFindings($number, $product, $purchasingUnit, $usageUnit, $comments));

        $assorted = self::assortment($product);

        /** @var list<Pack> $packs */
        $packs = [];
        /** @var list<Price> $prices */
        $prices = [];
        $marketPriced = false;

        foreach ([['b2b', self::COL_B2B_WEIGHT, self::COL_B2B_PRICE], ['b2c', self::COL_B2C_WEIGHT, self::COL_B2C_PRICE]] as [$channel, $weightAt, $priceAt]) {
            /** @var 'b2b'|'b2c' $channel */
            $channelResult = self::parseChannel(
                $channel,
                $number,
                $product,
                SheetReader::cell($cells, $weightAt),
                SheetReader::cell($cells, $priceAt),
            );

            $packs = array_merge($packs, $channelResult['packs']);
            $prices = array_merge($prices, $channelResult['prices']);
            $findings = array_merge($findings, $channelResult['findings']);
            $flags = array_merge($flags, $channelResult['flags']);
            $marketPriced = $marketPriced || $channelResult['market_priced'];
        }

        return [
            'row' => [
                'row' => $number,
                'product' => $product,
                'kind' => $kind,
                'kind_verbatim' => $kindVerbatim,
                'category_code' => $categoryCode,
                'category_verbatim' => $categoryVerbatim,
                'purchasing_unit' => $purchasingUnit,
                'usage_unit' => $usageUnit,
                'is_market_priced' => $marketPriced,
                'is_assorted' => $assorted['is_assorted'],
                'member_designations' => $assorted['members'],
                'packs' => self::uniquePacks($packs),
                'prices' => $prices,
                'comments' => $comments,
                'flags' => array_values(array_unique($flags)),
            ],
            'findings' => $findings,
        ];
    }

    /**
     * One channel's packs and prices, and everything that went wrong doing it.
     *
     * @param  'b2b'|'b2c'  $channel
     * @return array{packs: list<Pack>, prices: list<Price>, findings: list<Finding>, flags: list<string>, market_priced: bool}
     */
    private static function parseChannel(string $channel, int $number, string $product, ?string $weightText, ?string $priceText): array
    {
        $label = strtoupper($channel);
        /** @var list<Finding> $findings */
        $findings = [];
        /** @var list<string> $flags */
        $flags = [];
        /** @var list<Price> $prices */
        $prices = [];

        // "Not applicable" is the source declining a channel, which is a
        // decision and not a gap. It produces no pack, no price and no
        // "something is missing" finding — only the flag that records it.
        if ($weightText !== null && SheetReader::fold($weightText) === 'not applicable') {
            return ['packs' => [], 'prices' => [], 'findings' => [], 'flags' => ['channel_not_offered'], 'market_priced' => false];
        }

        $packs = self::parsePacks($weightText);

        if ($priceText !== null && preg_match('/depends/i', $priceText) === 1) {
            // One row per pack, with a null amount. The row's existence is what
            // names the channel: `is_market_priced` on the product says the
            // thing is priced daily and cannot say whether that is true of the
            // business list, the consumer list or both, and the writer has to
            // put it on one tariff. A pack-less channel still gets one row so
            // the channel is not lost.
            $marketPacks = $packs === [] ? [null] : $packs;

            return [
                'packs' => $packs,
                'prices' => array_map(
                    static fn (?array $pack): array => [
                        'channel' => $channel,
                        'pack_code' => $pack['code'] ?? null,
                        'amount_minor' => null,
                        'status' => 'market_priced',
                        'note' => $priceText,
                    ],
                    $marketPacks,
                ),
                'findings' => [],
                'flags' => ['market_priced'],
                'market_priced' => true,
            ];
        }

        if ($priceText === null) {
            $findings[] = self::finding(strtolower($channel).'_price_missing', $product, sprintf(
                'Row %d "%s" states no %s price and does not say the channel is not applicable, so it is neither offered nor declined.',
                $number,
                $product,
                $label,
            ));

            return ['packs' => $packs, 'prices' => [], 'findings' => $findings, 'flags' => ['price_missing'], 'market_priced' => false];
        }

        $segments = self::priceSegments($priceText);

        if ($segments === null) {
            $findings[] = self::finding('price_cell_is_pack_text', $product, sprintf(
                'Row %d "%s" has "%s" in the %s price column, which describes a pack rather than an amount, so no %s price was read.',
                $number,
                $product,
                $priceText,
                $label,
                $label,
            ));

            return ['packs' => $packs, 'prices' => [], 'findings' => $findings, 'flags' => ['price_cell_is_pack_text'], 'market_priced' => false];
        }

        if (count($packs) !== count($segments) && $packs !== []) {
            $findings[] = self::finding('dual_pack_single_price', $product, sprintf(
                'Row %d "%s" states %d %s pack(s) and %d price(s) (%s). %s',
                $number,
                $product,
                count($packs),
                $label,
                count($segments),
                $priceText,
                count($packs) === 2 && count($segments) === 1
                    ? 'The single price is applied to the larger pack only; the smaller pack is left unpriced rather than given a price nobody wrote.'
                    : 'Prices are aligned to packs by position as far as they go.',
            ));

            $flags[] = 'dual_pack_single_price';
        }

        // Two packs and one price is the sheet quoting the headline size. The
        // last pack is the larger one in every dual pack in this workbook,
        // which is written smaller-first.
        $offset = count($packs) === 2 && count($segments) === 1 ? 1 : 0;

        foreach ($segments as $position => $amount) {
            $pack = $packs[$position + $offset] ?? null;
            $minor = self::minorUnits($amount);

            if ($minor['rounded']) {
                $findings[] = self::finding('price_sub_cent_rounded', $product, sprintf(
                    'Row %d "%s" states a %s price of %s, which is not a whole number of cents; it was rounded to %d.',
                    $number,
                    $product,
                    $label,
                    $amount,
                    $minor['amount'],
                ));
            }

            $prices[] = [
                'channel' => $channel,
                'pack_code' => $pack['code'] ?? null,
                'amount_minor' => $minor['amount'],
                'status' => 'confirmed',
                'note' => $offset === 1
                    ? 'The row states one price for two packs; it is recorded against the larger pack.'
                    : null,
            ];
        }

        return ['packs' => $packs, 'prices' => $prices, 'findings' => $findings, 'flags' => $flags, 'market_priced' => false];
    }

    /**
     * The packs a weight cell describes: one, or two when it holds a slash.
     *
     * @return list<Pack>
     */
    private static function parsePacks(?string $weightText): array
    {
        if ($weightText === null) {
            return [];
        }

        /** @var list<Pack> $packs */
        $packs = [];

        foreach (explode('/', $weightText) as $segment) {
            $label = trim($segment);

            if ($label === '') {
                continue;
            }

            $packs[] = self::parsePack($label);
        }

        return $packs;
    }

    /**
     * @return Pack
     */
    private static function parsePack(string $label): array
    {
        preg_match('/^\s*([\d.,]+)\s*([A-Za-z.]+)/', $label, $leading);

        $quantity = isset($leading[1]) ? Numeric::parse($leading[1]) : null;
        $unit = $leading[2] ?? null;

        $pieceCount = preg_match('/(\d+)\s*pieces?\b/i', $label, $pieces) === 1 ? (int) $pieces[1] : null;

        return [
            'code' => self::packCode($label),
            'label' => $label,
            'quantity' => $quantity,
            'unit' => $unit,
            'piece_count' => $pieceCount,
            'format' => self::packFormat($label, $unit),
            'net_weight_grams' => self::netWeightGrams($label),
        ];
    }

    /**
     * A stable identifier for a pack, derived from its own label.
     *
     * A parenthetical that names nothing but the format is dropped first, so
     * `300 g (bottle)` becomes `300-g`: the format already has a field of its
     * own and repeating it in the code buys nothing. A parenthetical that
     * carries a *number* stays, because `1 Bag (6 Piece)` and `1 Bag (10
     * piece)` are two different packs and a code that could not tell them
     * apart would merge them.
     */
    private static function packCode(string $label): string
    {
        $withoutFormat = (string) preg_replace('/\(\s*(?:'.implode('|', self::FORMATS).')\s*\)/i', '', $label);

        // `0.5kg` and `0.5 kg` are the same bag written two ways — the source
        // does both, sometimes in one cell — and two codes would be two packs.
        $spaced = (string) preg_replace('/(?<=\d)(?=[A-Za-z])|(?<=[A-Za-z])(?=\d)/', '-', $withoutFormat);
        $slug = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', $spaced));

        return trim($slug, '-');
    }

    private static function packFormat(string $label, ?string $unit): string
    {
        if (preg_match('/\(\s*('.implode('|', self::FORMATS).')\s*\)/i', $label, $matches) === 1) {
            return strtolower($matches[1]);
        }

        $noun = strtolower(rtrim($unit ?? '', '.'));

        if (in_array($noun, self::FORMATS, true)) {
            return $noun;
        }

        // Not "unknown": the cell says loose weight, and a nullable format
        // would leave the caller unable to tell "no container" from "the cell
        // did not say".
        return 'loose';
    }

    /**
     * Grams, but only when the label writes a mass.
     *
     * Volumes are refused on purpose. `1 Gallon (5 L)` states five litres of
     * a liquid whose density is nowhere in this workbook, and a parser that
     * answered "5000 grams" would be inventing the density of sriracha.
     */
    private static function netWeightGrams(string $label): ?int
    {
        if (preg_match('/(\d+(?:[.,]\d+)?)\s*(kgs?|kilograms?|kilos?|grams?|gr|g)\b/i', $label, $matches) !== 1) {
            return null;
        }

        $amount = Numeric::parse($matches[1]);

        if ($amount === null) {
            return null;
        }

        $multiplier = str_starts_with(strtolower($matches[2]), 'k') ? '1000' : '1';

        return (int) bcadd(bcmul($amount, $multiplier, 6), '0.5', 0);
    }

    /**
     * The amounts in a price cell, or null when the cell holds something that
     * is not a price at all.
     *
     * `5.5-10` and `5.5/10` are both "two packs, two prices" — the sheet uses
     * the two separators interchangeably, and neither is a range.
     *
     * @return list<numeric-string>|null
     */
    private static function priceSegments(string $priceText): ?array
    {
        /** @var list<numeric-string> $amounts */
        $amounts = [];

        foreach (preg_split('#[-/]#', $priceText) ?: [] as $segment) {
            $amount = Numeric::parse($segment);

            if ($amount === null) {
                return null;
            }

            $amounts[] = $amount;
        }

        return $amounts === [] ? null : $amounts;
    }

    /**
     * Dollars to cents, exactly, in the string domain.
     *
     * @param  numeric-string  $amount
     * @return array{amount:int, rounded:bool}
     */
    private static function minorUnits(string $amount): array
    {
        $scaled = bcmul($amount, '100', 6);
        $truncated = bcadd($scaled, '0', 0);

        return [
            'amount' => (int) bcadd($scaled, '0.5', 0),
            'rounded' => bccomp($scaled, $truncated, 6) !== 0,
        ];
    }

    /**
     * Is this cell one product, or a shorthand for a shelf full of them?
     *
     * The source lists all its fresh vegetables on one row, ending in an
     * ellipsis and `( All Kinds)`. The members are split out so the caller can
     * decide what to do with them; the ellipsis is honest about the list being
     * incomplete, and it is dropped from the names but not from the fact that
     * the row is an assortment.
     *
     * The trailing punctuation has to come off here rather than in whatever
     * resolves these names, because the source writes `Coriander….` — an
     * ellipsis *and* a full stop — and a resolver that matched exactly, which
     * is the right way to match a food name, would fail to find "Coriander."
     * and drop a vegetable the kitchen sells.
     *
     * @return array{is_assorted:bool, members:list<string>}
     */
    private static function assortment(string $product): array
    {
        $allKinds = preg_match('/\(\s*all\s+kinds\s*\)/i', $product) === 1;

        /** @var list<string> $parts */
        $parts = [];

        foreach (explode(',', $product) as $part) {
            $withoutQualifier = (string) preg_replace('/\([^)]*\)/u', '', $part);
            $cleaned = (string) preg_replace('/^[\s.·…]+|[\s.·…]+$/u', '', $withoutQualifier);

            if ($cleaned !== '') {
                $parts[] = $cleaned;
            }
        }

        $isAssorted = $allKinds || count($parts) >= 3;

        return ['is_assorted' => $isAssorted, 'members' => $isAssorted ? $parts : []];
    }

    /**
     * @return list<Finding>
     */
    private static function typoFindings(int $number, string $product, ?string $kind, ?string $category): array
    {
        /** @var list<Finding> $findings */
        $findings = [];

        foreach (self::KNOWN_TYPOS as $typo) {
            $where = match (true) {
                SheetReader::fold($kind) === SheetReader::fold($typo) => 'the kind column',
                SheetReader::fold($category) === SheetReader::fold($typo) => 'the category column',
                str_contains(SheetReader::fold($product), SheetReader::fold($typo)) => 'the product name',
                default => null,
            };

            if ($where === null) {
                continue;
            }

            $findings[] = self::finding('source_typo', $product, sprintf(
                'Row %d "%s" spells "%s" in %s. The spelling is kept verbatim as evidence of what the source says rather than corrected.',
                $number,
                $product,
                $typo,
                $where,
            ));
        }

        return $findings;
    }

    /**
     * @return list<Finding>
     */
    private static function unitMismatchFindings(int $number, string $product, ?string $purchasing, ?string $usage, ?string $comments): array
    {
        $purchasingDimension = self::UNIT_DIMENSIONS[SheetReader::fold($purchasing)] ?? null;
        $usageDimension = self::UNIT_DIMENSIONS[SheetReader::fold($usage)] ?? null;

        if ($purchasingDimension === null || $usageDimension === null || $purchasingDimension === $usageDimension) {
            return [];
        }

        return [self::finding('purchasing_usage_unit_mismatch', $product, sprintf(
            'Row %d "%s" is purchased in %s (%s) and used in %s (%s). %s',
            $number,
            $product,
            (string) $purchasing,
            $purchasingDimension,
            (string) $usage,
            $usageDimension,
            $comments === null
                ? 'The row states no conversion between the two.'
                : sprintf('The comment column reads "%s", which is everything the source says about the conversion.', $comments),
        ))];
    }

    /**
     * Two channels often quote the same pack. One pack, listed once.
     *
     * @param  list<Pack>  $packs
     * @return list<Pack>
     */
    private static function uniquePacks(array $packs): array
    {
        /** @var array<string, Pack> $unique */
        $unique = [];

        foreach ($packs as $pack) {
            $unique[$pack['code']] ??= $pack;
        }

        return array_values($unique);
    }

    /**
     * @return Finding
     */
    private static function finding(string $code, ?string $sourceRef, string $detail): array
    {
        return ['code' => $code, 'detail' => $detail, 'source_ref' => $sourceRef];
    }
}
