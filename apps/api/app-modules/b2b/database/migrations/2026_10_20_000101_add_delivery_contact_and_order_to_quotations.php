<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a quotation asks for besides its lines, and what accepting it became.
 *
 * The builder always collected a preferred first delivery, a "this should
 * repeat" flag and a reply contact, but the table had no column for any of
 * them, so the client folded them into `notes` as prose and the kitchen read
 * them back as prose. They are columns now, so the kitchen's screen can show
 * them and acceptance can schedule against the date.
 *
 * `order_id` is the order an acceptance placed (2026-10-20): accepting a
 * quotation used to change its status and nothing else, so an agreed price
 * never reached the kitchen's calendar, its buy list or its production. Null
 * on every quotation accepted before then.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('quotations', function (Blueprint $table): void {
            $table->date('requested_delivery_date')->nullable()->after('notes');
            $table->boolean('recurring')->default(false)->after('requested_delivery_date');
            $table->string('contact_name', 120)->nullable()->after('recurring');
            $table->string('contact_email', 190)->nullable()->after('contact_name');
            $table->foreignUuid('order_id')->nullable()->after('decided_by')->constrained('orders')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('quotations', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('order_id');
            $table->dropColumn(['requested_delivery_date', 'recurring', 'contact_name', 'contact_email']);
        });
    }
};
