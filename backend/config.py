"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()

# Individual provider API keys
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# OpenRouter provides a unified API key you can use instead of individual
# provider keys.  If you supply OPENROUTER_API_KEY and configure your models
# with the "openrouter/<model-name>" prefix, the code will route requests
# through OpenRouter rather than calling each provider directly.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Council members - format: "provider/model" (e.g. "openai/gpt-5.2").
# You may also use the "openrouter" provider if you want a single API key
# for everything.  In that case the model identifiers should look like
# "openrouter/gpt-5.2" or "openrouter/gpt-5.1" etc.

# All available models that can be selected in the UI
AVAILABLE_MODELS = [
    "openrouter/openai/gpt-5.1",
    "openrouter/google/gemini-3-pro-preview",
    "openrouter/anthropic/claude-sonnet-4.5",
    "openrouter/x-ai/grok-4",
]

# Default models used when none are selected (all available by default)
COUNCIL_MODELS = AVAILABLE_MODELS.copy()

# Research configuration (Stage 0)
# Perplexity is used for web research before council deliberation
RESEARCH_MODEL = "openrouter/perplexity/sonar-deep-research"
RESEARCH_ENABLED_DEFAULT = True  # Can be overridden per-request

# Chairman model - synthesizes final response (o3 for best reasoning)
CHAIRMAN_MODEL = "openrouter/openai/o3"

# Provider API endpoints (used when calling services directly)
PROVIDER_ENDPOINTS = {
    "openai_chat": "https://api.openai.com/v1/chat/completions",
    "openai_responses": "https://api.openrouter.ai/v1/responses",
    "anthropic": "https://api.anthropic.com/v1/messages",
    "google": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    # Note: openrouter endpoint is handled specially in openrouter.py
}

# Models that require the Responses API (not Chat Completions)
OPENAI_RESPONSES_MODELS = ["gpt-5.2-pro", "gpt-5.2", "o3", "o4-mini"]

# Data directory for conversation storage
DATA_DIR = "data/conversations"

# File upload configuration
UPLOADS_DIR = "data/uploads"
MAX_FILE_SIZE_MB = 20
ALLOWED_EXTENSIONS = [".pdf"]
MAX_TEXT_CHARS = 200000  # Max extracted text characters (~50K tokens)
WARN_TEXT_CHARS = 50000  # Warn if text exceeds this (~12.5K tokens)
