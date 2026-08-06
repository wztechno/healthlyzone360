<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Models\Quotation;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;

/**
 * Turns B2B route parameters into records the caller is allowed to see, or
 * into a 404.
 *
 * Route-model binding is not used, matching `CatalogueLocator`, `RecipeLocator`
 * and the ingredients locator before them. The reasons here are stronger than
 * theirs. An application is **not** tenant-scoped — it exists so that a tenant
 * may — so there is no global scope to lean on and ownership has to be asked
 * explicitly; and the organisation-scoped half of this surface needs
 * `org.context` to have run first, which the router's binding middleware
 * cannot guarantee.
 *
 * ## Two ways to reach an application, and the difference is the point
 *
 * `application()` finds any application and is what the platform review surface
 * uses — a reviewer is meant to see other people's paperwork, which is the
 * whole job. `ownApplication()` additionally requires the caller to be the
 * applicant, and answers **404** rather than 403 when they are not. That
 * matches `ApplicationService::assertApplicant()` exactly, and it is deliberate:
 * telling a stranger "that application exists but is not yours" turns an
 * identifier into a probe for which companies have applied.
 *
 * ## Children are resolved inside their parent, always
 *
 * `agreement()`, `document()` and `invitation()` all take the parent record and
 * scope the lookup to it. A caller holding one application's identifier and
 * another's agreement identifier gets a 404, not somebody else's terms —
 * checking the parent afterwards would be a check somebody eventually forgets
 * to write.
 *
 * ## The organisation in the path is checked against the context
 *
 * `contextOrganisation()` refuses any identifier that is not the organisation
 * `org.context` already validated a membership against, and refuses it with a
 * 404. The context middleware has done the authorisation; this is the guard
 * against a path that quietly disagrees with the header, and a mismatch is
 * "no such organisation, as far as you are concerned" rather than a hint that
 * one exists.
 */
final class B2bLocator
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Any application — the platform review surface's resolver.
     *
     * @throws ApiException
     */
    public function application(string $id): B2bApplication
    {
        $application = $this->looksLikeUuid($id)
            ? B2bApplication::query()->whereKey($id)->first()
            : B2bApplication::query()->where('reference', mb_strtoupper($id))->first();

        if (! $application instanceof B2bApplication) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $application;
    }

    /**
     * The caller's own application, or a 404.
     *
     * @throws ApiException
     */
    public function ownApplication(string $id, User $actor): B2bApplication
    {
        $application = $this->application($id);

        if ($application->applicant_user_id !== (string) $actor->getKey()) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $application;
    }

    /**
     * @throws ApiException
     */
    public function agreement(B2bApplication $application, string $id): B2bAgreement
    {
        $agreement = B2bAgreement::query()
            ->where('b2b_application_id', $application->getKey())
            ->whereKey($this->uuidOrNothing($id))
            ->first();

        if (! $agreement instanceof B2bAgreement) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $agreement;
    }

    /**
     * @throws ApiException
     */
    public function document(B2bApplication $application, string $id): KycDocument
    {
        $document = KycDocument::query()
            ->where('b2b_application_id', $application->getKey())
            ->whereKey($this->uuidOrNothing($id))
            ->first();

        if (! $document instanceof KycDocument) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $document;
    }

    /**
     * A document reached without its application in the path — the reviewer's
     * verdict endpoint, which addresses the document directly because a
     * verdict is about the file rather than about the file's owner.
     *
     * @throws ApiException
     */
    public function anyDocument(string $id): KycDocument
    {
        $document = KycDocument::query()->whereKey($this->uuidOrNothing($id))->first();

        if (! $document instanceof KycDocument) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $document;
    }

    /**
     * @throws ApiException
     */
    public function invitation(Organisation $organisation, string $id): OrganisationInvitation
    {
        $invitation = OrganisationInvitation::query()
            ->where('organisation_id', $organisation->getKey())
            ->whereKey($this->uuidOrNothing($id))
            ->first();

        if (! $invitation instanceof OrganisationInvitation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $invitation;
    }

    /**
     * The organisation in the path, which must be the one in context.
     *
     * @throws ApiException
     */
    public function contextOrganisation(string $id): Organisation
    {
        $active = $this->tenant->organisationId();

        if ($active === null || ! $this->looksLikeUuid($id) || $active !== $id) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $organisation = Organisation::query()->whereKey($active)->first();

        if (! $organisation instanceof Organisation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $organisation;
    }

    /**
     * A corporate programme in the caller's own (buyer) organisation
     * context — `CorporateProgramme`'s global scope does the tenant check, so
     * this is a lookup rather than an authorisation decision.
     *
     * @throws ApiException
     */
    public function programme(string $id): CorporateProgramme
    {
        $programme = CorporateProgramme::query()->whereKey($this->uuidOrNothing($id))->first();

        if (! $programme instanceof CorporateProgramme) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $programme;
    }

    /**
     * A quotation in the caller's own (buyer) organisation context, scoped to
     * the given programme.
     *
     * @throws ApiException
     */
    public function programmeQuotation(CorporateProgramme $programme, string $id): Quotation
    {
        $quotation = Quotation::query()
            ->where('corporate_programme_id', $programme->getKey())
            ->whereKey($this->uuidOrNothing($id))
            ->first();

        if (! $quotation instanceof Quotation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $quotation;
    }

    /**
     * A quotation in the caller's own (buyer) organisation context, addressed
     * directly.
     *
     * @throws ApiException
     */
    public function quotation(string $id): Quotation
    {
        $quotation = Quotation::query()->whereKey($this->uuidOrNothing($id))->first();

        if (! $quotation instanceof Quotation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $quotation;
    }

    /**
     * A quotation reached from the *kitchen's* side — the other end of the
     * relationship `B2bCatalogueBrowse` reaches for the same structural
     * reason. `Quotation.organisation_id` is the buyer, so the tenant scope
     * that protects a buyer's own read is exactly what has to be bypassed
     * here: the caller's active organisation is the seller, and ownership is
     * proven by joining through the programme's `kitchen_organisation_id`
     * instead.
     *
     * @throws ApiException
     */
    public function kitchenQuotation(string $id, string $kitchenOrganisationId): Quotation
    {
        $quotation = $this->kitchenQuotationsQuery($kitchenOrganisationId)
            ->whereKey($this->uuidOrNothing($id))
            ->first();

        if (! $quotation instanceof Quotation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $quotation;
    }

    /**
     * @return Builder<Quotation>
     */
    public function kitchenQuotationsQuery(string $kitchenOrganisationId): Builder
    {
        $programmeIds = CorporateProgramme::withoutTenancy()
            ->where('kitchen_organisation_id', $kitchenOrganisationId)
            ->pluck('id');

        return Quotation::withoutTenancy()->whereIn('corporate_programme_id', $programmeIds);
    }

    /**
     * A malformed identifier must not reach PostgreSQL as `uuid = 'nonsense'`,
     * which is an error rather than an empty set. Substituting a value that
     * cannot exist turns a client's typo into the 404 it deserves.
     */
    private function uuidOrNothing(string $value): string
    {
        return $this->looksLikeUuid($value) ? $value : '00000000-0000-0000-0000-000000000000';
    }

    private function looksLikeUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
