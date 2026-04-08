<?php

namespace App\Http\Requests;

use App\Http\Requests\ApiFormRequest;

class CreateProfileRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'profile_id' => ['required', 'string', 'max:255', 'unique:profiles,profile_id'],
            'profile_name' => ['required', 'string', 'max:255'],
            'platform' => ['nullable', 'string', 'max:255'],
            'stack' => ['nullable', 'string', 'max:255'],
            'vollna_filter_tag' => ['nullable', 'string', 'max:255'],
            'agent_id' => ['nullable', 'integer', 'exists:users,id'],
        ];
    }
}
