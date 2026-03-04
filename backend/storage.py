"""JSON-based storage for conversations with tree-based message structure."""

import json
import os
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional, Set
from pathlib import Path
from .config import DATA_DIR


def format_number_with_commas(num: int) -> str:
    """Format a number with commas for readability (e.g., 12345 -> '12,345')."""
    return f"{num:,}"


def create_snip_placeholder(text: str, head_chars: int = 100, tail_chars: int = 100) -> str:
    """
    Create a smart placeholder for truncated content.
    Shows the first and last N characters with a snip indicator in between.

    Args:
        text: The full text to truncate
        head_chars: Number of characters to show at the start (default: 100)
        tail_chars: Number of characters to show at the end (default: 100)

    Returns:
        The truncated text with snip placeholder, or original text if short enough
    """
    if not text or not isinstance(text, str):
        return text or ""

    min_length = head_chars + tail_chars + 50  # Need some content to snip

    if len(text) <= min_length:
        return text

    head = text[:head_chars]
    tail = text[-tail_chars:]
    snipped_chars = len(text) - head_chars - tail_chars

    return f"{head}\n\n... snip {format_number_with_commas(snipped_chars)} characters ...\n\n{tail}"

# Current schema version
SCHEMA_VERSION = 2

# Archived conversations directory
ARCHIVE_DIR = os.path.join(os.path.dirname(DATA_DIR), "archived")


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def ensure_archive_dir():
    """Ensure the archive directory exists."""
    Path(ARCHIVE_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def get_archived_conversation_path(conversation_id: str) -> str:
    """Get the file path for an archived conversation."""
    return os.path.join(ARCHIVE_DIR, f"{conversation_id}.json")


def generate_message_id() -> str:
    """Generate a unique message ID."""
    return f"m_{uuid.uuid4().hex[:12]}"


def migrate_v1_to_v2(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Migrate a v1 (linear array) conversation to v2 (tree structure).

    Args:
        conversation: v1 conversation with messages as array

    Returns:
        v2 conversation with messages as dict with parent pointers
    """
    if conversation.get("schema_version", 1) >= 2:
        return conversation

    messages_dict = {}
    prev_id = None

    for msg in conversation.get("messages", []):
        msg_id = generate_message_id()
        messages_dict[msg_id] = {
            **msg,
            "id": msg_id,
            "parent_id": prev_id,
            "created_at": msg.get("created_at", conversation.get("created_at", datetime.utcnow().isoformat()))
        }
        prev_id = msg_id

    return {
        "id": conversation["id"],
        "title": conversation.get("title", "New Conversation"),
        "created_at": conversation.get("created_at", datetime.utcnow().isoformat()),
        "schema_version": SCHEMA_VERSION,
        "messages": messages_dict,
        "current_leaf_id": prev_id
    }


def get_message_path(messages: Dict[str, Any], leaf_id: Optional[str]) -> List[str]:
    """
    Get the ordered list of message IDs from root to leaf.

    Args:
        messages: Dict of message_id -> message
        leaf_id: The leaf message ID to trace back from

    Returns:
        List of message IDs in chronological order (root first)
    """
    if not leaf_id or not messages:
        return []

    path = []
    current_id = leaf_id

    while current_id is not None:
        if current_id not in messages:
            break
        path.append(current_id)
        current_id = messages[current_id].get("parent_id")

    return list(reversed(path))


def get_siblings(messages: Dict[str, Any], message_id: str) -> List[str]:
    """
    Get all sibling message IDs (same parent_id and role).

    Args:
        messages: Dict of message_id -> message
        message_id: The message to find siblings for

    Returns:
        List of sibling message IDs (including the original), sorted by created_at
    """
    if message_id not in messages:
        return []

    target_msg = messages[message_id]
    target_parent = target_msg.get("parent_id")
    target_role = target_msg.get("role")

    siblings = [
        mid for mid, msg in messages.items()
        if msg.get("parent_id") == target_parent and msg.get("role") == target_role
    ]

    # Sort by created_at
    siblings.sort(key=lambda mid: messages[mid].get("created_at", ""))

    return siblings


def find_branch_leaf(messages: Dict[str, Any], message_id: str) -> str:
    """
    Find the leaf of the branch containing a given message.

    Follows the "first child" at each level to find a leaf.

    Args:
        messages: Dict of message_id -> message
        message_id: Starting message ID

    Returns:
        The leaf message ID of the branch
    """
    current_id = message_id

    while True:
        # Find children of current message
        children = [
            mid for mid, msg in messages.items()
            if msg.get("parent_id") == current_id
        ]

        if not children:
            # No children, this is a leaf
            return current_id

        # Sort by created_at and take first (oldest)
        children.sort(key=lambda mid: messages[mid].get("created_at", ""))
        current_id = children[0]


def get_conversation_history_from_path(
    messages: Dict[str, Any],
    path: List[str],
    excluded_ids: Optional[Set[str]] = None
) -> List[Dict[str, Any]]:
    """
    Convert a message path to conversation history format for the council.

    For excluded messages, includes a smart placeholder showing the first and last
    100 characters with a "snip X characters" indicator, giving the LLM some
    context without the full content.

    Args:
        messages: Dict of message_id -> message
        path: Ordered list of message IDs
        excluded_ids: Optional set of message IDs to truncate with smart placeholders

    Returns:
        List of messages in the format expected by council.py
    """
    history = []
    excluded = excluded_ids or set()

    for msg_id in path:
        if msg_id in messages:
            msg = messages[msg_id]
            is_excluded = msg_id in excluded

            # Return the message without tree-specific fields
            history_msg = {
                "role": msg["role"],
            }

            if msg["role"] == "user":
                content = msg.get("content", "")
                if is_excluded:
                    # Create smart placeholder for excluded user message
                    history_msg["content"] = f"[Excluded from context]\n\n{create_snip_placeholder(content, 100, 100)}"
                else:
                    history_msg["content"] = content
            elif msg["role"] == "assistant":
                if is_excluded:
                    # For excluded assistant messages, create a truncated stage3 response
                    # and clear stage1/stage2 to reduce context size
                    stage3 = msg.get("stage3", {})
                    response = stage3.get("response", "") if stage3 else ""
                    history_msg["stage1"] = None
                    history_msg["stage2"] = None
                    history_msg["stage3"] = {
                        "response": f"[Excluded from context]\n\n{create_snip_placeholder(response, 100, 100)}"
                    }
                else:
                    history_msg["stage1"] = msg.get("stage1")
                    history_msg["stage2"] = msg.get("stage2")
                    history_msg["stage3"] = msg.get("stage3")

            history.append(history_msg)
    return history


def count_messages_in_tree(messages: Dict[str, Any]) -> int:
    """
    Count total messages in the tree (for metadata).

    Args:
        messages: Dict of message_id -> message

    Returns:
        Total number of messages
    """
    return len(messages) if messages else 0


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation with v2 schema.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "schema_version": SCHEMA_VERSION,
        "messages": {},
        "current_leaf_id": None
    }

    # Save to file
    path = get_conversation_path(conversation_id)
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage, migrating if needed.
    Checks both active and archived directories.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict (v2 format) or None if not found
    """
    # Check active directory first
    path = get_conversation_path(conversation_id)

    # If not in active, check archived directory
    if not os.path.exists(path):
        path = get_archived_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, 'r') as f:
        conversation = json.load(f)

    # Migrate if needed - save back to the same location
    if conversation.get("schema_version", 1) < SCHEMA_VERSION:
        conversation = migrate_v1_to_v2(conversation)
        # Save migrated version to same location (don't unarchive)
        with open(path, 'w') as f:
            json.dump(conversation, f, indent=2)

    return conversation


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage and update search index.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation['id'])
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)

    # Update search index (lazy import to avoid circular dependency)
    try:
        from . import search
        search.index_conversation(conversation, is_archived=False)
    except Exception:
        pass  # Don't fail save if indexing fails


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    data_path = Path(DATA_DIR)

    if not data_path.exists():
        return conversations

    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            filepath = os.path.join(DATA_DIR, filename)
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)

                    # Handle both v1 and v2 formats for message count
                    # Use current_path length for v2 (shows messages in current branch)
                    if data.get("schema_version", 1) >= 2:
                        messages = data.get("messages", {})
                        current_leaf_id = data.get("current_leaf_id")
                        # Compute current_path from current_leaf_id
                        current_path = get_message_path(messages, current_leaf_id)
                        message_count = len(current_path)
                    else:
                        message_count = len(data.get("messages", []))

                    conversations.append({
                        "id": data["id"],
                        "created_at": data.get("created_at", ""),
                        "title": data.get("title", "New Conversation"),
                        "message_count": message_count
                    })
            except (json.JSONDecodeError, KeyError):
                # Skip corrupted files
                continue

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(
    conversation_id: str,
    content: str,
    parent_id: Optional[str] = None,
    attachment_ids: Optional[List[str]] = None,
    attachments: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
        parent_id: Parent message ID (uses current_leaf_id if None)
        attachment_ids: Optional list of attachment file IDs (legacy, prefer attachments)
        attachments: Optional list of attachment metadata dicts with id, name, page_count

    Returns:
        The new message ID
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    messages = conversation.get("messages", {})

    # Use current_leaf_id as parent if not specified
    if parent_id is None:
        parent_id = conversation.get("current_leaf_id")

    # If the current leaf is a user message (e.g., cancelled request),
    # create a sibling instead of a child (use the leaf's parent)
    if parent_id and parent_id in messages:
        leaf_msg = messages[parent_id]
        if leaf_msg.get("role") == "user":
            # Create sibling by using the same parent as the current leaf
            parent_id = leaf_msg.get("parent_id")

    msg_id = generate_message_id()
    msg_data = {
        "id": msg_id,
        "parent_id": parent_id,
        "role": "user",
        "content": content,
        "created_at": datetime.utcnow().isoformat(),
        # Job tracking
        "job_status": "pending",
        "job_started_at": datetime.utcnow().isoformat()
    }

    # Add attachment metadata if provided (full metadata preferred)
    if attachments:
        msg_data["attachments"] = attachments
    elif attachment_ids:
        # Legacy: store IDs only if full metadata not provided
        msg_data["attachment_ids"] = attachment_ids

    conversation["messages"][msg_id] = msg_data

    # Update current_leaf_id
    conversation["current_leaf_id"] = msg_id

    save_conversation(conversation)
    return msg_id


def update_job_status(
    conversation_id: str,
    message_id: str,
    status: str,
    error: Optional[str] = None,
    model_progress: Optional[Dict[str, str]] = None
):
    """
    Update the job status for a user message.

    Args:
        conversation_id: Conversation identifier
        message_id: User message ID
        status: New status ('pending', 'stage1', 'stage2', 'stage3', 'complete', 'error')
        error: Optional error message
        model_progress: Optional dict of model -> status ('pending', 'complete', 'failed', 'timeout')
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if message_id not in conversation["messages"]:
        raise ValueError(f"Message {message_id} not found")

    conversation["messages"][message_id]["job_status"] = status
    if error:
        conversation["messages"][message_id]["job_error"] = error
    if model_progress is not None:
        conversation["messages"][message_id]["model_progress"] = model_progress

    save_conversation(conversation)


def update_model_progress(
    conversation_id: str,
    message_id: str,
    model: str,
    status: str
):
    """
    Update the progress for a specific model within a job.

    Args:
        conversation_id: Conversation identifier
        message_id: User message ID
        model: Model identifier
        status: Model status ('pending', 'complete', 'failed', 'timeout')
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if message_id not in conversation["messages"]:
        raise ValueError(f"Message {message_id} not found")

    msg = conversation["messages"][message_id]
    if "model_progress" not in msg:
        msg["model_progress"] = {}

    msg["model_progress"][model] = status
    save_conversation(conversation)


def get_job_info(conversation_id: str, message_id: str) -> Optional[Dict[str, Any]]:
    """
    Get job info for a user message.

    Returns dict with job_status, job_started_at, job_error (if any), elapsed_seconds
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None

    if message_id not in conversation["messages"]:
        return None

    msg = conversation["messages"][message_id]
    if msg.get("role") != "user":
        return None

    started_at = msg.get("job_started_at")
    elapsed = 0
    if started_at:
        try:
            start_time = datetime.fromisoformat(started_at)
            elapsed = int((datetime.utcnow() - start_time).total_seconds())
        except:
            pass

    return {
        "status": msg.get("job_status", "unknown"),
        "started_at": started_at,
        "elapsed_seconds": elapsed,
        "error": msg.get("job_error"),
        "model_progress": msg.get("model_progress", {})
    }


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    parent_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> str:
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        parent_id: Parent message ID (uses current_leaf_id if None)
        metadata: Optional metadata dict (label_to_model, aggregate_rankings)

    Returns:
        The new message ID
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    # Use current_leaf_id as parent if not specified
    if parent_id is None:
        parent_id = conversation.get("current_leaf_id")

    msg_id = generate_message_id()
    msg_data = {
        "id": msg_id,
        "parent_id": parent_id,
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
        "created_at": datetime.utcnow().isoformat()
    }

    # Add metadata if provided
    if metadata:
        msg_data["metadata"] = metadata

    conversation["messages"][msg_id] = msg_data

    # Update current_leaf_id
    conversation["current_leaf_id"] = msg_id

    save_conversation(conversation)
    return msg_id


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


def navigate_to_message(conversation_id: str, message_id: str) -> Dict[str, Any]:
    """
    Navigate to a different branch by setting the current leaf.

    Args:
        conversation_id: Conversation identifier
        message_id: Message ID to navigate to (will find its branch's leaf)

    Returns:
        Dict with new current_leaf_id and current_path
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    messages = conversation.get("messages", {})
    if message_id not in messages:
        raise ValueError(f"Message {message_id} not found")

    # Find the leaf of this branch
    leaf_id = find_branch_leaf(messages, message_id)

    # Update current_leaf_id
    conversation["current_leaf_id"] = leaf_id
    save_conversation(conversation)

    # Return navigation info
    current_path = get_message_path(messages, leaf_id)
    return {
        "current_leaf_id": leaf_id,
        "current_path": current_path
    }


def get_conversation_with_path(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a conversation with computed current_path.

    Args:
        conversation_id: Conversation identifier

    Returns:
        Conversation dict with current_path added, or None if not found
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None

    messages = conversation.get("messages", {})
    current_leaf_id = conversation.get("current_leaf_id")

    conversation["current_path"] = get_message_path(messages, current_leaf_id)

    return conversation


def delete_conversation(conversation_id: str) -> bool:
    """
    Delete a conversation from storage and search index.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        True if deleted, False if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return False

    os.remove(path)

    # Remove from search index
    try:
        from . import search
        search.remove_conversation_from_index(conversation_id)
    except Exception:
        pass

    return True


def archive_conversation(conversation_id: str) -> bool:
    """
    Archive a conversation by moving it to the archive directory.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        True if archived, False if not found
    """
    source_path = get_conversation_path(conversation_id)

    if not os.path.exists(source_path):
        return False

    # Load conversation for re-indexing
    conversation = get_conversation(conversation_id)

    ensure_archive_dir()
    dest_path = get_archived_conversation_path(conversation_id)

    # Move the file
    os.rename(source_path, dest_path)

    # Update search index with archived flag
    if conversation:
        try:
            from . import search
            search.index_conversation(conversation, is_archived=True)
        except Exception:
            pass

    return True


def unarchive_conversation(conversation_id: str) -> bool:
    """
    Unarchive a conversation by moving it back to the main data directory.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        True if unarchived, False if not found
    """
    source_path = get_archived_conversation_path(conversation_id)

    if not os.path.exists(source_path):
        return False

    # Load conversation for re-indexing
    conversation = get_conversation(conversation_id)

    ensure_data_dir()
    dest_path = get_conversation_path(conversation_id)

    # Move the file back
    os.rename(source_path, dest_path)

    # Update search index with unarchived flag
    if conversation:
        try:
            from . import search
            search.index_conversation(conversation, is_archived=False)
        except Exception:
            pass

    return True


def list_archived_conversations() -> List[Dict[str, Any]]:
    """
    List all archived conversations (metadata only).

    Returns:
        List of archived conversation metadata dicts
    """
    ensure_archive_dir()

    conversations = []
    archive_path = Path(ARCHIVE_DIR)

    if not archive_path.exists():
        return conversations

    for filename in os.listdir(ARCHIVE_DIR):
        if filename.endswith('.json'):
            filepath = os.path.join(ARCHIVE_DIR, filename)
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)

                    # Handle both v1 and v2 formats for message count
                    if data.get("schema_version", 1) >= 2:
                        messages = data.get("messages", {})
                        current_leaf_id = data.get("current_leaf_id")
                        current_path = get_message_path(messages, current_leaf_id)
                        message_count = len(current_path)
                    else:
                        message_count = len(data.get("messages", []))

                    conversations.append({
                        "id": data["id"],
                        "created_at": data.get("created_at", ""),
                        "title": data.get("title", "New Conversation"),
                        "message_count": message_count
                    })
            except (json.JSONDecodeError, KeyError):
                # Skip corrupted files
                continue

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations
