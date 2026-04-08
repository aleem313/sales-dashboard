<?php

namespace App\Http\Requests;

use App\Http\Requests\ApiFormRequest;

class AssignProfilesRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'profileIds' => ['required', 'array'],
            'profileIds.*' => ['integer', 'exists:profiles,id'],
        ];
    }
}
