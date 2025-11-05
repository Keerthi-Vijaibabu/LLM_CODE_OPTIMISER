from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import re

app = Flask(__name__)
CORS(app)

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL_NAME = "qwen2.5-coder:7b"

SYSTEM_INSTRUCTION = """
You MUST reply with ONLY valid JSON.
NO explanations. NO markdown. NO backticks.

Response shape:
{
  "optimized_code": "string",
  "suggestions": [
    {
      "id": "S1",
      "title": "short title",
      "detail": "full explanation"
    }
  ],
  "metrics": {
    "language": "c",
    "loc_before": 0,
    "loc_after": 0,
    "reduction": 0
  }
}
You MUST follow this structure.
"""

USER_TEMPLATE = """
Optimize this code.

Improve:
- dead code removal
- better naming
- safer input
- modularity
- readability
- remove unused variables
- remove duplicate logic

Language: {language}

Code:
{code}
"""


def call_ollama(language, code):
    user_prompt = USER_TEMPLATE.format(language=language, code=code)
    full_prompt = SYSTEM_INSTRUCTION + "\n" + user_prompt

    resp = requests.post(
        OLLAMA_URL,
        json={"model": MODEL_NAME, "prompt": full_prompt, "stream": False},
        timeout=120
    )
    resp.raise_for_status()
    data = resp.json()
    print("\n=== RAW MODEL OUTPUT ===\n", data["response"], "\n=========================\n")
    return data["response"]


def extract_json(text):
    """
    Extract first JSON object from a string, even if surrounded by noise.
    Does NOT use recursive regex (Python doesn't support ?R).
    """

    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"```$", "", text).strip()

    start = text.find('{')
    if start == -1:
        print("*** RAW TEXT WITH NO JSON FOUND ***\n", text)
        raise ValueError("No JSON detected in LLM response")

    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                json_str = text[start:i+1]
                try:
                    return json.loads(json_str)
                except Exception as e:
                    print("FAILED JSON PARSE:\n", json_str)
                    raise e

    print("*** RAW TEXT WITH NO VALID JSON BLOCK FOUND ***\n", text)
    raise ValueError("Could not match complete JSON")



def normalize_suggestions(suggestions):
    """
    Ensure suggestions is an array of objects with id/title/detail fields.
    """
    normalized = []
    for i, s in enumerate(suggestions):
        if isinstance(s, str):
            normalized.append({
                "id": f"S{i+1}",
                "title": s[:40],
                "detail": s
            })
        elif isinstance(s, dict):
            # ensure missing fields
            normalized.append({
                "id": s.get("id", f"S{i+1}"),
                "title": s.get("title", s.get("description", "Suggestion")),
                "detail": s.get("detail", s.get("description", "")),
            })
        else:
            normalized.append({
                "id": f"S{i+1}",
                "title": "Suggestion",
                "detail": str(s)
            })
    return normalized


def normalize_metrics(metrics, language, code):
    """
    Standardize metrics keys.
    """
    loc = code.count("\n") + 1

    return {
        "language": language,
        "loc_before": metrics.get("Lines of Code Before", loc),
        "loc_after": metrics.get("Lines of Code After", loc),
        "reduction": metrics.get("Lines of Code Reduced", 0),
        "redundant_removed": metrics.get("Redundant Variables Removed", None),
        "security_improved": metrics.get("String Input Security Improved", False)
    }


@app.post("/optimize")
def optimize():
    data = request.get_json(force=True)

    language = data.get("language")
    code = data.get("code")

    if not isinstance(code, str):
        return jsonify({"error": "`code` must be a string"}), 400

    try:
        raw = call_ollama(language, code)
        parsed = extract_json(raw)
    except Exception as e:
        return jsonify({"error": f"LLM error: {str(e)}"}), 500

    # Ensure defaults
    parsed.setdefault("optimized_code", code)
    parsed.setdefault("suggestions", [])
    parsed.setdefault("metrics", {})

    # Normalize suggestions
    parsed["suggestions"] = normalize_suggestions(parsed.get("suggestions", []))

    # Normalize metrics
    parsed["metrics"] = normalize_metrics(parsed.get("metrics", {}), language, code)

    return jsonify(parsed), 200


@app.get("/")
def ping():
    return jsonify({"ok": True}), 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
