import os
import base64
import json
import requests
from django.conf import settings

class AIProviderUnavailableError(Exception):
    pass

def get_gemini_key() -> str:
    key = getattr(settings, 'GEMINI_API_KEY', '') or getattr(settings, 'AI_API_KEY', '')
    return key.strip() if key else ''

def is_ai_available() -> bool:
    api_key = getattr(settings, 'AI_API_KEY', '') or getattr(settings, 'GEMINI_API_KEY', '')
    return bool(api_key and api_key.strip())

def get_ai_status() -> dict:
    available = is_ai_available()
    gemini_key = get_gemini_key()
    provider = getattr(settings, 'AI_PROVIDER', 'gemini') if gemini_key else getattr(settings, 'AI_PROVIDER', 'openai')
    model = getattr(settings, 'GEMINI_MODEL', 'gemini-2.0-flash') if provider == 'gemini' else getattr(settings, 'AI_MODEL', 'gpt-4o-mini')
    
    return {
        "available": available,
        "provider": provider,
        "model": model,
        "mode": "ai_enhanced" if available else "no_ai_dev_mode",
        "message": (
            f"Connected to Google Gemini ({model}) for vision and synthesis."
            if provider == 'gemini' and available else
            ("Connected to OpenAI-compatible provider." if available else
             "Running in No-AI Development Mode: deterministic rule-based template generation is active. Configure GEMINI_API_KEY for LLM refinement.")
        )
    }

def generate_gemini_content(
    prompt: str,
    system_prompt: str = "",
    image_bytes: bytes | None = None,
    mime_type: str = "image/jpeg",
    temperature: float = 0.2,
    response_json: bool = False
) -> str:
    """
    Calls Google Gemini REST API (gemini-2.0-flash / gemini-1.5-flash)
    Supports multimodal inputs (image + text) and structured JSON outputs.
    """
    api_key = get_gemini_key()
    if not api_key:
        raise AIProviderUnavailableError("Gemini API key is not configured on the server.")

    model = getattr(settings, 'GEMINI_MODEL', 'gemini-2.0-flash')
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    parts = []
    if image_bytes:
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(image_bytes).decode("utf-8")
            }
        })
    parts.append({"text": prompt})

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": parts
            }
        ],
        "generationConfig": {
            "temperature": temperature,
        }
    }

    if response_json:
        payload["generationConfig"]["responseMimeType"] = "application/json"

    if system_prompt:
        payload["system_instruction"] = {
            "parts": [{"text": system_prompt}]
        }

    headers = {"Content-Type": "application/json"}

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=50)
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise AIProviderUnavailableError("Gemini API returned no candidates.")
        
        content = candidates[0].get("content", {})
        res_parts = content.get("parts", [])
        if not res_parts:
            raise AIProviderUnavailableError("Gemini API returned empty response parts.")
        
        return res_parts[0].get("text", "").strip()
    except requests.RequestException as e:
        raise AIProviderUnavailableError(f"Gemini API request failed: {str(e)}")

def generate_completion(system_prompt: str, user_prompt: str, temperature: float = 0.3) -> str:
    """
    Sends prompt to the configured AI provider (defaults to Gemini Flash, falls back to OpenAI endpoint).
    """
    gemini_key = get_gemini_key()
    provider = getattr(settings, 'AI_PROVIDER', 'gemini')
    
    if provider == 'gemini' or gemini_key:
        try:
            return generate_gemini_content(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=temperature
            )
        except AIProviderUnavailableError:
            # Fall back to OpenAI if configured
            if not getattr(settings, 'AI_API_KEY', ''):
                raise

    if not is_ai_available():
        raise AIProviderUnavailableError("AI API key is not configured on the server.")

    api_key = settings.AI_API_KEY.strip()
    model = getattr(settings, 'AI_MODEL', 'gpt-4o-mini')
    base_url = getattr(settings, 'AI_BASE_URL', '').strip() or "https://api.openai.com/v1"
    
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

def generate_vision_completion(
    prompt: str,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    system_prompt: str = "",
    response_json: bool = True
) -> str:
    """
    Multimodal vision completion using Gemini Flash or OpenAI Vision.
    """
    gemini_key = get_gemini_key()
    if gemini_key or getattr(settings, 'AI_PROVIDER', 'gemini') == 'gemini':
        return generate_gemini_content(
            prompt=prompt,
            system_prompt=system_prompt,
            image_bytes=image_bytes,
            mime_type=mime_type,
            temperature=0.1,
            response_json=response_json
        )
    
    # Fallback to OpenAI Vision
    api_key = getattr(settings, 'AI_API_KEY', '')
    if not api_key:
        raise AIProviderUnavailableError("Vision AI API key is not configured on the server.")

    base_url = getattr(settings, 'AI_BASE_URL', '').strip() or "https://api.openai.com/v1"
    if not base_url.endswith('/chat/completions'):
        base_url = base_url.rstrip('/') + '/chat/completions'

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}}
        ]
    })

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": getattr(settings, 'AI_MODEL', 'gpt-4o-mini'),
        "messages": messages,
        "temperature": 0.1
    }
    if response_json:
        payload["response_format"] = {"type": "json_object"}

    try:
        response = requests.post(base_url, headers=headers, json=payload, timeout=50)
        response.raise_for_status()
        data = response.json()
        return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        raise AIProviderUnavailableError(f"Vision AI request failed: {str(e)}")
