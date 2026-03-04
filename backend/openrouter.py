"""Multi-provider LLM API client."""

import asyncio
import random
import httpx
from typing import List, Dict, Any, Optional
from .config import (
    OPENAI_API_KEY,
    ANTHROPIC_API_KEY,
    GOOGLE_API_KEY,
    OPENROUTER_API_KEY,
    PROVIDER_ENDPOINTS,
    OPENAI_RESPONSES_MODELS,
)


def _parse_model_string(model: str) -> tuple[str, str]:
    """Parse 'provider/model-name' into (provider, model_name)."""
    if "/" in model:
        provider, model_name = model.split("/", 1)
        return provider, model_name
    raise ValueError(f"Model must be in format 'provider/model': {model}")


async def _query_openai(
    model_name: str,
    messages: List[Dict[str, str]],
    timeout: float
) -> Optional[Dict[str, Any]]:
    """Query OpenAI API (Chat Completions or Responses API based on model)."""
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    # Check if model requires Responses API
    use_responses_api = any(model_name.startswith(m) for m in OPENAI_RESPONSES_MODELS)

    if use_responses_api:
        # Responses API format
        endpoint = PROVIDER_ENDPOINTS["openai_responses"]
        payload = {
            "model": model_name,
            "input": messages,  # Responses API uses "input" not "messages"
        }
    else:
        # Chat Completions API format
        endpoint = PROVIDER_ENDPOINTS["openai_chat"]
        payload = {
            "model": model_name,
            "messages": messages,
        }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

        if use_responses_api:
            # Responses API returns output array with message items
            output = data.get('output', [])
            content = ""
            for item in output:
                if item.get('type') == 'message':
                    for c in item.get('content', []):
                        if c.get('type') == 'output_text':
                            content += c.get('text', '')
            return {'content': content, 'reasoning_details': None}
        else:
            # Chat Completions API format
            message = data['choices'][0]['message']
            return {
                'content': message.get('content'),
                'reasoning_details': message.get('reasoning_details')
            }


async def _query_anthropic(
    model_name: str,
    messages: List[Dict[str, str]],
    timeout: float
) -> Optional[Dict[str, Any]]:
    """Query Anthropic API."""
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    # Convert messages format - extract system message if present
    system_content = None
    api_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_content = msg["content"]
        else:
            api_messages.append(msg)

    payload = {
        "model": model_name,
        "messages": api_messages,
        "max_tokens": 4096,
    }
    if system_content:
        payload["system"] = system_content

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            PROVIDER_ENDPOINTS["anthropic"],
            headers=headers,
            json=payload
        )
        response.raise_for_status()
        data = response.json()
        # Anthropic returns content as array of blocks
        content_blocks = data.get('content', [])
        text_content = ""
        for block in content_blocks:
            if block.get('type') == 'text':
                text_content += block.get('text', '')
        return {
            'content': text_content,
            'reasoning_details': None
        }


async def _query_openrouter(
    model_name: str,
    messages: List[Dict[str, str]],
    timeout: float
) -> Optional[Dict[str, Any]]:
    """Query OpenRouter proxy endpoint.

    The caller should supply a model identifier such as "gpt-5.2" or
    "claude-sonnet-4-5"; we simply forward the request to OpenRouter's
    /chat/completions endpoint using the shared OPENROUTER_API_KEY.

    For Perplexity models, also extracts citations from the response.
    """
    if not OPENROUTER_API_KEY:
        print("OpenRouter key not set")
        return None

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name,
        "messages": messages,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        message = data["choices"][0]["message"]

        result = {
            "content": message.get("content"),
            "reasoning_details": message.get("reasoning_details"),
        }

        # Extract citations for Perplexity models
        # Perplexity returns citations in the response metadata
        citations = data.get("citations")
        if citations:
            result["citations"] = citations

        return result


async def _query_google(
    model_name: str,
    messages: List[Dict[str, str]],
    timeout: float,
    max_retries: int = 5
) -> Optional[Dict[str, Any]]:
    """Query Google Gemini API with exponential backoff for rate limits."""
    url = PROVIDER_ENDPOINTS["google"].format(model=model_name)
    url = f"{url}?key={GOOGLE_API_KEY}"

    headers = {
        "Content-Type": "application/json",
    }

    # Convert messages to Gemini format
    contents = []
    system_instruction = None

    for msg in messages:
        role = msg["role"]
        if role == "system":
            system_instruction = msg["content"]
        else:
            # Gemini uses "user" and "model" (not "assistant")
            gemini_role = "model" if role == "assistant" else "user"
            contents.append({
                "role": gemini_role,
                "parts": [{"text": msg["content"]}]
            })

    payload = {"contents": contents}
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    # Retry with exponential backoff for rate limits
    for attempt in range(max_retries):
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)

            if response.status_code == 429:
                # Rate limited - exponential backoff with jitter
                base_delay = 2 ** attempt  # 1, 2, 4, 8, 16 seconds
                jitter = random.uniform(0, 1)
                delay = base_delay + jitter
                print(f"Google API rate limited, retrying in {delay:.1f}s (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(delay)
                continue

            response.raise_for_status()
            data = response.json()

            # Extract text from Gemini response
            candidates = data.get('candidates', [])
            if candidates:
                parts = candidates[0].get('content', {}).get('parts', [])
                text_content = "".join(p.get('text', '') for p in parts)
                return {
                    'content': text_content,
                    'reasoning_details': None
                }
            return {'content': '', 'reasoning_details': None}

    # All retries exhausted
    raise httpx.HTTPStatusError("Rate limit exceeded after max retries", request=None, response=response)


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 300.0  # Increased default for large contexts
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via its native API.

    Args:
        model: Model identifier in format "provider/model-name"
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    # Calculate dynamic timeout based on input size
    total_chars = sum(len(m.get("content", "")) for m in messages)
    if total_chars > 100000:
        timeout = max(timeout, 600.0)  # 10 min for very large contexts
    elif total_chars > 50000:
        timeout = max(timeout, 300.0)  # 5 min for large contexts

    try:
        provider, model_name = _parse_model_string(model)

        if provider == "openai":
            return await _query_openai(model_name, messages, timeout)
        elif provider == "anthropic":
            return await _query_anthropic(model_name, messages, timeout)
        elif provider == "google":
            return await _query_google(model_name, messages, timeout)
        elif provider == "openrouter":
            return await _query_openrouter(model_name, messages, timeout)
        elif provider == "openrouter":
            return await _query_openrouter(model_name, messages, timeout)
        else:
            print(f"Unknown provider: {provider}")
            return None

    except httpx.TimeoutException as e:
        print(f"Timeout querying model {model} ({total_chars} chars, {timeout}s timeout): {e}")
        return None
    except Exception as e:
        print(f"Error querying model {model}: {type(e).__name__}: {e}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    on_model_complete: Optional[callable] = None,
    hard_timeout: float = 180.0  # Hard timeout per model (3 minutes)
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel with progress tracking and hard timeout.

    Args:
        models: List of model identifiers in format "provider/model-name"
        messages: List of message dicts to send to each model
        on_model_complete: Optional callback(model, response) called as each model completes
        hard_timeout: Hard timeout per model in seconds (fails if exceeded)

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    results: Dict[str, Optional[Dict[str, Any]]] = {}

    async def query_with_timeout(model: str) -> tuple[str, Optional[Dict[str, Any]]]:
        """Query a model with a hard timeout."""
        try:
            response = await asyncio.wait_for(
                query_model(model, messages),
                timeout=hard_timeout
            )
            return model, response
        except asyncio.TimeoutError:
            print(f"HARD TIMEOUT: Model {model} exceeded {hard_timeout}s limit")
            return model, None
        except Exception as e:
            print(f"Error querying {model}: {type(e).__name__}: {e}")
            return model, None

    # Create tasks for all models
    tasks = [asyncio.create_task(query_with_timeout(model)) for model in models]

    # Process results as they complete (not waiting for all)
    for completed_task in asyncio.as_completed(tasks):
        model, response = await completed_task
        results[model] = response

        # Call progress callback if provided
        if on_model_complete:
            try:
                await on_model_complete(model, response)
            except Exception as e:
                print(f"Error in on_model_complete callback: {e}")

    return results
