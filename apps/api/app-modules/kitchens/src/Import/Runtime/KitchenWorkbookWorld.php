<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Catalogues\Enums\CatalogueStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use RuntimeException;

/**
 * The shell a Healthy360 workbook import needs before it can write anything: one
 * organisation, one branch, two sales channels, three price lists and a
 * catalogue.
 *
 * **The organisation slug is the natural key**, and everything else hangs off
 * the organisation identifier it resolves to. A second run finds the same
 * organisation and therefore the same branch, channels and tariffs, without any
 * of them needing a source reference — they do not come from a row of a
 * workbook, they come from the decision to import that workbook at all.
 *
 * **Nothing here is confidential**, which is why the shell could in principle
 * be a committed demo seed (appendix D). It is not one: a kitchen that exists
 * in the repository but whose formulations only exist on somebody's laptop is a
 * half-truth in the migration history, and the org shell costs nothing to
 * create here.
 *
 * **The three tariffs land as drafts.** `healthy360-b2c-usd` and
 * `healthy360-b2b-usd` receive the product list's real numbers as `confirmed`
 * rows, and `healthy360-plans-usd` receives one NULL-amount `placeholder` row
 * per plan configuration — because the meal-plan workbook's pricing matrix is a
 * grid of availability flags with no numbers anywhere in it (decision OD-2).
 * A draft tariff is not consulted by the price resolver, so nothing imported
 * can reach a customer until a human activates it.
 *
 * **Context.** Branches, channels, catalogues and price lists are all
 * organisation-scoped, and `organisation_branches` carries a PostgreSQL policy.
 * The organisation is therefore created first and outside any context (nothing
 * guards `organisations`), and everything after it runs inside
 * `DatabaseTenantContext::during()` — set here, once, so no writer downstream
 * has to remember.
 */
final readonly class KitchenWorkbookWorld
{
    public const string ORGANISATION_NAME = 'Healthy360 Kitchen';

    public const string BRANCH_NAME = 'Main Kitchen';

    public const string CHANNEL_B2C = 'web-shop';

    public const string CHANNEL_B2B = 'wholesale';

    public const string PRICE_LIST_B2C = 'healthy360-b2c-usd';

    public const string PRICE_LIST_B2B = 'healthy360-b2b-usd';

    public const string PRICE_LIST_PLANS = 'healthy360-plans-usd';

    public const string CATALOGUE = 'healthy360-main';

    public const string CURRENCY = 'USD';

    public function __construct(
        private TenantContext $context,
        private DatabaseTenantContext $database,
    ) {}

    /**
     * Create what is absent, adopt what is present, and leave the tenant
     * context pointing at the organisation.
     *
     * @return array{organisation: Organisation, branch: OrganisationBranch, channels: array<string, SalesChannel>, price_lists: array<string, PriceList>, catalogue: Catalogue}
     */
    public function establish(string $slug, ImportReport $report): array
    {
        $organisation = $this->organisation($slug, $report);

        $this->context->restore(['organisation_id' => (string) $organisation->getKey()]);
        $this->database->apply(null, (string) $organisation->getKey(), null);

        $branch = $this->branch($organisation, $report);
        $channels = $this->channels($organisation, $report);
        $priceLists = $this->priceLists($organisation, $branch, $report);
        $catalogue = $this->catalogue($organisation, $report);

        return [
            'organisation' => $organisation,
            'branch' => $branch,
            'channels' => $channels,
            'price_lists' => $priceLists,
            'catalogue' => $catalogue,
        ];
    }

    /**
     * The organisation as it stands, without creating anything — the dry-run
     * and validate-only path, and the way a caller asks "has this ever been
     * imported".
     */
    public function existing(string $slug): ?Organisation
    {
        return Organisation::query()->where('slug', $slug)->first();
    }

    private function organisation(string $slug, ImportReport $report): Organisation
    {
        $existing = $this->existing($slug);

        if ($existing instanceof Organisation) {
            $report->skipped('organisation');

            return $existing;
        }

        $typeId = OrganisationType::query()->where('code', 'kitchen')->value('id');

        if (! is_string($typeId)) {
            throw new RuntimeException('The organisation types must be seeded before a kitchen can be imported.');
        }

        $report->created('organisation');

        $organisation = new Organisation;
        $organisation->organisation_type_id = $typeId;
        $organisation->name = self::ORGANISATION_NAME;
        $organisation->slug = $slug;
        $organisation->country_code = 'LB';
        $organisation->default_currency_code = self::CURRENCY;
        $organisation->default_language_code = 'en';
        $organisation->status = OrganisationStatus::Active;
        $organisation->save();

        return $organisation;
    }

    private function branch(Organisation $organisation, ImportReport $report): OrganisationBranch
    {
        $existing = OrganisationBranch::query()
            ->where('organisation_id', $organisation->getKey())
            ->where('name', self::BRANCH_NAME)
            ->first();

        if ($existing instanceof OrganisationBranch) {
            $report->skipped('branch');

            return $existing;
        }

        $report->created('branch');

        $branch = new OrganisationBranch;
        $branch->organisation_id = (string) $organisation->getKey();
        $branch->name = self::BRANCH_NAME;
        $branch->country_code = 'LB';
        $branch->city = 'Beirut';

        // No street address: the workbook has none, and a plausible one would
        // be a fabrication sitting in a field a delivery integration will one
        // day trust.
        $branch->address = null;
        $branch->timezone = 'Asia/Beirut';
        $branch->status = BranchStatus::Active;
        $branch->save();

        return $branch;
    }

    /**
     * @return array<string, SalesChannel>
     */
    private function channels(Organisation $organisation, ImportReport $report): array
    {
        $definitions = [
            self::CHANNEL_B2C => [SalesChannelKind::B2cWeb, 'Web shop', 'المتجر الإلكتروني'],
            self::CHANNEL_B2B => [SalesChannelKind::B2b, 'Wholesale', 'البيع بالجملة'],
        ];

        $channels = [];

        foreach ($definitions as $code => [$kind, $nameEn, $nameAr]) {
            $existing = SalesChannel::query()->where('code', $code)->first();

            if ($existing instanceof SalesChannel) {
                $report->skipped('sales_channel');
                $channels[$code] = $existing;

                continue;
            }

            $report->created('sales_channel');

            $channel = new SalesChannel;
            $channel->organisation_id = (string) $organisation->getKey();
            $channel->code = $code;
            $channel->channel_kind = $kind;
            $channel->name_en = $nameEn;
            $channel->name_ar = $nameAr;
            $channel->status = SalesChannelStatus::Active;
            $channel->save();

            $channels[$code] = $channel;
        }

        return $channels;
    }

    /**
     * @return array<string, PriceList>
     */
    private function priceLists(Organisation $organisation, OrganisationBranch $branch, ImportReport $report): array
    {
        $definitions = [
            self::PRICE_LIST_B2C => ['Retail prices (USD)', 'أسعار التجزئة (دولار)', CustomerScope::PublicTariff],
            self::PRICE_LIST_B2B => ['Wholesale prices (USD)', 'أسعار الجملة (دولار)', CustomerScope::PublicTariff],
            self::PRICE_LIST_PLANS => ['Plan prices (USD)', 'أسعار الخطط (دولار)', CustomerScope::PublicTariff],
        ];

        $lists = [];

        foreach ($definitions as $code => [$nameEn, $nameAr, $scope]) {
            $existing = PriceList::query()->where('code', $code)->first();

            if ($existing instanceof PriceList) {
                $report->skipped('price_list');
                $lists[$code] = $existing;

                continue;
            }

            $report->created('price_list');

            $list = new PriceList;
            $list->organisation_id = (string) $organisation->getKey();

            // Organisation-wide rather than pinned to the Main Kitchen: the
            // workbook prices a product, not a site, and a kitchen that opens a
            // second branch should not silently lose its tariff.
            $list->branch_id = null;
            $list->code = $code;
            $list->name_en = $nameEn;
            $list->name_ar = $nameAr;
            $list->currency_code = self::CURRENCY;
            $list->customer_scope = $scope;
            $list->status = PriceListStatus::Draft;
            $list->save();

            $lists[$code] = $list;
        }

        unset($branch);

        return $lists;
    }

    private function catalogue(Organisation $organisation, ImportReport $report): Catalogue
    {
        $existing = Catalogue::query()->where('code', self::CATALOGUE)->first();

        if ($existing instanceof Catalogue) {
            $report->skipped('catalogue');

            return $existing;
        }

        $report->created('catalogue');

        $catalogue = new Catalogue;
        $catalogue->organisation_id = (string) $organisation->getKey();
        $catalogue->branch_id = null;
        $catalogue->code = self::CATALOGUE;
        $catalogue->name_en = 'Healthy360 Kitchen catalogue';
        $catalogue->name_ar = 'كتالوج مطبخ Healthy360';
        $catalogue->status = CatalogueStatus::Active;
        $catalogue->save();

        return $catalogue;
    }
}
