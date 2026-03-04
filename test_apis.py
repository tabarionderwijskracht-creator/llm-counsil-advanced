"""Test individual provider API connections."""

import asyncio
import sys
sys.path.insert(0, '.')

from backend.config import OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY
from backend.openrouter import query_model

async def test_all():
    print("=== API Key Status ===")
    print(f"OPENAI_API_KEY: {'SET' if OPENAI_API_KEY else 'MISSING'}")
    print(f"ANTHROPIC_API_KEY: {'SET' if ANTHROPIC_API_KEY else 'MISSING'}")
    print(f"GOOGLE_API_KEY: {'SET' if GOOGLE_API_KEY else 'MISSING'}")
    print(f"OPENROUTER_API_KEY: {'SET' if OPENROUTER_API_KEY else 'MISSING'}")
    print()

    test_message = [{"role": "user", "content": "Say hello in exactly 3 words."}]

    models = [
        # Examples for direct providers
        "openai/gpt-5.2-pro",
        "anthropic/claude-sonnet-4-5",
        "google/gemini-3-pro-preview",
        # If you prefer to route through OpenRouter, use the openrouter prefix
        "openrouter/gpt-5.2-pro",
    ]

    for model in models:
        print(f"Testing {model}...")
        try:
            result = await query_model(model, test_message, timeout=30.0)
            if result:
                content = result.get('content', '')[:100]
                print(f"  ✓ Success: {content}")
            else:
                print(f"  ✗ Failed: returned None")
        except Exception as e:
            print(f"  ✗ Error: {e}")
        print()

if __name__ == "__main__":
    asyncio.run(test_all())
