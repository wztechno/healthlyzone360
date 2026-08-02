<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * The container a pack comes in, using the source catalogue's own vocabulary.
 *
 * `Loose` is a real answer, not a missing one — a bunch of parsley sold by
 * weight has a format, and it is "none". Which is why the column is nullable
 * *and* carries this value: "the kitchen said loose" and "nobody has said"
 * are different facts.
 */
enum PackFormat: string
{
    case Bottle = 'bottle';
    case Bag = 'bag';
    case Can = 'can';
    case Gallon = 'gallon';
    case Bunch = 'bunch';
    case Loose = 'loose';
}
