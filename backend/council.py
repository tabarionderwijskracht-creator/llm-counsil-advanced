"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple, Optional
from .openrouter import query_models_parallel, query_model
from .config import COUNCIL_MODELS, CHAIRMAN_MODEL, RESEARCH_MODEL

# Research system prompt for Stage 0
RESEARCH_SYSTEM_PROMPT = """You are a research assistant. Search the web to find current, factual information relevant to the user's question. Focus on:
- Recent news and developments
- Official sources and documentation
- Statistics and data
- Expert opinions and analyses

Provide a comprehensive research summary that will help other AI models answer the question accurately."""


async def stage0_research(user_query: str) -> Optional[Dict[str, Any]]:
    """
    Stage 0: Use Perplexity to perform web research before council deliberation.

    Args:
        user_query: The user's question

    Returns:
        Dict with 'content' and 'sources' keys, or None if research failed
    """
    messages = [
        {"role": "system", "content": RESEARCH_SYSTEM_PROMPT},
        {"role": "user", "content": user_query}
    ]

    print(f"\n=== STAGE 0 RESEARCH ===")
    print(f"Query: {user_query[:80]}...")

    response = await query_model(RESEARCH_MODEL, messages, timeout=120.0)

    if response is None:
        print("Research failed - Perplexity did not respond")
        return None

    # Extract citations if available (Perplexity returns these)
    citations = response.get("citations", [])

    # Convert citations to sources format
    sources = []
    for i, url in enumerate(citations):
        sources.append({
            "title": f"Source {i + 1}",
            "url": url
        })

    print(f"Research complete: {len(response.get('content', ''))} chars, {len(sources)} sources")
    print("=== END STAGE 0 ===\n")

    return {
        "content": response.get("content", ""),
        "sources": sources
    }


def build_prompt_with_research(query: str, research: Optional[Dict[str, Any]]) -> str:
    """Build a user prompt that includes research context."""
    if not research:
        return query

    sources_text = "\n".join(
        f"- {s['title']}: {s['url']}" for s in research.get('sources', [])
    )

    return f"""[Web Research Results]
{research['content']}

Sources:
{sources_text}

[User Question]
{query}"""


async def stage1_collect_responses(
    user_query: str,
    conversation_history: List[Dict[str, Any]] = None,
    on_model_complete: callable = None,
    research_context: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        conversation_history: Previous messages in the conversation (optional)
        on_model_complete: Optional callback(model, response) for progress tracking
        research_context: Optional research results from Stage 0 to include in prompt

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    # Build messages with conversation history
    messages = []

    # Debug logging
    print(f"\n=== STAGE 1 DEBUG ===")
    print(f"Conversation history: {len(conversation_history) if conversation_history else 0} messages")
    print(f"Research context: {'Yes' if research_context else 'No'}")

    if conversation_history:
        for i, msg in enumerate(conversation_history):
            role = msg.get("role")
            if role == "user":
                content = msg.get("content", "")
                messages.append({"role": "user", "content": content})
                print(f"  [{i}] USER: {content[:80]}...")
            elif role == "assistant" and msg.get("stage3"):
                # Use the final council answer as assistant response
                content = msg["stage3"].get("response", "")
                messages.append({"role": "assistant", "content": content})
                print(f"  [{i}] ASSISTANT: {content[:80]}...")
            else:
                print(f"  [{i}] SKIPPED: role={role}, has_stage3={bool(msg.get('stage3'))}")

    # Build the current query - include research context if available
    current_query = build_prompt_with_research(user_query, research_context)

    # Add current user query
    messages.append({"role": "user", "content": current_query})
    print(f"  [NEW] USER: {current_query[:80]}...")
    print(f"Total messages to send: {len(messages)}")
    print("=== END DEBUG ===\n")

    # Query all models in parallel with progress callback
    responses = await query_models_parallel(
        COUNCIL_MODELS,
        messages,
        on_model_complete=on_model_complete
    )

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    on_model_complete: callable = None
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel with progress callback
    responses = await query_models_parallel(
        COUNCIL_MODELS,
        messages,
        on_model_complete=on_model_complete
    )

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2

    Returns:
        Dict with 'model' and 'response' keys
    """
    from datetime import datetime

    # Get current date for temporal context
    current_date = datetime.now().strftime("%B %d, %Y")

    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    chairman_prompt = f"""Today's Date: {current_date}

User Question: {user_query}

Multiple AI responses to consider:
{stage1_text}

Peer evaluations:
{stage2_text}

Your task: Write the FINAL ANSWER to the user's question.

CRITICAL RULES:
1. Output ONLY the answer - no meta-commentary, no "as chairman", no explanations about your process
2. Respond in the SAME LANGUAGE as the user's question
3. When models agree on factual information (especially from web research), trust that consensus
4. Synthesize the best parts of all responses into one clear, direct answer
5. Do NOT contradict verified facts that multiple models agree on
6. Be concise - only include information that directly answers the question

Write your answer now:"""

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model
    response = await query_model(CHAIRMAN_MODEL, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": CHAIRMAN_MODEL,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": CHAIRMAN_MODEL,
        "response": response.get('content', '')
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use gemini-2.5-flash for title generation (fast and cheap)
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(
    user_query: str,
    conversation_history: List[Dict[str, Any]] = None
) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        conversation_history: Previous messages in the conversation (optional)

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, conversation_history)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
