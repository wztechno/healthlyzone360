<?php

declare(strict_types=1);

namespace Healthy360\Customers\Enums;

/**
 * How the account came to exist.
 *
 * Kept because the answer changes what may be assumed about it. A
 * `self_service` account was created by the person themselves and its
 * provisional window applies; a `b2b_provisioning` account was created by an
 * approval and activates through B1's transaction rather than through the D2C
 * evaluator; an `import` account carries whatever the source said and no
 * consent anybody gave here.
 */
enum CustomerAccountOrigin: string
{
    case SelfService = 'self_service';

    case Guest = 'guest';

    case B2bProvisioning = 'b2b_provisioning';

    case Staff = 'staff';

    case Import = 'import';

    /**
     * Whether an abandoned account of this origin may be purged.
     *
     * Only what a person started and walked away from. A staff-created or
     * provisioned account represents somebody else's work and a business
     * relationship; deleting it because nobody signed in for thirty days would
     * be the purge job overruling an operator.
     */
    public function isPurgeable(): bool
    {
        return in_array($this, [self::SelfService, self::Guest], true);
    }
}
