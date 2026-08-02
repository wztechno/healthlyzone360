<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * The operational lifecycle of a catalogue — the container, not its items.
 *
 * Deliberately not the sellable family: a catalogue is a folder, and what a
 * customer sees is the items inside it, each carrying its own §4.7
 * publication state. A folder with a publication state of its own would
 * create two places to ask "is this live", and one of them would eventually
 * disagree with the other.
 */
enum CatalogueStatus: string
{
    case Draft = 'draft';
    case Active = 'active';
    case Archived = 'archived';
}
