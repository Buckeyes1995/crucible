"""Built-in benchmark prompt library."""
from models.schemas import BenchmarkConfig

BUILTIN_PROMPTS: list[dict] = [
    # Short
    {
        "id": "short_1",
        "category": "Short",
        "text": "What is the capital of France?",
        "estimated_tokens": 8,
    },
    {
        "id": "short_2",
        "category": "Short",
        "text": "List 5 colors of the rainbow.",
        "estimated_tokens": 8,
    },
    {
        "id": "short_3",
        "category": "Short",
        "text": "Convert 100 Fahrenheit to Celsius.",
        "estimated_tokens": 7,
    },
    # Medium
    {
        "id": "medium_1",
        "category": "Medium",
        "text": (
            "Explain the difference between a stack and a queue data structure. "
            "Include a real-world analogy for each."
        ),
        "estimated_tokens": 28,
    },
    {
        "id": "medium_2",
        "category": "Medium",
        "text": (
            "What are the main differences between TCP and UDP? "
            "When would you choose one over the other?"
        ),
        "estimated_tokens": 24,
    },
    {
        "id": "medium_3",
        "category": "Medium",
        "text": (
            "Describe the water cycle. Include evaporation, condensation, "
            "precipitation, and collection."
        ),
        "estimated_tokens": 22,
    },
    # Long
    {
        "id": "long_1",
        "category": "Long",
        "text": (
            "You are a senior software engineer. Write a detailed technical design document "
            "for a URL shortening service that needs to handle 10,000 requests per second. "
            "Cover the system architecture, database schema, caching strategy, and potential "
            "failure modes. Be specific about technology choices and justify each decision."
        ),
        "estimated_tokens": 68,
    },
    {
        "id": "long_2",
        "category": "Long",
        "text": (
            "Explain how a modern web browser renders a webpage from the moment a URL is "
            "entered to the final painted pixels. Cover DNS resolution, TCP handshake, "
            "HTTP request/response, HTML parsing, CSS cascade, layout, paint, and compositing. "
            "Be thorough and technically accurate."
        ),
        "estimated_tokens": 58,
    },
    {
        "id": "long_3",
        "category": "Long",
        "text": (
            "Write a comprehensive comparison of relational vs. document vs. graph databases. "
            "For each type, explain the data model, strengths, weaknesses, and ideal use cases. "
            "Include at least two real-world examples per type and discuss how to choose between them "
            "when designing a new system."
        ),
        "estimated_tokens": 62,
    },
    # Coding
    {
        "id": "coding_1",
        "category": "Coding",
        "text": (
            "Write a Python function that implements binary search on a sorted list. "
            "Include type hints, docstring, and handle edge cases."
        ),
        "estimated_tokens": 30,
    },
    {
        "id": "coding_2",
        "category": "Coding",
        "text": (
            "Implement a thread-safe LRU cache in Python with get and put operations, "
            "both O(1). Show the full implementation with tests."
        ),
        "estimated_tokens": 30,
    },
    {
        "id": "coding_3",
        "category": "Coding",
        "text": (
            "Write a SQL query to find the top 5 customers by total revenue for each "
            "country in the last 30 days. Assume tables: orders(id, customer_id, country, "
            "amount, created_at) and customers(id, name)."
        ),
        "estimated_tokens": 52,
    },
    {
        "id": "coding_4",
        "category": "Coding",
        "text": (
            "Implement a fully working async Python web server from scratch using only asyncio "
            "(no frameworks). It should handle GET and POST requests, parse headers and body, "
            "and route to handler functions. Include error handling for 404 and 500 responses."
        ),
        "estimated_tokens": 55,
    },
    {
        "id": "coding_5",
        "category": "Coding",
        "text": (
            "You have a list of 1 million log lines in the format: "
            "'TIMESTAMP LEVEL MESSAGE'. Write a Python script that: "
            "(1) parses them efficiently, "
            "(2) counts occurrences of each log level, "
            "(3) finds the top 10 most frequent error messages, "
            "(4) groups errors by 5-minute time windows. "
            "Optimize for memory usage on a machine with 8GB RAM."
        ),
        "estimated_tokens": 75,
    },
    {
        "id": "coding_6",
        "category": "Coding",
        "text": (
            "Design and implement a rate limiter in Python that supports multiple strategies: "
            "fixed window, sliding window, and token bucket. "
            "The interface should be identical for all three strategies. "
            "Include unit tests and explain the trade-offs of each approach."
        ),
        "estimated_tokens": 60,
    },
    # Reasoning
    {
        "id": "reasoning_1",
        "category": "Reasoning",
        "text": (
            "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. "
            "How much does the ball cost? Show your reasoning step by step."
        ),
        "estimated_tokens": 38,
    },
    {
        "id": "reasoning_2",
        "category": "Reasoning",
        "text": (
            "There are 3 boxes. One contains only apples, one contains only oranges, and one "
            "contains both. All boxes are mislabeled. You can draw one fruit from one box. "
            "How do you correctly label all boxes? Explain your reasoning."
        ),
        "estimated_tokens": 55,
    },
    {
        "id": "reasoning_3",
        "category": "Reasoning",
        "text": (
            "Five houses in a row are each painted a different color. "
            "Each house is occupied by a person of a different nationality, "
            "who drinks a different beverage, smokes a different brand, and owns a different pet. "
            "Clues: The Brit lives in the red house. The Swede keeps dogs. The Dane drinks tea. "
            "The green house is left of the white house. The green house owner drinks coffee. "
            "The person who smokes Pall Mall keeps birds. The yellow house owner smokes Dunhill. "
            "The man in the center house drinks milk. The Norwegian lives in the first house. "
            "The Blend smoker lives next to the cat owner. The horse owner lives next to the Dunhill smoker. "
            "The BlueMaster smoker drinks beer. The German smokes Prince. "
            "The Norwegian lives next to the blue house. The Blend smoker has a neighbor who drinks water. "
            "Who owns the fish?"
        ),
        "estimated_tokens": 145,
    },
    {
        "id": "reasoning_4",
        "category": "Reasoning",
        "text": (
            "A company has 100 employees. In year 1, it grows by 20%. In year 2, it shrinks by 20%. "
            "In year 3, it grows by 10%. In year 4, it shrinks by 10%. "
            "How many employees does it have after year 4, and what is the net percentage change? "
            "Now generalize: if a company alternates between +X% and -X% growth for N cycles, "
            "what is the formula for final headcount? Prove it algebraically."
        ),
        "estimated_tokens": 72,
    },
    # Creative
    {
        "id": "creative_1",
        "category": "Creative",
        "text": (
            "Write a short story (3 paragraphs) about a lighthouse keeper who discovers "
            "that the light they tend has been guiding something other than ships."
        ),
        "estimated_tokens": 38,
    },
    {
        "id": "creative_2",
        "category": "Creative",
        "text": (
            "Write a product launch announcement for a fictional device: "
            "the NeuroDesk 3000, a computer controlled entirely by thought. "
            "Write it in the style of a Steve Jobs keynote — visionary, punchy, "
            "with a memorable one-liner. Include specs, pricing, and a call to action."
        ),
        "estimated_tokens": 58,
    },
    # Instruction-following
    {
        "id": "instruct_1",
        "category": "Instruction-following",
        "text": (
            "List exactly 7 programming languages, one per line, in alphabetical order. "
            "After each language, add a dash and its primary use case in 5 words or fewer. "
            "Do not include any other text."
        ),
        "estimated_tokens": 45,
    },
    {
        "id": "instruct_2",
        "category": "Instruction-following",
        "text": (
            "Rewrite the following paragraph at three different reading levels: "
            "Grade 5, Grade 10, and PhD. Label each version clearly. "
            "Paragraph: 'Photosynthesis is the process by which plants convert light energy "
            "into chemical energy stored in glucose, using carbon dioxide and water, "
            "and releasing oxygen as a byproduct.'"
        ),
        "estimated_tokens": 62,
    },
    # Complex coding — one-shot
    {
        "id": "coding_oneshot_1",
        "category": "Coding",
        "text": (
            "You are an expert Python engineer. Implement a complete, production-ready, single-file CLI tool "
            "called `logwatch.py` and save it to `/Users/jim/projects/forge/tmp/logwatch.py`. "
            "The tool monitors a log file in real time and surfaces anomalies. It must:\n\n"
            "1. **Tail the file** — watch a file path given as a CLI argument, streaming new lines as they are "
            "appended (like `tail -f`), handling file rotation (file replaced/truncated).\n"
            "2. **Parse lines** — each line is in the format: `YYYY-MM-DDTHH:MM:SS LEVEL MESSAGE` where LEVEL "
            "is one of DEBUG, INFO, WARN, ERROR, CRITICAL. Non-matching lines are classified as UNKNOWN.\n"
            "3. **Anomaly detection** — maintain a sliding 60-second window and alert when:\n"
            "   - ERROR or CRITICAL rate exceeds 5 per minute\n"
            "   - Any single MESSAGE appears more than 3 times in the window\n"
            "   - A 30-second gap with zero log lines (silence detection)\n"
            "4. **Live terminal dashboard** — update in place every 2 seconds showing: lines/min, errors/min, "
            "top 3 error messages, current anomaly alerts (highlighted), uptime, total line count.\n"
            "5. **Alert log** — append all triggered alerts to `alerts.log` in the same directory as the watched file.\n"
            "6. **Graceful shutdown** — Ctrl+C prints a final summary (total lines, total alerts, runtime).\n\n"
            "Requirements: stdlib only (Python 3.10+). Include a usage comment at the top. "
            "Write the complete file — no placeholders, no ellipsis, no 'implement this yourself'."
        ),
        "estimated_tokens": 220,
    },
    {
        "id": "instruct_3",
        "category": "Instruction-following",
        "text": (
            "You will respond only in JSON. No prose, no markdown, no explanation. "
            "Generate a JSON object representing a fictional person with these fields: "
            "name, age, occupation, city, skills (array of 4), bio (one sentence). "
            "The output must be valid, parseable JSON and nothing else."
        ),
        "estimated_tokens": 58,
    },
    # Math
    {
        "id": "math_1",
        "category": "Math",
        "text": (
            "Solve step by step: A train leaves station A at 60 mph. Another train leaves "
            "station B (300 miles away) at 90 mph heading toward station A, 30 minutes later. "
            "When and where do they meet? Show all work."
        ),
        "estimated_tokens": 52,
    },
    {
        "id": "math_2",
        "category": "Math",
        "text": (
            "Explain and derive the formula for the sum of a geometric series. "
            "Then use it to calculate: what is the total distance traveled by a ball "
            "that is dropped from 10 meters and bounces to 60% of its previous height each time, "
            "assuming infinite bounces?"
        ),
        "estimated_tokens": 58,
    },
]

PROMPT_MAP: dict[str, dict] = {p["id"]: p for p in BUILTIN_PROMPTS}

# Preset bundles for quick selection
PRESETS: dict[str, list[str]] = {
    "quick": ["short_1", "coding_1", "reasoning_1"],
    "standard": ["short_1", "short_2", "medium_1", "coding_1", "coding_2", "reasoning_1", "reasoning_2"],
    "deep": [p["id"] for p in BUILTIN_PROMPTS],
}


def get_prompts_for_run(config: BenchmarkConfig) -> list[dict]:
    """Resolve prompt IDs + custom prompts into a list of prompt dicts."""
    prompts = []
    for pid in config.prompt_ids:
        if pid in PROMPT_MAP:
            prompts.append(PROMPT_MAP[pid])
    for i, text in enumerate(config.custom_prompts):
        prompts.append({
            "id": f"custom_{i}",
            "category": "Custom",
            "text": text,
            "estimated_tokens": len(text.split()),
        })
    return prompts
