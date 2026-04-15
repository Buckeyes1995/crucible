"""Webhook Templates — pre-built configs for common services."""
from fastapi import APIRouter

router = APIRouter()

TEMPLATES = [
    {
        "id": "discord",
        "name": "Discord",
        "description": "Post to a Discord channel via webhook",
        "url_template": "https://discord.com/api/webhooks/{webhook_id}/{webhook_token}",
        "events": ["model.loaded", "benchmark.done"],
        "format": "discord",
        "example_payload": {"content": "Model loaded: {model_name}"},
    },
    {
        "id": "slack",
        "name": "Slack",
        "description": "Post to a Slack channel via incoming webhook",
        "url_template": "https://hooks.slack.com/services/{path}",
        "events": ["model.loaded", "model.unloaded", "benchmark.done"],
        "format": "slack",
        "example_payload": {"text": "Crucible: Model {model_name} loaded"},
    },
    {
        "id": "homeassistant",
        "name": "Home Assistant",
        "description": "Trigger a Home Assistant automation",
        "url_template": "http://{ha_host}:8123/api/webhook/{webhook_id}",
        "events": ["model.loaded", "model.unloaded"],
        "format": "json",
        "example_payload": {"event": "model.loaded", "model": "{model_name}"},
    },
    {
        "id": "ntfy",
        "name": "ntfy.sh",
        "description": "Push notification via ntfy",
        "url_template": "https://ntfy.sh/{topic}",
        "events": ["model.loaded", "benchmark.done", "download.done"],
        "format": "ntfy",
        "example_payload": {"topic": "crucible", "title": "Model loaded", "message": "{model_name}"},
    },
    {
        "id": "generic",
        "name": "Generic Webhook",
        "description": "POST JSON to any URL",
        "url_template": "{url}",
        "events": ["model.loaded", "model.unloaded", "benchmark.done", "download.done"],
        "format": "json",
    },
]

@router.get("/webhooks/templates")
async def list_templates():
    return TEMPLATES
