<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * Where a cost snapshot's arithmetic came from.
 *
 * `Recalculated` is arithmetic this system performed over the version's lines:
 * reproducible, and re-derivable from data that is still in the database.
 *
 * `AsRecorded` is what a source technical sheet stated, stored verbatim
 * **including its errors**. Several of the 29 GreenLife sheets do their own
 * arithmetic and do it wrong (appendix D data-quality ledger); correcting one
 * on import destroys the evidence that it needs correcting, and trusting one
 * puts a wrong number behind a right-looking label. Storing both and saying
 * which is which is the only honest option.
 *
 * The API offers `Recalculated` and nothing else. `AsRecorded` belongs to the
 * K1.8 importer, which is the only thing that has a source sheet to record;
 * an endpoint accepting it would be an invitation to type numbers in and call
 * them evidence.
 */
enum CostBasis: string
{
    case AsRecorded = 'as_recorded';
    case Recalculated = 'recalculated';
}
