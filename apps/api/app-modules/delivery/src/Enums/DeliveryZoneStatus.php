<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Enums;

/**
 * The operational lifecycle of a delivery zone — the `active | inactive |
 * archived` family, deliberately not the sellable one.
 *
 * A zone is configuration, not published content. Nothing a customer looks at
 * *is* a zone; what they see is whether their address can be delivered to and
 * what that costs, which is an answer computed from the zone that serves their
 * area.
 *
 * The three states are genuinely different operationally. `inactive` is a
 * suspension a kitchen expects to reverse — a mountain road closed for the
 * winter — and it keeps its area claims, because giving them up would let
 * another zone take them and make the reversal a rebuild. `archived` is
 * terminal, and it **releases** the claims, because a map nobody intends to
 * return to should not be holding areas hostage.
 */
enum DeliveryZoneStatus: string
{
    case Active = 'active';

    case Inactive = 'inactive';

    case Archived = 'archived';

    /**
     * Whether a zone in this state may still be edited — including its area
     * set. An archived zone is frozen; a suspended one is not, because
     * suspension exists precisely so a kitchen can fix something.
     */
    public function isEditable(): bool
    {
        return $this !== self::Archived;
    }

    /**
     * Whether a zone in this state can actually serve an address. Only an
     * active zone quotes a delivery, which is what makes `inactive` a real
     * suspension rather than a label.
     */
    public function isServing(): bool
    {
        return $this === self::Active;
    }
}
