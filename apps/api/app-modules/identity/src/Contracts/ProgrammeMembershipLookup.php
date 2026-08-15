<?php

declare(strict_types=1);

namespace Healthy360\Identity\Contracts;

/**
 * Asks a question only the B2B module can answer — "what corporate
 * programmes does this organisation belong to?" — so that `/me`'s
 * `active_context` can name them (B2) without the identity module depending
 * on B2B.
 *
 * The dependency edge runs B2b → Identity, the same shape
 * `Pricing\Contracts\BuyerAgreementLookup` draws one module over: a port
 * published by the lower-level module, implemented by the one that owns the
 * concept. `NullProgrammeMembershipLookup` is the default; the B2B service
 * provider rebinds it.
 */
interface ProgrammeMembershipLookup
{
    /**
     * Active programmes the given organisation is the buyer on, newest
     * first. Every membership of that organisation shares this list (B7) —
     * there is no per-user grant to filter by.
     *
     * @return list<array{
     *     id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     kitchen_organisation_id: string,
     * }>
     */
    public function activeProgrammesFor(string $organisationId): array;
}
