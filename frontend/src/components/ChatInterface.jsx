import { useState, useEffect, useRef, memo, useCallback } from 'react';
import Markdown from './Markdown';
import Stage0 from './Stage0';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import { createSnipPlaceholder } from '../utils/truncate';
import './ChatInterface.css';

// Version navigation component
const VersionNav = memo(function VersionNav({
  messageId,
  siblings,
  currentIndex,
  total,
  onNavigate,
  disabled
}) {
  if (total <= 1) return null;

  const handlePrev = () => {
    if (currentIndex > 0 && !disabled) {
      onNavigate(siblings[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (currentIndex < total - 1 && !disabled) {
      onNavigate(siblings[currentIndex + 1]);
    }
  };

  return (
    <div className="version-nav">
      <button
        className="version-nav-btn"
        onClick={handlePrev}
        disabled={currentIndex === 0 || disabled}
        title="Previous version"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="version-indicator">
        {currentIndex + 1}/{total}
      </span>
      <button
        className="version-nav-btn"
        onClick={handleNext}
        disabled={currentIndex === total - 1 || disabled}
        title="Next version"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
});

// Memoized user message with edit capability
const UserMessage = memo(function UserMessage({
  message,
  siblings,
  currentIndex,
  total,
  onEdit,
  onNavigate,
  isEditing,
  isLoading,
  showRetry,
  onRetry,
  messageRef,
  onScrollToResponse,
  isExcludedFromCopy,
  isExcludedFromContext,
  onToggleExcludeFromCopy,
  onToggleExcludeFromContext,
  charCount
}) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editContent, setEditContent] = useState(message.content || '');
  const textareaRef = useRef(null);

  const scrollToTop = () => {
    messageRef?.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  };

  // Reset edit content when message changes
  useEffect(() => {
    setEditContent(message.content || '');
    setIsEditMode(false);
  }, [message.id, message.content]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditMode && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditMode]);

  const handleStartEdit = () => {
    if (!isLoading) {
      setEditContent(message.content || '');
      setIsEditMode(true);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(message.content || '');
    setIsEditMode(false);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      onEdit(message.id, editContent);
    }
    setIsEditMode(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const isExcluded = isExcludedFromCopy || isExcludedFromContext;

  return (
    <div className={`user-message ${isEditing ? 'editing' : ''} ${isExcludedFromCopy ? 'excluded-copy' : ''} ${isExcludedFromContext ? 'excluded-context' : ''}`}>
      <div className="message-header">
        <div className="message-label">
          You
          {charCount > 0 && (
            <span className="char-count" title={`${charCount} characters`}>
              {formatCharCount(charCount)}
            </span>
          )}
        </div>
        <div className="message-actions">
          {/* Eye icon - toggle exclude from copy/export */}
          <button
            className={`exclude-toggle copy-toggle ${isExcludedFromCopy ? 'excluded' : ''}`}
            onClick={() => onToggleExcludeFromCopy(message.id)}
            title={isExcludedFromCopy ? 'Include in export' : 'Exclude from export'}
          >
            {isExcludedFromCopy ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
          {/* AI icon - toggle exclude from API context */}
          <button
            className={`exclude-toggle context-toggle ${isExcludedFromContext ? 'excluded' : ''}`}
            onClick={() => onToggleExcludeFromContext(message.id)}
            title={isExcludedFromContext ? 'Include in AI context' : 'Exclude from AI context'}
          >
            {isExcludedFromContext ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                <path d="M9 15h6" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                <path d="M9 15h6" />
              </svg>
            )}
          </button>
          <VersionNav
            messageId={message.id}
            siblings={siblings}
            currentIndex={currentIndex}
            total={total}
            onNavigate={onNavigate}
            disabled={isLoading || isEditMode}
          />
          {!isEditMode && (
            <>
              <button
                className="edit-button"
                onClick={handleStartEdit}
                disabled={isLoading}
                title="Edit message"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              {showRetry && (
                <button
                  className="retry-button-inline"
                  onClick={() => onRetry(message.id)}
                  disabled={isLoading}
                  title="Retry this message"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
            </>
          )}
          <button
            className="scroll-nav-btn"
            onClick={scrollToTop}
            title="Scroll to top of message"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            className="scroll-nav-btn"
            onClick={onScrollToResponse}
            title="Scroll to response"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>
      <div className="message-content">
        {isEditMode ? (
          <div className="edit-container">
            <textarea
              ref={textareaRef}
              className="edit-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="Edit your message..."
            />
            <div className="edit-actions">
              <button
                className="edit-action-btn cancel"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
              <button
                className="edit-action-btn save"
                onClick={handleSaveEdit}
                disabled={!editContent.trim() || editContent === message.content}
              >
                Save & Submit
              </button>
            </div>
          </div>
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
      </div>
      {/* Show attachments that were used with this message */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="message-attachments">
          {message.attachments.map(attachment => (
            <div key={attachment.id} className="message-attachment-chip">
              <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="attachment-name" title={attachment.name}>
                {attachment.name.length > 25 ? attachment.name.substring(0, 22) + '...' : attachment.name}
              </span>
              <span className="attachment-pages">{attachment.page_count} pages</span>
            </div>
          ))}
        </div>
      )}
      {isEditing && (
        <div className="editing-indicator">
          <div className="spinner"></div>
          <span>Generating new response...</span>
        </div>
      )}
    </div>
  );
});

// Memoized assistant message
const AssistantMessage = memo(function AssistantMessage({
  msg,
  messageRef,
  isExcludedFromCopy,
  isExcludedFromContext,
  onToggleExcludeFromCopy,
  onToggleExcludeFromContext,
  charCount
}) {
  const scrollToTop = () => {
    messageRef?.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  };

  const scrollToBottom = () => {
    messageRef?.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  };

  return (
    <div className={`assistant-message ${isExcludedFromCopy ? 'excluded-copy' : ''} ${isExcludedFromContext ? 'excluded-context' : ''}`}>
      <div className="message-header">
        <div className="message-label">
          LLM Council
          {charCount > 0 && (
            <span className="char-count" title={`${charCount} characters`}>
              {formatCharCount(charCount)}
            </span>
          )}
        </div>
        <div className="message-actions">
          {/* Eye icon - toggle exclude from copy/export */}
          {msg.id && onToggleExcludeFromCopy && (
            <button
              className={`exclude-toggle copy-toggle ${isExcludedFromCopy ? 'excluded' : ''}`}
              onClick={() => onToggleExcludeFromCopy(msg.id)}
              title={isExcludedFromCopy ? 'Include in export' : 'Exclude from export'}
            >
              {isExcludedFromCopy ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          )}
          {/* AI icon - toggle exclude from API context */}
          {msg.id && onToggleExcludeFromContext && (
            <button
              className={`exclude-toggle context-toggle ${isExcludedFromContext ? 'excluded' : ''}`}
              onClick={() => onToggleExcludeFromContext(msg.id)}
              title={isExcludedFromContext ? 'Include in AI context' : 'Exclude from AI context'}
            >
              {isExcludedFromContext ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                  <path d="M9 15h6" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                  <path d="M9 15h6" />
                </svg>
              )}
            </button>
          )}
          <button
            className="scroll-nav-btn"
            onClick={scrollToTop}
            title="Scroll to top of response"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            className="scroll-nav-btn"
            onClick={scrollToBottom}
            title="Scroll to bottom of response"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stage 0 - Web Research */}
      {msg.loading?.stage0 && (
        <div className="stage-loading">
          <div className="stage-loading-header">
            <div className="spinner"></div>
            <span>Web Research: Searching...</span>
          </div>
        </div>
      )}
      {msg.stage0 && <Stage0 research={msg.stage0} />}

      {/* Stage 1 */}
      {msg.loading?.stage1 && (
        <div className="stage-loading">
          <div className="stage-loading-header">
            <div className="spinner"></div>
            <span>Stage 1: Collecting responses</span>
          </div>
          {msg.loading.modelProgress && (
            <div className="model-progress">
              {Object.entries(msg.loading.modelProgress).map(([model, status]) => {
                const shortName = model.split('/')[1] || model;
                return (
                  <div key={model} className={`model-status ${status}`} title={model}>
                    {status === 'complete' && <span className="status-icon">✓</span>}
                    {status === 'pending' && <span className="status-icon spinner-small"></span>}
                    {status === 'failed' && <span className="status-icon">✗</span>}
                    <span className="model-name">{shortName}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {msg.stage1 && <Stage1 responses={msg.stage1} />}

      {/* Stage 2 */}
      {msg.loading?.stage2 && (
        <div className="stage-loading">
          <div className="stage-loading-header">
            <div className="spinner"></div>
            <span>Stage 2: Peer rankings</span>
          </div>
          {msg.loading.modelProgress && (
            <div className="model-progress">
              {Object.entries(msg.loading.modelProgress).map(([model, status]) => {
                const shortName = model.split('/')[1] || model;
                return (
                  <div key={model} className={`model-status ${status}`} title={model}>
                    {status === 'complete' && <span className="status-icon">✓</span>}
                    {status === 'pending' && <span className="status-icon spinner-small"></span>}
                    {status === 'failed' && <span className="status-icon">✗</span>}
                    <span className="model-name">{shortName}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {msg.stage2 && (
        <Stage2
          rankings={msg.stage2}
          labelToModel={msg.metadata?.label_to_model}
          aggregateRankings={msg.metadata?.aggregate_rankings}
        />
      )}

      {/* Stage 3 */}
      {msg.loading?.stage3 && (
        <div className="stage-loading">
          <div className="stage-loading-header">
            <div className="spinner"></div>
            <span>Stage 3: Final synthesis</span>
          </div>
        </div>
      )}
      {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
    </div>
  );
});

// Threshold filter component
function ThresholdFilter({ label, icon, value, onChange, accentColor, description }) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  const handleClick = () => {
    setInputValue(value > 0 ? (value / 1000).toString() : '');
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const numValue = parseFloat(inputValue);
    if (!isNaN(numValue) && numValue >= 0) {
      onChange(Math.round(numValue * 1000));
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const displayValue = value > 0 ? `>${(value / 1000).toFixed(0)}k` : 'Off';
  const tooltipText = value > 0
    ? `${description} Messages over ${(value / 1000).toFixed(0)}k chars are auto-excluded. Click to change.`
    : `${description} Currently disabled. Click to set a threshold.`;

  return (
    <div
      className={`threshold-filter ${value > 0 ? 'active' : ''}`}
      style={{ '--accent-color': accentColor }}
      title={tooltipText}
    >
      <span className="threshold-icon">{icon}</span>
      <span className="threshold-label">{label}</span>
      <span className="threshold-action">skip</span>
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          className="threshold-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          min="0"
          step="10"
          placeholder="k"
        />
      ) : (
        <button className="threshold-value" onClick={handleClick}>
          {displayValue}
        </button>
      )}
    </div>
  );
}

// Export button component
function ExportButton({ messages, excludedFromCopy }) {
  const [copied, setCopied] = useState(false);
  const [copiedCount, setCopiedCount] = useState(0);

  // Calculate export text and character count (with smart placeholders for excluded messages)
  const getExportData = () => {
    const lines = [];
    const excluded = excludedFromCopy || new Set();

    for (const msg of messages) {
      const isExcluded = msg.id && excluded.has(msg.id);

      if (msg.role === 'user') {
        if (isExcluded) {
          // Include smart placeholder for excluded user messages
          const placeholder = createSnipPlaceholder(msg.content, 100, 100);
          lines.push(`## User (excluded from context)\n\n${placeholder}\n`);
        } else {
          lines.push(`## User\n\n${msg.content}\n`);
        }
      } else if (msg.stage3?.response) {
        if (isExcluded) {
          // Include smart placeholder for excluded assistant messages
          const placeholder = createSnipPlaceholder(msg.stage3.response, 100, 100);
          lines.push(`## Assistant (excluded from context)\n\n${placeholder}\n`);
        } else {
          lines.push(`## Assistant\n\n${msg.stage3.response}\n`);
        }
      }
    }

    return lines.join('\n---\n\n');
  };

  const exportText = getExportData();
  const charCount = exportText.length;

  const handleExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopiedCount(charCount);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      className={`export-button ${copied ? 'copied' : ''}`}
      onClick={handleExport}
      title={`Export conversation (${formatCharCount(charCount)} chars, excludes hidden messages)`}
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied {formatCharCount(copiedCount)} chars
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export ({formatCharCount(charCount)})
        </>
      )}
    </button>
  );
}

// Helper to get human-readable stage name
function getStageDisplayName(status) {
  switch (status) {
    case 'pending': return 'Initializing';
    case 'stage1': return 'Stage 1: Collecting individual responses';
    case 'stage2': return 'Stage 2: Peer rankings';
    case 'stage3': return 'Stage 3: Final synthesis';
    case 'complete': return 'Complete';
    case 'cancelled': return 'Cancelled';
    case 'stale': return 'Interrupted';
    case 'error': return 'Error';
    default: return 'Processing';
  }
}

// Model progress indicator component
const ModelProgressIndicator = memo(function ModelProgressIndicator({ modelProgress, stage }) {
  if (!modelProgress || Object.keys(modelProgress).length === 0) {
    return null;
  }

  const models = Object.entries(modelProgress);
  const completed = models.filter(([_, status]) => status === 'complete').length;
  const failed = models.filter(([_, status]) => status === 'failed' || status === 'timeout').length;
  const pending = models.filter(([_, status]) => status === 'pending').length;

  return (
    <div className="model-progress">
      <div className="model-progress-summary">
        {completed}/{models.length} models completed
        {failed > 0 && <span className="failed-count"> ({failed} failed)</span>}
      </div>
      <div className="model-progress-list">
        {models.map(([model, status]) => {
          const shortName = model.split('/')[1] || model;
          return (
            <div key={model} className={`model-status model-status-${status}`}>
              <span className="model-name">{shortName}</span>
              <span className={`status-indicator status-${status}`}>
                {status === 'complete' && '✓'}
                {status === 'pending' && '...'}
                {status === 'failed' && '✗'}
                {status === 'timeout' && '⏱'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// Helper to get character count display
function formatCharCount(count) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

// Memoized messages list
const MessagesList = memo(function MessagesList({
  messages,
  getSiblingsForMessage,
  onEditMessage,
  onNavigate,
  isLoading,
  editingMessageId,
  isPendingResponse,
  pendingTimeout,
  pendingSeconds,
  jobStatus,
  jobError,
  modelProgress,
  onRetry,
  onCancel,
  excludedFromCopy,
  excludedFromContext,
  onToggleExcludeFromCopy,
  onToggleExcludeFromContext,
  copyCharThreshold,
  contextCharThreshold,
  onCopyCharThresholdChange,
  onContextCharThresholdChange
}) {
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const prevMessageCountRef = useRef(0);
  const messageRefs = useRef({});
  const pendingResponseRef = useRef(null);

  // Only auto-scroll when NEW messages are added, not on every state change
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // Find last user message index
  const lastUserMessageIndex = messages.reduce((lastIdx, msg, idx) =>
    msg.role === 'user' ? idx : lastIdx, -1);

  // Helper to get or create ref for a message
  const getMessageRef = (msgId) => {
    if (!messageRefs.current[msgId]) {
      messageRefs.current[msgId] = { current: null };
    }
    return messageRefs.current[msgId];
  };

  if (messages.length === 0) {
    return (
      <div className="messages-container">
        <div className="empty-state">
          <h2>Start a conversation</h2>
          <p>Ask a question to consult the LLM Council</p>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-container" ref={containerRef}>
      {messages.length > 0 && (
        <div className="conversation-toolbar">
          <div className="toolbar-filters">
            <ThresholdFilter
              label="Export"
              description="Auto-exclude long messages from copy/export."
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              }
              value={copyCharThreshold}
              onChange={onCopyCharThresholdChange}
              accentColor="#2196f3"
            />
            <ThresholdFilter
              label="Context"
              description="Auto-exclude long messages from AI context."
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                  <path d="M9 15h6" />
                </svg>
              }
              value={contextCharThreshold}
              onChange={onContextCharThresholdChange}
              accentColor="#ff9800"
            />
          </div>
          <ExportButton messages={messages} excludedFromCopy={excludedFromCopy} />
        </div>
      )}
      {messages.map((msg, index) => {
        const siblingsInfo = msg.id ? getSiblingsForMessage(msg.id) : { siblings: [], currentIndex: 0, total: 1 };
        // Show retry on the last user message if there's a pending response
        const isLastMessage = index === messages.length - 1;
        const showRetry = msg.role === 'user' && isLastMessage && isPendingResponse;
        const msgRef = msg.id ? getMessageRef(msg.id) : null;
        const isExcludedFromCopy = msg.id && excludedFromCopy?.has(msg.id);
        const isExcludedFromContext = msg.id && excludedFromContext?.has(msg.id);
        const isExcluded = isExcludedFromCopy || isExcludedFromContext;

        // Calculate character count for the message
        let charCount = 0;
        if (msg.role === 'user') {
          charCount = msg.content?.length || 0;
        } else if (msg.role === 'assistant' && msg.stage3?.response) {
          charCount = msg.stage3.response.length;
        }

        // Create scroll to response callback for user messages
        const handleScrollToResponse = () => {
          if (msg.role === 'user') {
            // Check if there's a next message (the assistant response)
            const nextMsg = messages[index + 1];
            if (nextMsg?.id) {
              const nextRef = getMessageRef(nextMsg.id);
              nextRef?.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
            } else if (isLastMessage && isPendingResponse) {
              // Scroll to pending response indicator
              pendingResponseRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
          }
        };

        return (
          <div
            key={msg.id || Math.random()}
            className={`message-group ${isExcludedFromCopy ? 'excluded-copy' : ''} ${isExcludedFromContext ? 'excluded-context' : ''}`}
            ref={msgRef ? (el) => { msgRef.current = el; } : null}
          >
            {msg.role === 'user' ? (
              <UserMessage
                message={msg}
                siblings={siblingsInfo.siblings}
                currentIndex={siblingsInfo.currentIndex}
                total={siblingsInfo.total}
                onEdit={onEditMessage}
                onNavigate={onNavigate}
                isEditing={editingMessageId === msg.id}
                isLoading={isLoading}
                showRetry={showRetry}
                onRetry={onRetry}
                messageRef={msgRef}
                onScrollToResponse={handleScrollToResponse}
                isExcludedFromCopy={isExcludedFromCopy}
                isExcludedFromContext={isExcludedFromContext}
                onToggleExcludeFromCopy={onToggleExcludeFromCopy}
                onToggleExcludeFromContext={onToggleExcludeFromContext}
                charCount={charCount}
              />
            ) : (
              <AssistantMessage
                msg={msg}
                messageRef={msgRef}
                isExcludedFromCopy={isExcludedFromCopy}
                isExcludedFromContext={isExcludedFromContext}
                onToggleExcludeFromCopy={onToggleExcludeFromCopy}
                onToggleExcludeFromContext={onToggleExcludeFromContext}
                charCount={charCount}
              />
            )}
          </div>
        );
      })}

      {/* Show loading assistant message when pending (page was refreshed mid-request) */}
      {isPendingResponse && (
        <div className="assistant-message" ref={pendingResponseRef}>
          <div className="message-label">LLM Council</div>
          {pendingTimeout ? (
            <div className="stage-error">
              {jobError ? (
                <>
                  <span>Request failed: {jobError}</span>
                  <span className="error-hint">Check the backend terminal for details, then use the Retry button above.</span>
                </>
              ) : (
                <>
                  <span>Request timed out after 2 minutes. The backend may be unresponsive.</span>
                  <span className="error-hint">Check the backend terminal for errors, then use the Retry button above.</span>
                </>
              )}
            </div>
          ) : (
            <div className="stage-loading">
              <div className="spinner"></div>
              <div className="stage-loading-content">
                <span>
                  {jobStatus ? (
                    <>Running {getStageDisplayName(jobStatus)}... ({pendingSeconds}s)</>
                  ) : (
                    <>Waiting for response... ({pendingSeconds}s)</>
                  )}
                  {pendingSeconds > 30 && !jobStatus && " - this is taking longer than usual"}
                </span>
              </div>
              <ModelProgressIndicator modelProgress={modelProgress} stage={jobStatus} />
            </div>
          )}
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
});

export default function ChatInterface({
  conversation,
  displayMessages,
  onSendMessage,
  onEditMessage,
  onNavigate,
  getSiblingsForMessage,
  isLoading,
  editingMessageId,
  isPendingResponse,
  pendingTimeout,
  pendingSeconds,
  jobStatus,
  jobError,
  modelProgress,
  onRetry,
  onCancel,
  excludedFromCopy,
  excludedFromContext,
  manualExcludedFromCopy,
  manualExcludedFromContext,
  onToggleExcludeFromCopy,
  onUploadFile,
  onToggleExcludeFromContext,
  copyCharThreshold,
  contextCharThreshold,
  onCopyCharThresholdChange,
  onContextCharThresholdChange
}) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [researchEnabled, setResearchEnabled] = useState(() => {
    // Load from localStorage, default to true
    const stored = localStorage.getItem('llm-council-research-enabled');
    return stored === null ? true : stored === 'true';
  });
  const fileInputRef = useRef(null);

  // Persist research preference
  useEffect(() => {
    localStorage.setItem('llm-council-research-enabled', researchEnabled.toString());
  }, [researchEnabled]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading && !isPendingResponse) {
      const attachmentIds = attachments.map(a => a.id);
      onSendMessage(input, attachmentIds, researchEnabled);
      setInput('');
      setAttachments([]);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input
    e.target.value = '';

    // Check file type
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are supported');
      setTimeout(() => setUploadError(null), 3000);
      return;
    }

    // Check file size (20MB max)
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('File too large. Maximum size: 20MB');
      setTimeout(() => setUploadError(null), 3000);
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const result = await onUploadFile(file);
      setAttachments(prev => [...prev, { ...result, originalName: file.name }]);
    } catch (error) {
      setUploadError(error.message || 'Failed to upload file');
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveAttachment = (fileId) => {
    setAttachments(prev => prev.filter(a => a.id !== fileId));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  // Use displayMessages if provided, otherwise fall back to empty array
  const messages = displayMessages || [];

  const placeholder = messages.length === 0
    ? "Ask your question... (Shift+Enter for new line, Enter to send)"
    : "Ask a follow-up question...";

  return (
    <div className="chat-interface">
      <MessagesList
        messages={messages}
        getSiblingsForMessage={getSiblingsForMessage}
        onEditMessage={onEditMessage}
        onNavigate={onNavigate}
        isLoading={isLoading}
        editingMessageId={editingMessageId}
        isPendingResponse={isPendingResponse}
        pendingTimeout={pendingTimeout}
        pendingSeconds={pendingSeconds}
        jobStatus={jobStatus}
        jobError={jobError}
        modelProgress={modelProgress}
        onRetry={onRetry}
        onCancel={onCancel}
        excludedFromCopy={excludedFromCopy}
        excludedFromContext={excludedFromContext}
        onToggleExcludeFromCopy={onToggleExcludeFromCopy}
        onToggleExcludeFromContext={onToggleExcludeFromContext}
        copyCharThreshold={copyCharThreshold}
        contextCharThreshold={contextCharThreshold}
        onCopyCharThresholdChange={onCopyCharThresholdChange}
        onContextCharThresholdChange={onContextCharThresholdChange}
      />

      <form className="input-form" onSubmit={handleSubmit}>
        {/* Attachments display */}
        {attachments.length > 0 && (
          <div className="attachments-bar">
            {attachments.map(attachment => (
              <div key={attachment.id} className="attachment-chip">
                <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="attachment-name" title={attachment.name || attachment.originalName}>
                  {(attachment.name || attachment.originalName).length > 20
                    ? (attachment.name || attachment.originalName).substring(0, 17) + '...'
                    : (attachment.name || attachment.originalName)}
                </span>
                <span className="attachment-info">
                  {attachment.page_count} pages
                </span>
                {attachment.warning && (
                  <span className="attachment-warning" title={attachment.warning}>⚠️</span>
                )}
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  title="Remove attachment"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload error display */}
        {uploadError && (
          <div className="upload-error">
            {uploadError}
          </div>
        )}

        <div className="input-row">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Upload button */}
          <button
            type="button"
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || isPendingResponse || isUploading}
            title="Attach PDF document"
          >
            {isUploading ? (
              <div className="upload-spinner"></div>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>

          {/* Web Research toggle */}
          <button
            type="button"
            className={`research-toggle ${researchEnabled ? 'enabled' : ''}`}
            onClick={() => setResearchEnabled(!researchEnabled)}
            disabled={isLoading || isPendingResponse}
            title={researchEnabled ? 'Web research enabled - click to disable' : 'Web research disabled - click to enable'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          <textarea
            className="message-input"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isPendingResponse}
            rows={3}
          />

          {(isLoading || isPendingResponse) ? (
            <button
              type="button"
              className="stop-button"
              onClick={onCancel}
              title="Stop generation"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
