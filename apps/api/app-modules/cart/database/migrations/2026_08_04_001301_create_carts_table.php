<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a customer has picked out but not yet ordered.
 *
 * **Persisted, not held in a session** (master plan v2 C1). A basket that
 * lives in browser storage is lost when the phone dies mid-order and cannot be
 * picked up on a laptop; more importantly it cannot be *validated* — the
 * server never sees it until checkout, so every refusal arrives at the worst
 * possible moment. A row here means the server has already agreed that each
 * line is orderable.
 *
 * **One open cart per customer per channel**, enforced by a partial unique
 * index rather than by the application remembering to look first. A customer
 * shopping the web shop and the marketplace holds two baskets, which is right:
 * they are two kitchens' offers on two sets of terms. Two open baskets on the
 * *same* channel is not a feature, it is a lost basket, and the index is what
 * makes it impossible rather than unlikely.
 *
 * `organisation_id` is the **seller** — the kitchen whose food this is. A cart
 * is single-kitchen by construction: the channel belongs to one organisation,
 * the prices come from that organisation's lists, and the delivery zone,
 * cut-off and fee are all that kitchen's. A multi-kitchen basket is a
 * marketplace order-splitting problem this phase does not have.
 *
 * `currency_code` is fixed on the cart, not derived per line. Every line has
 * to agree with it (`CartService` refuses the ones that do not), because a
 * basket that quietly mixed USD and LBP would produce a total that is not a
 * number in any currency. The rule that every amount carries its currency
 * (§4.4) only works if there is one currency to carry.
 *
 * **No amount columns at all, deliberately.** No line price, no subtotal, no
 * total. A cart is a list of intentions, and the price of an intention is
 * whatever the price list says at the moment somebody commits to it —
 * `OrderPlacementService` reprices every line at placement, and a stored cart
 * price would be a second, staler answer that eventually gets served to
 * somebody. The price probe `CartService` runs when a line is added is
 * validation ("is this orderable at all?"), and its result is deliberately
 * thrown away.
 *
 * Isolation strategy: **application scope, no PostgreSQL policy**, the K1.4
 * decision rather than the J1 one. The owner of a cart is a customer, and a
 * customer is not a member of the kitchen they are buying from — an
 * organisation policy would hide every row from the person who created it, and
 * `customer_accounts` already carries the user-owner predicate that governs
 * who may reach a cart at all. The eleven-table pin in `RlsTest` is the
 * review trigger that made this a decision; it stays eleven, and orders join
 * the set when the kitchen-facing operations surface lands (F1).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carts', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('organisation_id')->comment('the SELLER — the kitchen whose channel this basket is against')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->constrained('customer_accounts')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->comment('the branch that would produce it, when the customer has chosen one')->constrained('organisation_branches')->nullOnDelete();

            $table->string('status', 12)->default('open')->comment('open | converted | expired');
            $table->string('currency_code', 3)->comment('ISO 4217 — every line must price in it, or it is refused');

            $table->timestamp('expires_at')->comment('when ExpireStaleCarts may close it; a basket is not a reservation');

            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->index(['customer_account_id', 'status']);
            $table->index(['organisation_id', 'status']);
            $table->index('expires_at');

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE carts ADD CONSTRAINT carts_status_check CHECK (status IN ('open', 'converted', 'expired'))");

        // One open basket per customer per channel. Partial, because a
        // customer legitimately accumulates a history of converted and expired
        // carts on the same channel and only the live one is single-valued.
        DB::statement("CREATE UNIQUE INDEX carts_one_open_per_channel ON carts (customer_account_id, sales_channel_id) WHERE status = 'open'");
    }

    public function down(): void
    {
        Schema::dropIfExists('carts');
    }
};
