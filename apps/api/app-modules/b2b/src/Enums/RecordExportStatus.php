<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The life of a records bundle — **shell vocabulary; B2 owns the builder**.
 *
 * `expired` is a state rather than a derived comparison against `expires_at`
 * because expiry here is an *act*: the bytes are deleted, and a row that says
 * `ready` while its object is gone would offer a download that 404s. The
 * transition is what deletes the object, and the status is the record of it
 * having happened.
 */
enum RecordExportStatus: string
{
    case Requested = 'requested';

    case Building = 'building';

    case Ready = 'ready';

    case Delivered = 'delivered';

    case Expired = 'expired';

    case Failed = 'failed';

    /** Whether bytes exist on the private disk for this row. */
    public function hasObject(): bool
    {
        return $this === self::Ready || $this === self::Delivered;
    }
}
