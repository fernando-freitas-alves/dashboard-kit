"""Optional OpenAI Responses transport; hosts supply approved metadata and schema."""

import json
import urllib.request
import urllib.error


class ProviderError(ValueError):
    pass


def compose_json(
    *,
    api_key,
    model,
    instructions,
    data,
    schema,
    name="dashboard_chart",
    reasoning="high",
    timeout=60,
    max_output_tokens=16384,
    opener=None,
):
    if not api_key:
        raise ProviderError(
            "AI is not connected. Ask an admin to configure the OpenAI key."
        )
    if reasoning not in {
        "",
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    }:
        raise ProviderError(
            "The AI reasoning setting is invalid. Ask an admin to check OPENAI_REASONING_EFFORT."
        )
    payload = {
        "model": model,
        "store": False,
        "max_output_tokens": max_output_tokens,
        "instructions": instructions,
        "input": json.dumps(data),
        "text": {
            "format": {
                "type": "json_schema",
                "name": name,
                "strict": True,
                "schema": schema,
            }
        },
    }
    if reasoning:
        payload["reasoning"] = {"effort": reasoning}
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
        },
    )
    try:
        with (opener or urllib.request.urlopen)(request, timeout=timeout) as response:
            result = json.loads(response.read(128000))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ProviderError(
                "The AI key could not be used. Ask an admin to check its access."
            ) from None
        if e.code == 429:
            raise ProviderError(
                "The AI service is busy or out of quota. Try again shortly."
            ) from None
        raise ProviderError(
            "AI chart creation failed. Try again or choose fields."
        ) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ProviderError(
            "AI chart creation timed out. Try again or choose fields."
        ) from None
    try:
        if result.get("status") != "completed":
            raise ValueError()
        text = "".join(
            c["text"]
            for item in result["output"]
            if item.get("type") == "message"
            for c in item.get("content", [])
            if c.get("type") == "output_text"
        )
        candidate = json.loads(text)
        if not isinstance(candidate, dict):
            raise ValueError()
        return candidate
    except (ValueError, KeyError, TypeError, AttributeError):
        raise ProviderError(
            "AI returned an unusable chart. Try again or choose fields."
        ) from None
