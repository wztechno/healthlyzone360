<?php

declare(strict_types=1);

namespace Healthy360\Customers\Presenters;

use Healthy360\Consent\Models\ConsentDefinition;

/**
 * A consumer's consent position, one row per text they are asked to hold.
 *
 * **Granted and pending are one list, not two.** A screen that received only
 * what is outstanding could not show the person what they have already agreed
 * to, and a person who cannot see what they consented to cannot meaningfully
 * withdraw it — which is the right the whole ledger exists to serve.
 *
 * `status` is derived from the ledger's *pending* answer rather than from
 * "has this code ever been granted", and the difference is the version. A grant
 * is recorded against one version of one text; when the text is reissued, the
 * old grant stays true history and the new version is outstanding again. A
 * status computed from the code alone would report a person as having accepted
 * terms they have never read.
 *
 * The body of the text is not served here. It is two long localised columns per
 * definition, the list is rendered as a checklist, and a client that wants the
 * words asks for them where they are published.
 */
final class CustomerConsentPresenter
{
    public const string STATUS_GRANTED = 'granted';

    public const string STATUS_PENDING = 'pending';

    /**
     * @return array{
     *     code: string,
     *     version: int,
     *     purpose: string,
     *     audience: string,
     *     is_required: bool,
     *     status: string,
     *     display_order: int
     * }
     */
    public function consent(ConsentDefinition $definition, bool $isGranted): array
    {
        return [
            'code' => $definition->code,
            'version' => $definition->version,
            'purpose' => $definition->purpose,
            'audience' => $definition->audience,
            'is_required' => $definition->is_required,
            'status' => $isGranted ? self::STATUS_GRANTED : self::STATUS_PENDING,
            'display_order' => $definition->display_order,
        ];
    }
}
