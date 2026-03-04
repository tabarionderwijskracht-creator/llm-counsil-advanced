"""FastAPI backend for LLM Council."""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio
import os
import fitz  # PyMuPDF

from . import storage
from . import search
from .council import (
    run_full_council,
    generate_conversation_title,
    stage0_research,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
    calculate_aggregate_rankings
)
from .config import COUNCIL_MODELS, UPLOADS_DIR, MAX_FILE_SIZE_MB, ALLOWED_EXTENSIONS, MAX_TEXT_CHARS, WARN_TEXT_CHARS, RESEARCH_ENABLED_DEFAULT

# Track running jobs for cancellation
# Key: (conversation_id, message_id), Value: {"task": asyncio.Task, "cancelled": bool}
running_jobs: Dict[tuple, Dict[str, Any]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle app startup and shutdown events."""
    # Startup
    search.ensure_index_exists()
    yield
    # Shutdown
    pass


app = FastAPI(title="LLM Council API", lifespan=lifespan)

# Enable CORS for local development and network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://192.168.50.177:5173",
        "http://192.168.50.177:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    excluded_message_ids: Optional[List[str]] = None  # Message IDs to exclude from context
    attachment_ids: Optional[List[str]] = None  # File IDs to include as context
    research_enabled: Optional[bool] = None  # Enable Stage 0 web research (defaults to config)


class EditMessageRequest(BaseModel):
    """Request to edit a message and create a new branch."""
    message_id: str
    content: str


class NavigateRequest(BaseModel):
    """Request to navigate to a different branch."""
    message_id: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int
    folder_id: Optional[str] = None


class CreateFolderRequest(BaseModel):
    """Request to create a new folder."""
    name: str


class UpdateFolderRequest(BaseModel):
    """Request to update a folder."""
    name: str


class MoveToFolderRequest(BaseModel):
    """Request to move a conversation to a folder."""
    folder_id: Optional[str] = None  # None to remove from folder


class FolderResponse(BaseModel):
    """Folder response."""
    id: str
    name: str
    created_at: str


class ConversationV2(BaseModel):
    """Full conversation with tree-based messages (v2 schema)."""
    id: str
    created_at: str
    title: str
    schema_version: int
    messages: Dict[str, Any]
    current_leaf_id: Optional[str]
    current_path: List[str]


def get_attachment_text(conversation_id: str, attachment_ids: List[str]) -> str:
    """
    Fetch text content from uploaded PDF files.
    Returns formatted document text to prepend to user query.
    """
    if not attachment_ids:
        return ""

    documents_text = []
    for file_id in attachment_ids:
        file_path = os.path.join(UPLOADS_DIR, conversation_id, f"{file_id}.pdf")
        if not os.path.exists(file_path):
            continue

        try:
            pdf_doc = fitz.open(file_path)
            text_content = ""
            for page in pdf_doc:
                text_content += page.get_text()
            pdf_doc.close()

            # Get original filename from the file if possible
            filename = f"{file_id}.pdf"
            documents_text.append(f"[Document: {filename}]\n{text_content}")
        except Exception as e:
            print(f"Error reading attachment {file_id}: {e}")
            continue

    if not documents_text:
        return ""

    return "\n\n".join(documents_text) + "\n\n[User Question]\n"


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


# ============================================================================
# Folder Endpoints
# ============================================================================

@app.get("/api/folders", response_model=List[FolderResponse])
async def list_folders():
    """List all folders."""
    return storage.list_folders()


@app.post("/api/folders", response_model=FolderResponse)
async def create_folder(request: CreateFolderRequest):
    """Create a new folder."""
    return storage.create_folder(request.name)


@app.put("/api/folders/{folder_id}", response_model=FolderResponse)
async def update_folder(folder_id: str, request: UpdateFolderRequest):
    """Update a folder's name."""
    folder = storage.update_folder(folder_id, request.name)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: str):
    """Delete a folder. Conversations in the folder are moved to no folder."""
    if not storage.delete_folder(folder_id):
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"status": "ok", "message": "Folder deleted"}


@app.post("/api/conversations/{conversation_id}/move")
async def move_conversation_to_folder(conversation_id: str, request: MoveToFolderRequest):
    """Move a conversation to a folder (or remove from folder if folder_id is null)."""
    if not storage.move_conversation_to_folder(conversation_id, request.folder_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "ok", "message": "Conversation moved"}


# ============================================================================
# Conversation Endpoints
# ============================================================================

@app.post("/api/conversations")
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    # Add current_path for consistency
    conversation["current_path"] = []
    return conversation


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages and current path."""
    conversation = storage.get_conversation_with_path(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message (empty messages dict)
    is_first_message = len(conversation.get("messages", {})) == 0

    # Get conversation history from current path
    messages = conversation.get("messages", {})
    current_leaf_id = conversation.get("current_leaf_id")
    current_path = storage.get_message_path(messages, current_leaf_id)

    # Get excluded message IDs (will be shown as smart placeholders)
    excluded_ids = set(request.excluded_message_ids or [])
    conversation_history = storage.get_conversation_history_from_path(messages, current_path, excluded_ids)

    # Add user message (automatically updates current_leaf_id)
    user_msg_id = storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process with conversation history
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        conversation_history
    )

    # Add assistant message (parent is the user message we just added)
    assistant_msg_id = storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata=metadata
    )

    # Get updated conversation with path
    updated_conv = storage.get_conversation_with_path(conversation_id)

    # Return the complete response with metadata and message IDs
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata,
        "user_message_id": user_msg_id,
        "assistant_message_id": assistant_msg_id,
        "current_leaf_id": updated_conv["current_leaf_id"],
        "current_path": updated_conv["current_path"]
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation.get("messages", {})) == 0

    # Get conversation history from current path
    messages = conversation.get("messages", {})
    current_leaf_id = conversation.get("current_leaf_id")
    current_path = storage.get_message_path(messages, current_leaf_id)

    # Get excluded message IDs (will be shown as smart placeholders)
    excluded_ids = set(request.excluded_message_ids or [])
    conversation_history = storage.get_conversation_history_from_path(messages, current_path, excluded_ids)

    # Get document context if attachments are provided
    document_context = get_attachment_text(conversation_id, request.attachment_ids or [])
    query_with_context = document_context + request.content if document_context else request.content

    # Build attachment metadata for storage
    attachments_metadata = []
    if request.attachment_ids:
        for file_id in request.attachment_ids:
            file_path = os.path.join(UPLOADS_DIR, conversation_id, f"{file_id}.pdf")
            metadata_path = os.path.join(UPLOADS_DIR, conversation_id, f"{file_id}.json")
            if os.path.exists(file_path):
                # Try to load metadata from JSON file
                original_name = f"{file_id}.pdf"
                page_count = 0
                try:
                    if os.path.exists(metadata_path):
                        with open(metadata_path, "r") as f:
                            meta = json.load(f)
                            original_name = meta.get("original_name", original_name)
                            page_count = meta.get("page_count", 0)
                    else:
                        # Fallback: read page count from PDF
                        pdf_doc = fitz.open(file_path)
                        page_count = len(pdf_doc)
                        pdf_doc.close()
                except:
                    pass
                attachments_metadata.append({
                    "id": file_id,
                    "name": original_name,
                    "page_count": page_count
                })

    async def event_generator():
        user_msg_id = None
        job_key = None
        # Queue for SSE events from callbacks
        event_queue = asyncio.Queue()

        def is_cancelled():
            """Check if the job has been cancelled."""
            if job_key and job_key in running_jobs:
                return running_jobs[job_key].get("cancelled", False)
            return False

        async def model_progress_callback(model: str, response):
            """Callback to track individual model completion."""
            if is_cancelled():
                return
            status = 'complete' if response is not None else 'failed'
            model_short = model.split('/')[1] if '/' in model else model
            await event_queue.put({
                'type': 'model_complete',
                'data': {'model': model, 'model_short': model_short, 'status': status}
            })

        try:
            # Add user message (job_status starts as 'pending')
            user_msg_id = storage.add_user_message(
                conversation_id,
                request.content,
                attachment_ids=request.attachment_ids,
                attachments=attachments_metadata if attachments_metadata else None
            )
            job_key = (conversation_id, user_msg_id)

            # Register this job for potential cancellation
            running_jobs[job_key] = {"cancelled": False, "task": None}

            yield f"data: {json.dumps({'type': 'user_message_created', 'data': {'message_id': user_msg_id}})}\n\n"

            # Check for cancellation
            if is_cancelled():
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Job cancelled by user'})}\n\n"
                return

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Stage 0: Web research (if enabled)
            research_enabled = request.research_enabled if request.research_enabled is not None else RESEARCH_ENABLED_DEFAULT
            research_context = None

            if research_enabled:
                yield f"data: {json.dumps({'type': 'stage0_start'})}\n\n"
                research_context = await stage0_research(request.content)
                if research_context:
                    yield f"data: {json.dumps({'type': 'stage0_complete', 'data': research_context})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'stage0_complete', 'data': None})}\n\n"

                # Check for cancellation after stage 0
                if is_cancelled():
                    yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Job cancelled by user'})}\n\n"
                    return

            # Stage 1: Collect responses (with conversation history)
            # Initialize model progress for all council models
            initial_progress = {model: 'pending' for model in COUNCIL_MODELS}
            storage.update_job_status(conversation_id, user_msg_id, 'stage1', model_progress=initial_progress)
            yield f"data: {json.dumps({'type': 'stage1_start', 'data': {'models': COUNCIL_MODELS}})}\n\n"

            # Run stage1 with progress tracking (use query_with_context for document support)
            stage1_task = asyncio.create_task(
                stage1_collect_responses(query_with_context, conversation_history, on_model_complete=model_progress_callback, research_context=research_context)
            )

            # Emit progress events as they come in
            completed_count = 0
            while completed_count < len(COUNCIL_MODELS):
                try:
                    # Wait for either a progress event or stage1 to complete
                    done, pending = await asyncio.wait(
                        [asyncio.create_task(event_queue.get()), stage1_task],
                        return_when=asyncio.FIRST_COMPLETED,
                        timeout=1.0  # Check every second
                    )

                    for task in done:
                        if task == stage1_task or (hasattr(task, '_coro') and task._coro == stage1_task._coro):
                            # Stage 1 completed
                            completed_count = len(COUNCIL_MODELS)  # Exit loop
                            break
                        else:
                            try:
                                event = task.result()
                                if event:
                                    yield f"data: {json.dumps(event)}\n\n"
                                    if event.get('type') == 'model_complete':
                                        completed_count += 1
                            except:
                                pass
                except asyncio.TimeoutError:
                    # Just continue waiting
                    if stage1_task.done():
                        break

            stage1_results = await stage1_task
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Check for cancellation after stage 1
            if is_cancelled():
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Job cancelled by user'})}\n\n"
                return

            # Stage 2: Collect rankings
            storage.update_job_status(conversation_id, user_msg_id, 'stage2', model_progress={model: 'pending' for model in COUNCIL_MODELS})
            yield f"data: {json.dumps({'type': 'stage2_start', 'data': {'models': COUNCIL_MODELS}})}\n\n"

            # Clear the queue for stage 2
            while not event_queue.empty():
                try:
                    event_queue.get_nowait()
                except:
                    pass

            stage2_task = asyncio.create_task(
                stage2_collect_rankings(query_with_context, stage1_results, on_model_complete=model_progress_callback)
            )

            # Emit progress events for stage 2
            completed_count = 0
            while completed_count < len(COUNCIL_MODELS):
                try:
                    done, pending = await asyncio.wait(
                        [asyncio.create_task(event_queue.get()), stage2_task],
                        return_when=asyncio.FIRST_COMPLETED,
                        timeout=1.0
                    )

                    for task in done:
                        if task == stage2_task or (hasattr(task, '_coro') and task._coro == stage2_task._coro):
                            completed_count = len(COUNCIL_MODELS)
                            break
                        else:
                            try:
                                event = task.result()
                                if event:
                                    yield f"data: {json.dumps(event)}\n\n"
                                    if event.get('type') == 'model_complete':
                                        completed_count += 1
                            except:
                                pass
                except asyncio.TimeoutError:
                    if stage2_task.done():
                        break

            stage2_results, label_to_model = await stage2_task
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Check for cancellation after stage 2
            if is_cancelled():
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Job cancelled by user'})}\n\n"
                return

            # Stage 3: Synthesize final answer
            storage.update_job_status(conversation_id, user_msg_id, 'stage3')
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(query_with_context, stage1_results, stage2_results)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message with metadata
            metadata = {
                'label_to_model': label_to_model,
                'aggregate_rankings': aggregate_rankings
            }
            assistant_msg_id = storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                metadata=metadata,
                stage0=research_context
            )

            # Mark job as complete
            storage.update_job_status(conversation_id, user_msg_id, 'complete')

            # Get updated path info
            updated_conv = storage.get_conversation_with_path(conversation_id)

            # Send completion event with message IDs and path
            yield f"data: {json.dumps({'type': 'complete', 'data': {'user_message_id': user_msg_id, 'assistant_message_id': assistant_msg_id, 'current_leaf_id': updated_conv['current_leaf_id'], 'current_path': updated_conv['current_path']}})}\n\n"

        except asyncio.CancelledError:
            # Job was cancelled
            if user_msg_id:
                storage.update_job_status(conversation_id, user_msg_id, 'cancelled')
            yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Job cancelled by user'})}\n\n"
        except Exception as e:
            # Mark job as error
            if user_msg_id:
                storage.update_job_status(conversation_id, user_msg_id, 'error', str(e))
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Clean up running job tracker
            if job_key and job_key in running_jobs:
                del running_jobs[job_key]

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/api/conversations/{conversation_id}/message/edit")
async def edit_message(conversation_id: str, request: EditMessageRequest):
    """
    Edit a user message, creating a new branch.

    This creates a sibling of the edited message (same parent_id)
    and generates a new response from the council.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages", {})

    # Validate the message exists and is a user message
    if request.message_id not in messages:
        raise HTTPException(status_code=404, detail="Message not found")

    original_msg = messages[request.message_id]
    if original_msg.get("role") != "user":
        raise HTTPException(status_code=400, detail="Can only edit user messages")

    # Get the parent of the original message (this becomes parent of the edit)
    original_parent_id = original_msg.get("parent_id")

    # Build conversation history up to (but not including) the edited message
    # This means we traverse from the original message's parent back to root
    path_to_parent = storage.get_message_path(messages, original_parent_id)
    conversation_history = storage.get_conversation_history_from_path(messages, path_to_parent)

    # Create new user message as sibling of original
    new_user_msg_id = storage.add_user_message(
        conversation_id,
        request.content,
        parent_id=original_parent_id
    )

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        conversation_history
    )

    # Add assistant message (parent is the new user message)
    new_assistant_msg_id = storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata=metadata
    )

    # Get updated conversation with path
    updated_conv = storage.get_conversation_with_path(conversation_id)

    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata,
        "user_message_id": new_user_msg_id,
        "assistant_message_id": new_assistant_msg_id,
        "current_leaf_id": updated_conv["current_leaf_id"],
        "current_path": updated_conv["current_path"],
        "original_message_id": request.message_id
    }


@app.post("/api/conversations/{conversation_id}/message/edit/stream")
async def edit_message_stream(conversation_id: str, request: EditMessageRequest):
    """
    Edit a user message with streaming response.
    Creates a new branch and streams the council process.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages", {})

    # Validate the message exists and is a user message
    if request.message_id not in messages:
        raise HTTPException(status_code=404, detail="Message not found")

    original_msg = messages[request.message_id]
    if original_msg.get("role") != "user":
        raise HTTPException(status_code=400, detail="Can only edit user messages")

    # Get the parent of the original message
    original_parent_id = original_msg.get("parent_id")

    # Build conversation history up to the parent
    path_to_parent = storage.get_message_path(messages, original_parent_id)
    conversation_history = storage.get_conversation_history_from_path(messages, path_to_parent)

    async def event_generator():
        new_user_msg_id = None
        try:
            # Create new user message as sibling (job_status starts as 'pending')
            new_user_msg_id = storage.add_user_message(
                conversation_id,
                request.content,
                parent_id=original_parent_id
            )
            yield f"data: {json.dumps({'type': 'user_message_created', 'data': {'message_id': new_user_msg_id, 'original_message_id': request.message_id}})}\n\n"

            # Stage 1
            storage.update_job_status(conversation_id, new_user_msg_id, 'stage1')
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, conversation_history)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2
            storage.update_job_status(conversation_id, new_user_msg_id, 'stage2')
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3
            storage.update_job_status(conversation_id, new_user_msg_id, 'stage3')
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Save assistant message with metadata
            metadata = {
                'label_to_model': label_to_model,
                'aggregate_rankings': aggregate_rankings
            }
            new_assistant_msg_id = storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                metadata=metadata
            )

            # Mark job as complete
            storage.update_job_status(conversation_id, new_user_msg_id, 'complete')

            # Get updated path info
            updated_conv = storage.get_conversation_with_path(conversation_id)

            yield f"data: {json.dumps({'type': 'complete', 'data': {'user_message_id': new_user_msg_id, 'assistant_message_id': new_assistant_msg_id, 'current_leaf_id': updated_conv['current_leaf_id'], 'current_path': updated_conv['current_path']}})}\n\n"

        except Exception as e:
            # Mark job as error
            if new_user_msg_id:
                storage.update_job_status(conversation_id, new_user_msg_id, 'error', str(e))
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/api/conversations/{conversation_id}/navigate")
async def navigate_to_branch(conversation_id: str, request: NavigateRequest):
    """
    Navigate to a different branch of the conversation.

    Sets the current_leaf_id to the leaf of the branch containing
    the specified message.
    """
    try:
        result = storage.navigate_to_message(conversation_id, request.message_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/conversations/{conversation_id}/messages/{message_id}/siblings")
async def get_message_siblings(conversation_id: str, message_id: str):
    """
    Get all sibling messages (same parent and role) for version navigation.
    """
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages", {})
    if message_id not in messages:
        raise HTTPException(status_code=404, detail="Message not found")

    siblings = storage.get_siblings(messages, message_id)

    # Return siblings with their index
    current_index = siblings.index(message_id) if message_id in siblings else 0

    return {
        "siblings": siblings,
        "current_index": current_index,
        "total": len(siblings)
    }


@app.get("/api/conversations/{conversation_id}/messages/{message_id}/job")
async def get_job_status(conversation_id: str, message_id: str):
    """
    Get job status for a user message.
    Returns status, started_at, elapsed_seconds, and error (if any).

    Also detects stale jobs: if a job has an intermediate status but isn't
    actually running (e.g., server restarted), mark it as 'stale'.
    """
    job_info = storage.get_job_info(conversation_id, message_id)
    if job_info is None:
        raise HTTPException(status_code=404, detail="Job not found")

    # Check for stale jobs: intermediate status but not actually running
    intermediate_statuses = {'pending', 'stage1', 'stage2', 'stage3'}
    job_key = (conversation_id, message_id)

    if job_info.get('status') in intermediate_statuses:
        if job_key not in running_jobs:
            # Job has intermediate status but isn't running - it's stale
            # This happens when server restarts or job dies without cleanup
            storage.update_job_status(conversation_id, message_id, 'stale',
                                      error='Job was interrupted (server restart or crash)')
            job_info['status'] = 'stale'
            job_info['error'] = 'Job was interrupted (server restart or crash)'

    return job_info


@app.post("/api/conversations/{conversation_id}/messages/{message_id}/cancel")
async def cancel_job(conversation_id: str, message_id: str):
    """
    Cancel a running job for a user message.
    This will stop any in-progress API calls and mark the job as cancelled.
    """
    job_key = (conversation_id, message_id)

    # Check if job exists and is running
    if job_key in running_jobs:
        job_data = running_jobs[job_key]
        job_data["cancelled"] = True

        # Cancel the task if it exists
        if job_data.get("task") and not job_data["task"].done():
            job_data["task"].cancel()

        # Clean up
        del running_jobs[job_key]

    # Update job status in storage
    try:
        storage.update_job_status(conversation_id, message_id, 'cancelled')
    except ValueError:
        pass  # Message might not exist

    return {"status": "cancelled", "message": "Job cancelled successfully"}


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """
    Permanently delete a conversation.
    """
    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "message": "Conversation deleted successfully"}


@app.post("/api/conversations/{conversation_id}/archive")
async def archive_conversation(conversation_id: str):
    """
    Archive a conversation (move to archived folder).
    """
    archived = storage.archive_conversation(conversation_id)
    if not archived:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "archived", "message": "Conversation archived successfully"}


@app.post("/api/conversations/{conversation_id}/unarchive")
async def unarchive_conversation(conversation_id: str):
    """
    Unarchive a conversation (move back to active conversations).
    """
    unarchived = storage.unarchive_conversation(conversation_id)
    if not unarchived:
        raise HTTPException(status_code=404, detail="Archived conversation not found")
    return {"status": "unarchived", "message": "Conversation unarchived successfully"}


@app.get("/api/archived-conversations", response_model=List[ConversationMetadata])
async def list_archived_conversations():
    """List all archived conversations (metadata only)."""
    return storage.list_archived_conversations()


# ============== Search Endpoints ==============

@app.get("/api/search")
async def search_conversations(
    q: str,
    limit: int = 20,
    include_archived: bool = True
):
    """
    Search across all conversations.

    Args:
        q: Search query string
        limit: Maximum results to return (default 20)
        include_archived: Include archived conversations (default true)

    Returns:
        Search results with conversation info and snippets
    """
    if not q or not q.strip():
        return {"results": [], "query": q, "total_results": 0}

    results = search.search(q, limit=limit, include_archived=include_archived)

    return {
        "results": results,
        "query": q,
        "total_results": len(results)
    }


@app.post("/api/search/rebuild")
async def rebuild_search_index():
    """
    Rebuild the search index from scratch.

    This re-indexes all active and archived conversations.
    """
    result = search.rebuild_index()
    return result


# ============== File Upload Endpoints ==============

@app.post("/api/conversations/{conversation_id}/upload")
async def upload_file(conversation_id: str, file: UploadFile = File(...)):
    """
    Upload a PDF file and extract its text content.

    Returns file metadata including extracted text for use in conversation.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Validate file extension
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file content
    content = await file.read()

    # Validate file size
    file_size = len(content)
    max_size_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    if file_size > max_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE_MB}MB"
        )

    # Extract text from PDF
    try:
        pdf_doc = fitz.open(stream=content, filetype="pdf")
        text_content = ""
        page_count = len(pdf_doc)
        for page in pdf_doc:
            text_content += page.get_text()
        pdf_doc.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {str(e)}")

    # Check text length
    if len(text_content) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"PDF text too long ({len(text_content):,} chars). Maximum: {MAX_TEXT_CHARS:,} chars. Try a shorter document."
        )

    # Generate file ID and save to disk
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    upload_dir = os.path.join(UPLOADS_DIR, conversation_id)
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, f"{file_id}.pdf")
    with open(file_path, "wb") as f:
        f.write(content)

    # Save metadata alongside PDF for recovery
    metadata_path = os.path.join(upload_dir, f"{file_id}.json")
    with open(metadata_path, "w") as f:
        json.dump({
            "id": file_id,
            "original_name": file.filename,
            "page_count": page_count,
            "size_bytes": file_size
        }, f)

    # Create attachment metadata
    attachment = {
        "id": file_id,
        "name": file.filename,
        "path": file_path,
        "size_bytes": file_size,
        "page_count": page_count,
        "text_content": text_content,
        "text_length": len(text_content),
        "warning": "Large document - may increase response time" if len(text_content) > WARN_TEXT_CHARS else None
    }

    return attachment


@app.get("/api/conversations/{conversation_id}/attachments")
async def list_attachments(conversation_id: str):
    """
    List all uploaded files for a conversation.
    """
    upload_dir = os.path.join(UPLOADS_DIR, conversation_id)
    if not os.path.exists(upload_dir):
        return {"attachments": []}

    attachments = []
    for filename in os.listdir(upload_dir):
        if filename.endswith(".pdf"):
            file_path = os.path.join(upload_dir, filename)
            file_id = filename.replace(".pdf", "")

            # Get basic file info
            stat = os.stat(file_path)

            # Extract text for preview
            try:
                pdf_doc = fitz.open(file_path)
                text_content = ""
                for page in pdf_doc:
                    text_content += page.get_text()
                page_count = len(pdf_doc)
                pdf_doc.close()
            except:
                text_content = ""
                page_count = 0

            attachments.append({
                "id": file_id,
                "name": filename,
                "path": file_path,
                "size_bytes": stat.st_size,
                "page_count": page_count,
                "text_length": len(text_content)
            })

    return {"attachments": attachments}


@app.delete("/api/conversations/{conversation_id}/attachments/{file_id}")
async def delete_attachment(conversation_id: str, file_id: str):
    """
    Delete an uploaded file.
    """
    file_path = os.path.join(UPLOADS_DIR, conversation_id, f"{file_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    os.remove(file_path)
    return {"status": "deleted", "message": "File deleted successfully"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
