<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profiles', function (Blueprint $table) {
            $table->id();
            $table->string('profile_id')->unique()->comment('Unique identifier used in n8n routing');
            $table->string('profile_name');
            $table->string('platform')->default('Upwork');
            $table->string('stack')->nullable();
            $table->string('vollna_filter_tag')->nullable();
            $table->foreignId('agent_id')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index('agent_id');
            $table->index('active');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profiles');
    }
};
