<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\Parsers\IngredientWorkbookParser;
use Healthy360\Kitchens\Tests\Import\WorkbookFixture;

/*
|--------------------------------------------------------------------------
| Sauces, dressings and the allergen markers that carry a market rule
|--------------------------------------------------------------------------
|
| The asterisk on "Tree nuts*" and the tilde on "Sulphites~" are the reason
| this file exists. They mean, respectively, "a US allergen but not an EU one"
| and "possible above the labelling threshold — verify per supplier", and a
| parser that trimmed either would hand the platform a class that reads as
| settled and is not. So the markers are asserted character by character.
|
*/

beforeEach(function (): void {
    $this->parsed = IngredientWorkbookParser::parse(WorkbookFixture::read(WorkbookFixture::INGREDIENTS));
    $this->findings = collect($this->parsed['findings']);
});

it('files each row by its own identifier rather than by which sheet it sits on', function (): void {
    expect($this->parsed['master'])->toHaveCount(4)
        ->and($this->parsed['sauces'])->toHaveCount(4)
        ->and($this->parsed['dressings'])->toHaveCount(2)
        ->and($this->parsed['allergen_key'])->toHaveCount(6)
        ->and(array_column($this->parsed['sauces'], 'source_ref'))->toBe(['SC-01', 'SC-02', 'SC-03', 'SC-04'])
        ->and(array_column($this->parsed['dressings'], 'source_ref'))->toBe(['DR-01', 'DR-02']);
});

it('reads a master row into its taxonomy without touching the seeded library', function (): void {
    expect($this->parsed['master'][1])->toBe([
        'source_ref' => 'IG-002',
        'name' => 'Fixture Coconut Cream',
        'category' => 'Fruits',
        'subcategory' => 'Tropical fruit',
        'allergen_classes' => ['Tree nuts*'],
        'notes' => '* coconut: US allergen, not EU',
    ]);
});

it('reads a sauce whole, keeping every marker and every qualifier', function (): void {
    expect($this->parsed['sauces'][2])->toBe([
        'source_ref' => 'SC-03',
        'name' => 'Fixture Nut Cream Sauce',
        'typical_ingredients' => ['Fixture cashew', 'cream', 'onion', 'garlic'],
        'allergen_classes' => ['Tree nuts', 'Milk'],
        'allergen_sources' => [
            // Verbatim, including the source's inconsistent capitalisation:
            // the ingredient list writes "Fixture cashew" and the allergen
            // source column writes "fixture cashew". Both are kept as typed.
            ['class' => 'Tree nuts', 'ingredient' => 'fixture cashew'],
            ['class' => 'Milk', 'ingredient' => 'cream / yogurt'],
        ],
        'notes' => null,
    ]);
});

it('keeps a parenthetical qualifier attached even when it contains commas', function (): void {
    expect($this->parsed['sauces'][1]['typical_ingredients'])->toBe([
        'Fixture coconut cream',
        'fixture spice blend (cumin, clove, bay)',
        'onion',
        'oil',
    ]);
});

it('keeps a parenthetical qualifier on a single ingredient', function (): void {
    expect($this->parsed['dressings'][1]['typical_ingredients'])->toBe([
        'Fixture grain (wheat)',
        'oil',
        'lemon',
        'sumac',
    ])->and($this->parsed['dressings'][1]['allergen_sources'])->toBe([
        ['class' => 'Cereals/Gluten', 'ingredient' => 'fixture grain (wheat)'],
    ]);
});

it('reads "None" as no classes and an em dash as no sources', function (): void {
    expect($this->parsed['sauces'][0]['allergen_classes'])->toBe([])
        ->and($this->parsed['sauces'][0]['allergen_sources'])->toBe([]);
});

it('does not split an either-or source ingredient into two ingredients', function (): void {
    // "cream / yogurt" is the workbook saying either may be the source. Two
    // entries would be a formulation containing both.
    expect($this->parsed['sauces'][2]['allergen_sources'][1]['ingredient'])->toBe('cream / yogurt');
});

it('reads the allergen key as written, markers included', function (): void {
    expect($this->parsed['allergen_key'])->toContain(['class' => 'Tree nuts*', 'note' => 'Coconut — a tree nut under US law, NOT an EU allergen.'])
        ->and(array_column($this->parsed['allergen_key'], 'class'))->toContain('Sulphites~');
});

/*
|--------------------------------------------------------------------------
| The findings
|--------------------------------------------------------------------------
*/

it('names every sauce and dressing tagged None', function (): void {
    expect($this->findings->where('code', 'allergen_class_none')->pluck('source_ref')->all())
        ->toBe(['SC-01', 'DR-01']);
});

it('does not raise a None finding for the already-seeded ingredient master', function (): void {
    // IG-004 is tagged None. The master is parsed only as a cross-check
    // against a library that has already been reviewed once, and 150 copies
    // of this finding would bury the two that concern a sellable sauce.
    expect($this->parsed['master'][3]['allergen_classes'])->toBe([])
        ->and($this->findings->where('code', 'allergen_class_none')->pluck('source_ref')->all())
        ->not->toContain('IG-004');
});

it('raises the market-scope marker wherever it appears, master included', function (): void {
    expect($this->findings->where('code', 'allergen_marker_us_only')->pluck('source_ref')->all())
        ->toBe(['IG-002', 'SC-02']);

    expect($this->findings->firstWhere('code', 'allergen_marker_us_only')['detail'])
        ->toContain('"Tree nuts*"')
        ->toContain('not an EU allergen');
});

it('raises the verify-per-supplier marker wherever it appears', function (): void {
    expect($this->findings->where('code', 'allergen_marker_verify_supplier')->pluck('source_ref')->all())
        ->toBe(['IG-003', 'SC-04']);

    expect($this->findings->firstWhere('code', 'allergen_marker_verify_supplier')['detail'])
        ->toContain('"Sulphites~"')
        ->toContain('verify per supplier');
});

it('fires every finding code the fixture ingredient workbook is built to provoke', function (): void {
    expect($this->findings->pluck('code')->unique()->sort()->values()->all())->toBe([
        'allergen_class_none',
        'allergen_marker_us_only',
        'allergen_marker_verify_supplier',
    ]);
});
