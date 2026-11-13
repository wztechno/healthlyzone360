<?php

declare(strict_types=1);

use Healthy360\Catalogues\Services\DishOptions;

/*
| The line key is what keeps a plain line merging as it always has and a line with
| a note apart. It has to ignore the order options were ticked in.
*/

it('keeps a plain line on the empty key, so it merges as it always did', function (): void {
    expect(DishOptions::lineKey([], null))->toBe('')
        ->and(DishOptions::lineKey([], '  '))->toBe('');
});

it('reads the same options in any order as the same line', function (): void {
    expect(DishOptions::lineKey(['a', 'b'], 'x'))->toBe(DishOptions::lineKey(['b', 'a'], 'x'))
        ->and(DishOptions::lineKey(['a'], null))->not->toBe(DishOptions::lineKey(['a'], 'x'));
});
