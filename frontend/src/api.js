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
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent, excludedMessageIds = null, signal = null) {
    const body = { content };
    if (excludedMessageIds && excludedMessageIds.length > 0) {
      body.excluded_message_ids = excludedMessageIds;
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
};
