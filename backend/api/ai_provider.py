import os
import requests
from django.conf import settings

class AIProviderUnavailableError(Exception):
    pass

def is_ai_available() -> bool:
    api_key = getattr(settings, 'AI_API_KEY', '')
    return bool(api_key and api_key.strip())

def get_ai_status() -> dict:
    available = is_ai_available()
    return {
        "available": available,
        "provider": getattr(settings, 'AI_PROVIDER', 'openai'),
        "model": getattr(settings, 'AI_MODEL', 'gpt-4o-mini'),
        "mode": "ai_enhanced" if available else "no_ai_dev_mode",
        "message": (
            "Connected to OpenAI-compatible provider." 
            if available else 
            "Running in No-AI Development Mode: deterministic rule-based template generation is active. Configure AI_API_KEY for LLM refinement."
        )
    }

def generate_completion(system_prompt: str, user_prompt: str, temperature: float = 0.3) -> str:
    """
    Sends prompt to the configured OpenAI-compatible endpoint.
    If no API key is configured or call fails, raises AIProviderUnavailableError.
    """
    if not is_ai_available():
        raise AIProviderUnavailableError("AI API key is not configured on the server.")

    api_key = settings.AI_API_KEY.strip()
    model = getattr(settings, 'AI_MODEL', 'gpt-4o-mini')
    base_url = getattr(settings, 'AI_BASE_URL', '').strip() or "https://api.openai.com/v1"
    
    # Ensure URL ends in /chat/completions
    if not base_url.endswith('/chat/completions'):
        base_url = base_url.rstrip('/') + '/chat/completions'

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": temperature
    }

    try:
        response = requests.post(base_url, headers=headers, json=payload, timeout=45)
        response.raise_for_status()
        data = response.json()
        return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        raise AIProviderUnavailableError(f"AI provider request failed: {str(e)}")
