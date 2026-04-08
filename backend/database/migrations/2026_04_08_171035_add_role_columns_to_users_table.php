<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_url')->nullable()->after('password');
            $table->enum('role', ['admin', 'agent'])->default('agent')->after('avatar_url');
            $table->string('github_email')->nullable()->after('role');
            $table->boolean('active')->default(true)->after('github_email');
            $table->text('legacy_password_hash')->nullable()->after('active');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['avatar_url', 'role', 'github_email', 'active', 'legacy_password_hash']);
        });
    }
};
