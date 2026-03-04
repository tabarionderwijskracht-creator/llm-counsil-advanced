/**
 * API client for the LLM Council backend.
 */

// Use relative URLs so it works on any network address (localhost, IP, hostname, etc.)
const API_BASE = '';

/**
 * Helper to process SSE stream
 */
async function processSSEStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const event = JSON.parse(data);
          onEvent(event.type, event);
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      }
    }
  }
}

export const api = {
  /**
   * Get available models for selection.
   * @returns {Promise<{models: string[]}>}
   */
  async getAvailableModels() {
    const response = await fetch(`${API_BASE}/api/models`);
    if (!response.ok) {
      throw new Error('Failed to get available models');
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   * Returns conversation with tree-based messages and current_path.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation (non-streaming).
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {string[]} excludedMessageIds - Optional array of message IDs to exclude from context
   * @param {AbortSignal} signal - Optional AbortSignal for cancellation
   * @param {string[]} attachmentIds - Optional array of attachment IDs to include as context
   * @param {boolean} researchEnabled - Optional flag to enable web research (Stage 0)
   * @param {string[]} selectedModels - Optional array of model IDs to use for the council
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent, excludedMessageIds = null, signal = null, attachmentIds = null, researchEnabled = null, selectedModels = null) {
    const body = { content };
    if (excludedMessageIds && excludedMessageIds.length > 0) {
      body.excluded_message_ids = excludedMessageIds;
    }
    if (attachmentIds && attachmentIds.length > 0) {
      body.attachment_ids = attachmentIds;
    }
    if (researchEnabled !== null) {
      body.research_enabled = researchEnabled;
    }
    if (selectedModels && selectedModels.length > 0) {
      body.selected_models = selectedModels;
    }

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };
    if (signal) {
      fetchOptions.signal = signal;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      fetchOptions
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    await processSSEStream(response, onEvent);
  },

  /**
   * Edit a user message (non-streaming).
   * Creates a new branch from the edited message's parent.
   * @param {string} conversationId - The conversation ID
   * @param {string} messageId - The message ID to edit
   * @param {string} content - The new message content
   */
  async editMessage(conversationId, messageId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/edit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message_id: messageId, content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to edit message');
    }
    return response.json();
  },

  /**
   * Edit a user message with streaming response.
   * @param {string} conversationId - The conversation ID
   * @param {string} messageId - The message ID to edit
   * @param {string} content - The new message content
   * @param {function} onEvent - Callback function for each event
   * @param {AbortSignal} signal - Optional AbortSignal for cancellation
   */
  async editMessageStream(conversationId, messageId, content, onEvent, signal = null) {
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message_id: messageId, content }),
    };
    if (signal) {
      fetchOptions.signal = signal;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/edit/stream`,
      fetchOptions
    );

    if (!response.ok) {
      throw new Error('Failed to edit message');
    }

    await processSSEStream(response, onEvent);
  },

  /**
   * Navigate to a different branch of the conversation.
   * @param {string} conversationId - The conversation ID
   * @param {string} messageId - The message ID to navigate to
   */
  async navigate(conversationId, messageId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/navigate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message_id: messageId }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to navigate');
    }
    return response.json();
  },

  /**
   * Get siblings of a message (for version navigation).
   * @param {string} conversationId - The conversation ID
   * @param {string} messageId - The message ID
   */
  async getSiblings(conversationId, messageId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/messages/${messageId}/siblings`
    );
    if (!response.ok) {
      throw new Error('Failed to get siblings');
    }
    return response.json();
  },

  /**
   * Get job status for a user message.
   * @param {string} conversationId - The conversation ID
   * @param {string} messageId - The user message ID
   * @returns {Promise<{status: string, started_at: string, elapsed_seconds: number, error?: string}>}
   */
  async getJobStatus(conversationId, messageId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/messages/${messageId}/job`
    );
    if (!response.ok) {
      throw new Error('Failed to get job status');
    }
    return response.json();
  },

  /**
   * Cancel a running job.
   * @param {string} conversationId - The conversation ID
   * @param {string} messageId - The user message ID
   * @returns {Promise<{status: string, message: string}>}
   */
  async cancelJob(conversationId, messageId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/messages/${messageId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    if (!response.ok) {
      throw new Error('Failed to cancel job');
    }
    return response.json();
  },

  /**
   * Delete a conversation permanently.
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<{status: string, message: string}>}
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Archive a conversation.
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<{status: string, message: string}>}
   */
  async archiveConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/archive`,
      {
        method: 'POST',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to archive conversation');
    }
    return response.json();
  },

  /**
   * Unarchive a conversation.
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<{status: string, message: string}>}
   */
  async unarchiveConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/unarchive`,
      {
        method: 'POST',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to unarchive conversation');
    }
    return response.json();
  },

  /**
   * List all archived conversations.
   * @returns {Promise<Array<{id: string, created_at: string, title: string, message_count: number}>>}
   */
  async listArchivedConversations() {
    const response = await fetch(`${API_BASE}/api/archived-conversations`);
    if (!response.ok) {
      throw new Error('Failed to list archived conversations');
    }
    return response.json();
  },

  /**
   * Search across all conversations.
   * @param {string} query - Search query string
   * @param {number} limit - Maximum results (default 20)
   * @param {boolean} includeArchived - Include archived conversations (default true)
   * @returns {Promise<{results: Array, query: string, total_results: number}>}
   */
  async search(query, limit = 20, includeArchived = true) {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      include_archived: includeArchived.toString(),
    });
    const response = await fetch(`${API_BASE}/api/search?${params}`);
    if (!response.ok) {
      throw new Error('Failed to search conversations');
    }
    return response.json();
  },

  /**
   * Rebuild the search index.
   * @returns {Promise<{status: string, indexed_conversations: number, indexed_messages: number, duration_ms: number}>}
   */
  async rebuildSearchIndex() {
    const response = await fetch(`${API_BASE}/api/search/rebuild`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to rebuild search index');
    }
    return response.json();
  },

  /**
   * Upload a PDF file to a conversation.
   * @param {string} conversationId - The conversation ID
   * @param {File} file - The file to upload
   * @returns {Promise<{id: string, name: string, size_bytes: number, page_count: number, text_length: number, warning?: string}>}
   */
  async uploadFile(conversationId, file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Failed to upload file');
    }
    return response.json();
  },

  /**
   * List all attachments for a conversation.
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<{attachments: Array}>}
   */
  async listAttachments(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/attachments`
    );
    if (!response.ok) {
      throw new Error('Failed to list attachments');
    }
    return response.json();
  },

  /**
   * Delete an attachment.
   * @param {string} conversationId - The conversation ID
   * @param {string} fileId - The file ID to delete
   * @returns {Promise<{status: string, message: string}>}
   */
  async deleteAttachment(conversationId, fileId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/attachments/${fileId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete attachment');
    }
    return response.json();
  },

  // ============================================================================
  // Folder API Methods
  // ============================================================================

  /**
   * List all folders.
   * @returns {Promise<Array<{id: string, name: string, created_at: string}>>}
   */
  async listFolders() {
    const response = await fetch(`${API_BASE}/api/folders`);
    if (!response.ok) {
      throw new Error('Failed to list folders');
    }
    return response.json();
  },

  /**
   * Create a new folder.
   * @param {string} name - The folder name
   * @returns {Promise<{id: string, name: string, created_at: string}>}
   */
  async createFolder(name) {
    const response = await fetch(`${API_BASE}/api/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error('Failed to create folder');
    }
    return response.json();
  },

  /**
   * Update a folder's name.
   * @param {string} folderId - The folder ID
   * @param {string} name - The new folder name
   * @returns {Promise<{id: string, name: string, created_at: string}>}
   */
  async updateFolder(folderId, name) {
    const response = await fetch(`${API_BASE}/api/folders/${folderId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error('Failed to update folder');
    }
    return response.json();
  },

  /**
   * Delete a folder.
   * @param {string} folderId - The folder ID
   * @returns {Promise<{status: string, message: string}>}
   */
  async deleteFolder(folderId) {
    const response = await fetch(`${API_BASE}/api/folders/${folderId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete folder');
    }
    return response.json();
  },

  /**
   * Move a conversation to a folder.
   * @param {string} conversationId - The conversation ID
   * @param {string|null} folderId - The folder ID (null to remove from folder)
   * @returns {Promise<{status: string, message: string}>}
   */
  async moveConversationToFolder(conversationId, folderId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/move`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder_id: folderId }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to move conversation');
    }
    return response.json();
  },

  /**
   * Rename a conversation.
   * @param {string} conversationId - The conversation ID
   * @param {string} title - The new title
   * @returns {Promise<{status: string, title: string}>}
   */
  async renameConversation(conversationId, title) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/rename`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to rename conversation');
    }
    return response.json();
  },
};
