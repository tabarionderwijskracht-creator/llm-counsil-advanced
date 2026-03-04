import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import Search from './components/Search';
import { api } from './api';
import './App.css';

/**
 * Convert tree-based messages to display array using current_path
 */
function getDisplayMessages(conversation) {
  if (!conversation?.messages || !conversation?.current_path) {
    return [];
  }

  const { messages, current_path } = conversation;
  return current_path
    .map(msgId => messages[msgId])
    .filter(Boolean);
}

/**
 * Get siblings info for a message
 */
function getSiblingsInfo(conversation, messageId) {
  if (!conversation?.messages || !messageId) {
    return { siblings: [], currentIndex: 0, total: 1 };
  }

  const { messages } = conversation;
  const msg = messages[messageId];
  if (!msg) {
    return { siblings: [], currentIndex: 0, total: 1 };
  }

  const parentId = msg.parent_id;
  const role = msg.role;

  // Find all siblings (same parent_id and role)
  const siblings = Object.keys(messages)
    .filter(id => {
      const m = messages[id];
      return m.parent_id === parentId && m.role === role;
    })
    .sort((a, b) => {
      const timeA = messages[a].created_at || '';
      const timeB = messages[b].created_at || '';
      return timeA.localeCompare(timeB);
    });

  const currentIndex = siblings.indexOf(messageId);

  return {
    siblings,
    currentIndex: currentIndex >= 0 ? currentIndex : 0,
    total: siblings.length
  };
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [archivedConversations, setArchivedConversations] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [pendingTimeout, setPendingTimeout] = useState(false);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [jobStatus, setJobStatus] = useState(null); // Current job status from backend
  const [jobError, setJobError] = useState(null); // Job error message from backend
  const [modelProgress, setModelProgress] = useState({}); // Per-model progress tracking
  const [cancelledMessageIds, setCancelledMessageIds] = useState(new Set()); // Messages that were cancelled
  const abortControllerRef = useRef(null); // For aborting active streaming
  const [excludedFromCopy, setExcludedFromCopy] = useState(new Set()); // Messages manually excluded from copy/export
  const [excludedFromContext, setExcludedFromContext] = useState(new Set()); // Messages manually excluded from API context
  const [copyCharThreshold, setCopyCharThreshold] = useState(100000); // Auto-exclude from copy if > this
  const [contextCharThreshold, setContextCharThreshold] = useState(100000); // Auto-exclude from context if > this
  const [isSearchOpen, setIsSearchOpen] = useState(false); // Search modal state

  // Global keyboard shortcut for search (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load conversations on mount and check URL for conversation ID
  useEffect(() => {
    loadConversations();
    loadArchivedConversations();

    // Check URL for conversation parameter
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get('conversation');
    if (conversationId) {
      setCurrentConversationId(conversationId);
    }
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  // Check if conversation might have a pending response (last message is user)
  // Returns the pending user message ID if pending, null otherwise
  const getPendingUserMessageId = useCallback((conv) => {
    if (!conv?.current_path?.length) return null;
    const lastMsgId = conv.current_path[conv.current_path.length - 1];
    const lastMsg = conv.messages?.[lastMsgId];
    if (lastMsg?.role === 'user') {
      return lastMsgId;
    }
    return null;
  }, []);

  // Legacy function for compatibility
  const checkIfPendingResponse = useCallback((conv) => {
    return getPendingUserMessageId(conv) !== null;
  }, [getPendingUserMessageId]);

  // Poll for updates if last message is from user (response might be in progress)
  useEffect(() => {
    if (!currentConversationId || !currentConversation) return;
    if (isLoading) return; // Don't poll if we're already actively loading

    const pendingMessageId = getPendingUserMessageId(currentConversation);
    if (!pendingMessageId) {
      // No pending response - reset state
      setPendingTimeout(false);
      setPendingSeconds(0);
      setJobStatus(null);
      setJobError(null);
      setModelProgress({});
      return;
    }

    // Skip polling for messages we've already cancelled
    if (cancelledMessageIds.has(pendingMessageId)) {
      console.log('Skipping cancelled message:', pendingMessageId);
      return;
    }

    // Last message is from user - poll job status endpoint
    console.log('Detected pending response, polling job status for message:', pendingMessageId);
    const TIMEOUT_SECONDS = 120; // 2 minute timeout

    const pollJobStatus = async () => {
      try {
        // Get job status from backend
        const jobInfo = await api.getJobStatus(currentConversationId, pendingMessageId);
        console.log('Job status:', jobInfo);

        // Update state with backend-tracked values
        setPendingSeconds(jobInfo.elapsed_seconds || 0);
        setJobStatus(jobInfo.status || null);
        if (jobInfo.model_progress) {
          setModelProgress(jobInfo.model_progress);
        }

        // Check for error status from backend
        if (jobInfo.status === 'error') {
          console.log('Job failed with error:', jobInfo.error);
          setJobError(jobInfo.error);
          setPendingTimeout(true);
          return true; // Stop polling
        }

        // Check for cancelled status
        if (jobInfo.status === 'cancelled') {
          console.log('Job was cancelled, adding to cancelled set:', pendingMessageId);
          // Add to cancelled set BEFORE reloading to prevent re-polling
          setCancelledMessageIds(prev => new Set([...prev, pendingMessageId]));
          setJobStatus(null);
          setPendingSeconds(0);
          setModelProgress({});
          // Reload conversation to clean up
          const conv = await api.getConversation(currentConversationId);
          setCurrentConversation(conv);
          return true; // Stop polling
        }

        // Check for stale status (job died without cleanup, e.g., server restart)
        if (jobInfo.status === 'stale') {
          console.log('Job is stale (server restart or crash):', pendingMessageId);
          setJobError(jobInfo.error || 'Job was interrupted');
          setPendingTimeout(true);
          setCancelledMessageIds(prev => new Set([...prev, pendingMessageId]));
          return true; // Stop polling
        }

        // Check for completion first (before timeout check)
        if (jobInfo.status === 'complete') {
          // Response should be ready - reload conversation
          console.log('Job complete, reloading conversation');
          const conv = await api.getConversation(currentConversationId);
          setCurrentConversation(conv);
          setPendingSeconds(0);
          setJobStatus(null);
          setJobError(null);
          setModelProgress({});
          return true; // Stop polling
        }

        // Only timeout if stuck in 'pending' or 'unknown' state (not actively processing)
        const isActivelyProcessing = ['stage1', 'stage2', 'stage3'].includes(jobInfo.status);
        if (!isActivelyProcessing && jobInfo.elapsed_seconds >= TIMEOUT_SECONDS) {
          console.log('Job timed out after', jobInfo.elapsed_seconds, 'seconds in status:', jobInfo.status);
          setPendingTimeout(true);
          return true; // Stop polling
        }

        // Also check if conversation has been updated (assistant response added)
        const conv = await api.getConversation(currentConversationId);
        const stillPending = getPendingUserMessageId(conv) !== null;

        if (!stillPending) {
          // Response arrived, update state and stop polling
          console.log('Response received, stopping poll');
          setCurrentConversation(conv);
          setPendingSeconds(0);
          setJobStatus(null);
          setJobError(null);
          setModelProgress({});
          return true; // Stop polling
        }

        return false; // Continue polling
      } catch (error) {
        console.error('Poll error:', error);
        // Don't stop polling on transient errors, just log them
        return false;
      }
    };

    // Immediate first poll
    let stopped = false;
    pollJobStatus().then(shouldStop => {
      if (shouldStop) stopped = true;
    });

    // Then poll every 2 seconds
    const pollInterval = setInterval(async () => {
      if (stopped) {
        clearInterval(pollInterval);
        return;
      }
      const shouldStop = await pollJobStatus();
      if (shouldStop) {
        stopped = true;
        clearInterval(pollInterval);
      }
    }, 2000);

    return () => {
      stopped = true;
      clearInterval(pollInterval);
    };
  }, [currentConversationId, currentConversation, isLoading, getPendingUserMessageId, cancelledMessageIds]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadArchivedConversations = async () => {
    try {
      const convs = await api.listArchivedConversations();
      setArchivedConversations(convs);
    } catch (error) {
      console.error('Failed to load archived conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      setIsLoading(false);
      setEditingMessageId(null);
      setCancelledMessageIds(new Set()); // Clear cancelled messages for new conversation
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, title: newConv.title, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      window.history.pushState({}, '', `?conversation=${newConv.id}`);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setIsLoading(false);
    setEditingMessageId(null);
    setCancelledMessageIds(new Set()); // Clear cancelled messages when switching
    setCurrentConversationId(id);
    window.history.pushState({}, '', `?conversation=${id}`);
  };

  const handleArchiveConversation = async (id) => {
    try {
      await api.archiveConversation(id);
      // If we archived the current conversation, clear it
      if (id === currentConversationId) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
        window.history.pushState({}, '', window.location.pathname);
      }
      // Refresh both lists
      loadConversations();
      loadArchivedConversations();
    } catch (error) {
      console.error('Failed to archive conversation:', error);
    }
  };

  const handleUnarchiveConversation = async (id) => {
    try {
      await api.unarchiveConversation(id);
      // Refresh both lists
      loadConversations();
      loadArchivedConversations();
    } catch (error) {
      console.error('Failed to unarchive conversation:', error);
    }
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      // If we deleted the current conversation, clear it
      if (id === currentConversationId) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
        window.history.pushState({}, '', window.location.pathname);
      }
      // Refresh both lists (in case it was archived)
      loadConversations();
      loadArchivedConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleToggleShowArchived = (show) => {
    setShowArchived(show);
  };

  /**
   * Helper to update a message in the conversation tree
   */
  const updateMessageInTree = useCallback((msgId, updates) => {
    setCurrentConversation(prev => {
      if (!prev) return prev;
      const newMessages = { ...prev.messages };
      if (newMessages[msgId]) {
        newMessages[msgId] = { ...newMessages[msgId], ...updates };
      }
      return { ...prev, messages: newMessages };
    });
  }, []);

  /**
   * Process streaming events (shared between send and edit)
   */
  const processStreamEvent = useCallback((eventType, event, userMsgId, setUserMsgIdCallback) => {
    switch (eventType) {
      case 'user_message_created':
        // Store the user message ID for later reference
        if (setUserMsgIdCallback) {
          setUserMsgIdCallback(event.data.message_id);
        }
        break;

      case 'stage0_start':
        // Web research starting
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              loading: {
                ...newMessages[assistantMsgId].loading,
                stage0: true
              }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage0_complete':
        // Web research complete
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              stage0: event.data,
              loading: { ...newMessages[assistantMsgId].loading, stage0: false }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage1_start':
        // Initialize model progress tracking
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const models = event.data?.models || [];
            const modelProgress = {};
            models.forEach(m => { modelProgress[m] = 'pending'; });
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              loading: {
                ...newMessages[assistantMsgId].loading,
                stage1: true,
                currentStage: 1,
                modelProgress
              }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'model_complete':
        // Update individual model status
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            const loading = newMessages[assistantMsgId].loading || {};
            const modelProgress = { ...loading.modelProgress };
            modelProgress[event.data.model] = event.data.status;
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              loading: { ...loading, modelProgress }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage1_complete':
        // Update assistant message with stage1 data
        setCurrentConversation(prev => {
          if (!prev) return prev;
          // Find the assistant message (last in current_path)
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              stage1: event.data,
              loading: { ...newMessages[assistantMsgId].loading, stage1: false }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage2_start':
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const models = event.data?.models || [];
            const modelProgress = {};
            models.forEach(m => { modelProgress[m] = 'pending'; });
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              loading: {
                ...newMessages[assistantMsgId].loading,
                stage2: true,
                currentStage: 2,
                modelProgress
              }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage2_complete':
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              stage2: event.data,
              metadata: event.metadata,
              loading: { ...newMessages[assistantMsgId].loading, stage2: false }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage3_start':
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              loading: { ...newMessages[assistantMsgId].loading, stage3: true }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'stage3_complete':
        setCurrentConversation(prev => {
          if (!prev) return prev;
          const assistantMsgId = prev.current_path[prev.current_path.length - 1];
          if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
            const newMessages = { ...prev.messages };
            newMessages[assistantMsgId] = {
              ...newMessages[assistantMsgId],
              stage3: event.data,
              loading: { ...newMessages[assistantMsgId].loading, stage3: false }
            };
            return { ...prev, messages: newMessages };
          }
          return prev;
        });
        break;

      case 'title_complete':
        loadConversations();
        break;

      case 'complete':
        // Update current_path and current_leaf_id from event
        if (event.data) {
          setCurrentConversation(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              current_leaf_id: event.data.current_leaf_id,
              current_path: event.data.current_path
            };
          });
        }
        loadConversations();
        setIsLoading(false);
        setEditingMessageId(null);
        break;

      case 'error':
        console.error('Stream error:', event.message);
        setIsLoading(false);
        setEditingMessageId(null);
        break;

      default:
        console.log('Unknown event type:', eventType);
    }
  }, []);

  const handleSendMessage = async (content, attachmentIds = [], researchEnabled = null) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    let userMsgId = null;

    // Create AbortController for cancellation
    abortControllerRef.current = new AbortController();

    try {
      // Get current conversation state
      const currentPath = currentConversation?.current_path || [];
      const currentLeafId = currentConversation?.current_leaf_id;

      // Create optimistic user message
      const tempUserMsgId = `temp_user_${Date.now()}`;
      const tempAssistantMsgId = `temp_assistant_${Date.now()}`;

      const userMessage = {
        id: tempUserMsgId,
        parent_id: currentLeafId,
        role: 'user',
        content,
        created_at: new Date().toISOString()
      };

      const assistantMessage = {
        id: tempAssistantMsgId,
        parent_id: tempUserMsgId,
        role: 'assistant',
        stage0: null,
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: { stage0: researchEnabled, stage1: !researchEnabled, stage2: false, stage3: false },
        created_at: new Date().toISOString()
      };

      // Optimistically add messages to state
      setCurrentConversation(prev => ({
        ...prev,
        messages: {
          ...prev.messages,
          [tempUserMsgId]: userMessage,
          [tempAssistantMsgId]: assistantMessage
        },
        current_path: [...currentPath, tempUserMsgId, tempAssistantMsgId],
        current_leaf_id: tempAssistantMsgId
      }));

      // Send message with streaming, passing excluded message IDs (for API context), attachments, and research flag
      const excludedIds = Array.from(effectiveExcludedFromContext);
      await api.sendMessageStream(currentConversationId, content, (eventType, event) => {
        // When we get the real IDs, update state
        if (eventType === 'user_message_created' && event.data?.message_id) {
          userMsgId = event.data.message_id;
          // Update sidebar immediately when user message is created
          loadConversations();
        }

        if (eventType === 'complete' && event.data) {
          // Replace temp IDs with real IDs
          setCurrentConversation(prev => {
            if (!prev) return prev;

            const newMessages = { ...prev.messages };

            // Remove temp messages
            delete newMessages[tempUserMsgId];
            delete newMessages[tempAssistantMsgId];

            // The real messages should be added by reloading, but we can update path
            return {
              ...prev,
              messages: newMessages,
              current_leaf_id: event.data.current_leaf_id,
              current_path: event.data.current_path
            };
          });

          // Reload to get real message data
          loadConversation(currentConversationId);
          loadConversations();
          setIsLoading(false);
          abortControllerRef.current = null;
        } else {
          processStreamEvent(eventType, event, userMsgId, (id) => { userMsgId = id; });
        }
      }, excludedIds, abortControllerRef.current?.signal, attachmentIds, researchEnabled);
    } catch (error) {
      // Ignore abort errors (user cancelled)
      if (error.name === 'AbortError') {
        console.log('Request was cancelled');
        return;
      }
      console.error('Failed to send message:', error);
      // Reload conversation to restore state
      loadConversation(currentConversationId);
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleEditMessage = async (messageId, newContent) => {
    if (!currentConversationId || !messageId) return;

    setIsLoading(true);
    setEditingMessageId(messageId);

    // Create AbortController for cancellation
    abortControllerRef.current = new AbortController();

    // Get the original message to find its parent
    const originalMessage = currentConversation?.messages?.[messageId];
    const originalParentId = originalMessage?.parent_id;

    // Create temp IDs for optimistic update
    const tempUserMsgId = `temp_edit_user_${Date.now()}`;
    const tempAssistantMsgId = `temp_edit_assistant_${Date.now()}`;

    // Build the new path: path up to parent + new messages
    const pathToParent = [];
    if (originalParentId) {
      // Traverse from parent to root
      let currentId = originalParentId;
      while (currentId) {
        pathToParent.unshift(currentId);
        currentId = currentConversation?.messages?.[currentId]?.parent_id;
      }
    }
    const newPath = [...pathToParent, tempUserMsgId, tempAssistantMsgId];

    // Optimistically add the edited user message and placeholder assistant message
    setCurrentConversation(prev => ({
      ...prev,
      messages: {
        ...prev.messages,
        [tempUserMsgId]: {
          id: tempUserMsgId,
          parent_id: originalParentId,
          role: 'user',
          content: newContent,
          created_at: new Date().toISOString()
        },
        [tempAssistantMsgId]: {
          id: tempAssistantMsgId,
          parent_id: tempUserMsgId,
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: null,
          metadata: null,
          loading: { stage1: true, stage2: false, stage3: false },
          created_at: new Date().toISOString()
        }
      },
      current_path: newPath,
      current_leaf_id: tempAssistantMsgId
    }));

    // Clear the editing indicator since we're now showing the new message
    setEditingMessageId(null);

    try {
      // Send edit with streaming
      await api.editMessageStream(currentConversationId, messageId, newContent, (eventType, event) => {
        switch (eventType) {
          case 'user_message_created':
            // User message created on server
            break;

          case 'stage1_start':
            setCurrentConversation(prev => {
              if (!prev) return prev;
              const newMessages = { ...prev.messages };
              if (newMessages[tempAssistantMsgId]) {
                newMessages[tempAssistantMsgId] = {
                  ...newMessages[tempAssistantMsgId],
                  loading: { stage1: true, stage2: false, stage3: false }
                };
              }
              return { ...prev, messages: newMessages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation(prev => {
              if (!prev) return prev;
              const newMessages = { ...prev.messages };
              if (newMessages[tempAssistantMsgId]) {
                newMessages[tempAssistantMsgId] = {
                  ...newMessages[tempAssistantMsgId],
                  stage1: event.data,
                  loading: { stage1: false, stage2: false, stage3: false }
                };
              }
              return { ...prev, messages: newMessages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation(prev => {
              if (!prev) return prev;
              const newMessages = { ...prev.messages };
              if (newMessages[tempAssistantMsgId]) {
                newMessages[tempAssistantMsgId] = {
                  ...newMessages[tempAssistantMsgId],
                  loading: { ...newMessages[tempAssistantMsgId].loading, stage2: true }
                };
              }
              return { ...prev, messages: newMessages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation(prev => {
              if (!prev) return prev;
              const newMessages = { ...prev.messages };
              if (newMessages[tempAssistantMsgId]) {
                newMessages[tempAssistantMsgId] = {
                  ...newMessages[tempAssistantMsgId],
                  stage2: event.data,
                  metadata: event.metadata,
                  loading: { ...newMessages[tempAssistantMsgId].loading, stage2: false }
                };
              }
              return { ...prev, messages: newMessages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation(prev => {
              if (!prev) return prev;
              const newMessages = { ...prev.messages };
              if (newMessages[tempAssistantMsgId]) {
                newMessages[tempAssistantMsgId] = {
                  ...newMessages[tempAssistantMsgId],
                  loading: { ...newMessages[tempAssistantMsgId].loading, stage3: true }
                };
              }
              return { ...prev, messages: newMessages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation(prev => {
              if (!prev) return prev;
              const newMessages = { ...prev.messages };
              if (newMessages[tempAssistantMsgId]) {
                newMessages[tempAssistantMsgId] = {
                  ...newMessages[tempAssistantMsgId],
                  stage3: event.data,
                  loading: { stage1: false, stage2: false, stage3: false }
                };
              }
              return { ...prev, messages: newMessages };
            });
            break;

          case 'complete':
            // Reload to get real IDs and clean up temp messages
            loadConversation(currentConversationId);
            loadConversations();
            setIsLoading(false);
            abortControllerRef.current = null;
            break;

          case 'error':
            console.error('Edit error:', event.message);
            // Reload to restore original state
            loadConversation(currentConversationId);
            setIsLoading(false);
            abortControllerRef.current = null;
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      }, abortControllerRef.current?.signal);
    } catch (error) {
      // Ignore abort errors (user cancelled)
      if (error.name === 'AbortError') {
        console.log('Edit request was cancelled');
        return;
      }
      console.error('Failed to edit message:', error);
      // Reload to restore original state
      loadConversation(currentConversationId);
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleNavigate = async (messageId) => {
    if (!currentConversationId || !messageId) return;

    try {
      const result = await api.navigate(currentConversationId, messageId);

      // Update current conversation with new path
      setCurrentConversation(prev => ({
        ...prev,
        current_leaf_id: result.current_leaf_id,
        current_path: result.current_path
      }));
    } catch (error) {
      console.error('Failed to navigate:', error);
    }
  };

  // Compute display messages from tree structure
  const displayMessages = getDisplayMessages(currentConversation);

  // Create a function to get siblings info for any message
  const getSiblingsForMessage = useCallback((messageId) => {
    return getSiblingsInfo(currentConversation, messageId);
  }, [currentConversation]);

  // Check if we're waiting for a response (last message is user, not actively loading, not cancelled)
  const pendingMessageId = getPendingUserMessageId(currentConversation);
  const isPendingResponse = !isLoading && pendingMessageId && !cancelledMessageIds.has(pendingMessageId);

  // Helper to get character count for a message
  const getMessageCharCount = useCallback((msg) => {
    if (msg.role === 'user') {
      return msg.content?.length || 0;
    } else if (msg.role === 'assistant' && msg.stage3?.response) {
      return msg.stage3.response.length;
    }
    return 0;
  }, []);

  // Compute effective exclusions (manual + threshold-based)
  const effectiveExcludedFromCopy = new Set(excludedFromCopy);
  const effectiveExcludedFromContext = new Set(excludedFromContext);

  if (currentConversation?.messages) {
    for (const [msgId, msg] of Object.entries(currentConversation.messages)) {
      const charCount = getMessageCharCount(msg);
      if (copyCharThreshold > 0 && charCount > copyCharThreshold) {
        effectiveExcludedFromCopy.add(msgId);
      }
      if (contextCharThreshold > 0 && charCount > contextCharThreshold) {
        effectiveExcludedFromContext.add(msgId);
      }
    }
  }

  // Retry a specific user message
  const handleRetry = useCallback((messageId) => {
    if (!currentConversation?.messages?.[messageId]) return;

    const msg = currentConversation.messages[messageId];
    if (msg.role === 'user') {
      // Resubmit by editing with same content (creates new branch)
      handleEditMessage(messageId, msg.content);
    }
  }, [currentConversation, handleEditMessage]);

  // Toggle a message's exclusion from copy/export
  const handleToggleExcludeFromCopy = useCallback((messageId) => {
    setExcludedFromCopy(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  }, []);

  // Toggle a message's exclusion from API context
  const handleToggleExcludeFromContext = useCallback((messageId) => {
    setExcludedFromContext(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  }, []);

  // Cancel a running job or active streaming
  const handleCancel = useCallback(async () => {
    // If actively streaming, abort the fetch
    if (isLoading && abortControllerRef.current) {
      console.log('Aborting active streaming');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setEditingMessageId(null);
      setModelProgress({});

      // Clear loading indicators from the assistant message but keep stage data
      setCurrentConversation(prev => {
        if (!prev) return prev;
        const assistantMsgId = prev.current_path?.[prev.current_path.length - 1];
        if (assistantMsgId && prev.messages[assistantMsgId]?.role === 'assistant') {
          const newMessages = { ...prev.messages };
          newMessages[assistantMsgId] = {
            ...newMessages[assistantMsgId],
            loading: { stage1: false, stage2: false, stage3: false }
          };
          return { ...prev, messages: newMessages };
        }
        return prev;
      });

      // Try to cancel the backend job
      const pendingMessageId = getPendingUserMessageId(currentConversation);
      if (pendingMessageId && currentConversationId) {
        try {
          await api.cancelJob(currentConversationId, pendingMessageId);
          setCancelledMessageIds(prev => new Set([...prev, pendingMessageId]));
        } catch (error) {
          console.log('Backend cancel (best effort):', error.message);
        }
      }
      return;
    }

    // If not actively streaming but have pending response, just cancel the backend job
    const pendingMessageId = getPendingUserMessageId(currentConversation);
    if (!pendingMessageId || !currentConversationId) return;

    try {
      await api.cancelJob(currentConversationId, pendingMessageId);
      // Track this message as cancelled to prevent re-polling
      setCancelledMessageIds(prev => new Set([...prev, pendingMessageId]));
      // Reset state
      setIsLoading(false);
      setPendingTimeout(false);
      setPendingSeconds(0);
      setJobStatus(null);
      setJobError(null);
      setModelProgress({});
      // Reload conversation to get clean state
      loadConversation(currentConversationId);
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  }, [currentConversationId, currentConversation, getPendingUserMessageId, isLoading]);

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        archivedConversations={archivedConversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onArchiveConversation={handleArchiveConversation}
        onUnarchiveConversation={handleUnarchiveConversation}
        onDeleteConversation={handleDeleteConversation}
        showArchived={showArchived}
        onToggleShowArchived={handleToggleShowArchived}
        onOpenSearch={() => setIsSearchOpen(true)}
      />
      <Search
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectConversation={handleSelectConversation}
      />
      <ChatInterface
        conversation={currentConversation}
        displayMessages={displayMessages}
        onSendMessage={handleSendMessage}
        onEditMessage={handleEditMessage}
        onNavigate={handleNavigate}
        getSiblingsForMessage={getSiblingsForMessage}
        isLoading={isLoading}
        editingMessageId={editingMessageId}
        isPendingResponse={isPendingResponse}
        pendingTimeout={pendingTimeout}
        pendingSeconds={pendingSeconds}
        jobStatus={jobStatus}
        jobError={jobError}
        modelProgress={modelProgress}
        onRetry={handleRetry}
        onCancel={handleCancel}
        excludedFromCopy={effectiveExcludedFromCopy}
        excludedFromContext={effectiveExcludedFromContext}
        manualExcludedFromCopy={excludedFromCopy}
        manualExcludedFromContext={excludedFromContext}
        onToggleExcludeFromCopy={handleToggleExcludeFromCopy}
        onToggleExcludeFromContext={handleToggleExcludeFromContext}
        copyCharThreshold={copyCharThreshold}
        contextCharThreshold={contextCharThreshold}
        onCopyCharThresholdChange={setCopyCharThreshold}
        onContextCharThresholdChange={setContextCharThreshold}
        onUploadFile={async (file) => {
          if (!currentConversationId) throw new Error('No conversation selected');
          return api.uploadFile(currentConversationId, file);
        }}
      />
    </div>
  );
}

export default App;
