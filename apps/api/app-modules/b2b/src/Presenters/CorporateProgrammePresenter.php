<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\CorporateProgramme;

/**
 * The wire shape of one corporate programme.
 */
final class CorporateProgrammePresenter
{
    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     kitchen_organisation_id: string,
     *     b2b_agreement_id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     description: string|null,
     *     status: string,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function programme(CorporateProgramme $programme): array
    {
        return [
            'id' => (string) $programme->getKey(),
            'organisation_id' => $programme->organisation_id,
            'kitchen_organisation_id' => $programme->kitchen_organisation_id,
            'b2b_agreement_id' => $programme->b2b_agreement_id,
            'code' => $programme->code,
            'name_en' => $programme->name_en,
            'name_ar' => $programme->name_ar,
            'description' => $programme->description,
            'status' => $programme->status,
            'lock_version' => $programme->lock_version,
            'created_at' => $programme->created_at?->toIso8601String(),
            'updated_at' => $programme->updated_at?->toIso8601String(),
        ];
    }
}
