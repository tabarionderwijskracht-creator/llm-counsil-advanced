import { useState } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  archivedConversations = [],
  folders = [],
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onArchiveConversation,
  onUnarchiveConversation,
  onDeleteConversation,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveConversation,
  showArchived = false,
  onToggleShowArchived,
  onOpenSearch,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null); // conversation id to confirm delete
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(null); // folder id to confirm delete
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveMenuOpen, setMoveMenuOpen] = useState(null); // conversation id with open move menu

  const handleConversationClick = (e, id) => {
    // Allow cmd+click (Mac) or ctrl+click (Windows) to open in new tab
    if (e.metaKey || e.ctrlKey) {
      return;
    }
    e.preventDefault();
    onSelectConversation(id);
  };

  const handleArchive = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    onArchiveConversation(id);
  };

  const handleUnarchive = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    onUnarchiveConversation(id);
  };

  const handleDeleteClick = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(id);
  };

  const handleConfirmDelete = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirmDelete) {
      onDeleteConversation(confirmDelete);
      setConfirmDelete(null);
    }
  };

  const handleCancelDelete = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(null);
  };

  const toggleFolder = (folderId) => {
    setCollapsedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleCreateFolder = (e) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName('');
      setShowNewFolder(false);
    }
  };

  const startEditFolder = (e, folder) => {
    e.stopPropagation();
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const handleRenameFolder = (e) => {
    e.preventDefault();
    if (editingFolderName.trim() && editingFolderId) {
      onRenameFolder(editingFolderId, editingFolderName.trim());
      setEditingFolderId(null);
      setEditingFolderName('');
    }
  };

  const handleDeleteFolderClick = (e, folderId) => {
    e.stopPropagation();
    setConfirmDeleteFolder(folderId);
  };

  const handleConfirmDeleteFolder = (e) => {
    e.stopPropagation();
    if (confirmDeleteFolder) {
      onDeleteFolder(confirmDeleteFolder);
      setConfirmDeleteFolder(null);
    }
  };

  const handleMoveConversation = (e, convId, folderId) => {
    e.stopPropagation();
    onMoveConversation(convId, folderId);
    setMoveMenuOpen(null);
  };

  const displayConversations = showArchived ? archivedConversations : conversations;

  // Group conversations by folder
  const conversationsByFolder = {};
  const uncategorized = [];

  displayConversations.forEach(conv => {
    if (conv.folder_id) {
      if (!conversationsByFolder[conv.folder_id]) {
        conversationsByFolder[conv.folder_id] = [];
      }
      conversationsByFolder[conv.folder_id].push(conv);
    } else {
      uncategorized.push(conv);
    }
  });

  const renderConversation = (conv) => (
    <div
      key={conv.id}
      className={`conversation-item-wrapper ${
        conv.id === currentConversationId ? 'active' : ''
      }`}
    >
      {confirmDelete === conv.id ? (
        <div className="delete-confirm">
          <span className="delete-confirm-text">Delete?</span>
          <button
            className="delete-confirm-btn yes"
            onClick={handleConfirmDelete}
            title="Confirm delete"
          >
            Yes
          </button>
          <button
            className="delete-confirm-btn no"
            onClick={handleCancelDelete}
            title="Cancel"
          >
            No
          </button>
        </div>
      ) : (
        <a
          href={`?conversation=${conv.id}`}
          className="conversation-item"
          onClick={(e) => handleConversationClick(e, conv.id)}
        >
          <div className="conversation-content">
            <div className="conversation-title">
              {conv.title || 'New Conversation'}
            </div>
            <div className="conversation-meta">
              {conv.message_count} messages
            </div>
          </div>
          <div className="conversation-actions">
            {!showArchived && (
              <div className="move-menu-container">
                <button
                  className="action-btn move"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMoveMenuOpen(moveMenuOpen === conv.id ? null : conv.id);
                  }}
                  title="Move to folder"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
                {moveMenuOpen === conv.id && (
                  <div className="move-menu">
                    <div
                      className="move-menu-item"
                      onClick={(e) => handleMoveConversation(e, conv.id, null)}
                    >
                      No folder
                    </div>
                    {folders.map(folder => (
                      <div
                        key={folder.id}
                        className={`move-menu-item ${conv.folder_id === folder.id ? 'active' : ''}`}
                        onClick={(e) => handleMoveConversation(e, conv.id, folder.id)}
                      >
                        {folder.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showArchived ? (
              <button
                className="action-btn unarchive"
                onClick={(e) => handleUnarchive(e, conv.id)}
                title="Restore conversation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            ) : (
              <button
                className="action-btn archive"
                onClick={(e) => handleArchive(e, conv.id)}
                title="Archive conversation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="5" rx="1"/>
                  <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
                  <path d="M10 12h4"/>
                </svg>
              </button>
            )}
            <button
              className="action-btn delete"
              onClick={(e) => handleDeleteClick(e, conv.id)}
              title="Delete conversation"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </a>
      )}
    </div>
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/oklogo.png" alt="Logo" className="sidebar-logo" />
          <span className="sidebar-title">Deep Research</span>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <button className="search-btn" onClick={onOpenSearch}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span>Search conversations</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${!showArchived ? 'active' : ''}`}
          onClick={() => onToggleShowArchived(false)}
        >
          Conversations ({conversations.length})
        </button>
        <button
          className={`sidebar-tab ${showArchived ? 'active' : ''}`}
          onClick={() => onToggleShowArchived(true)}
        >
          Archived ({archivedConversations.length})
        </button>
      </div>

      {!showArchived && (
        <div className="folder-actions">
          {showNewFolder ? (
            <form onSubmit={handleCreateFolder} className="new-folder-form">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                autoFocus
                className="folder-name-input"
              />
              <button type="submit" className="folder-btn save">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
              <button type="button" className="folder-btn cancel" onClick={() => setShowNewFolder(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </form>
          ) : (
            <button className="add-folder-btn" onClick={() => setShowNewFolder(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Folder
            </button>
          )}
        </div>
      )}

      <div className="conversation-list">
        {displayConversations.length === 0 ? (
          <div className="no-conversations">
            {showArchived ? 'No archived conversations' : 'No conversations yet'}
          </div>
        ) : (
          <>
            {/* Render folders */}
            {!showArchived && folders.map(folder => {
              const folderConversations = conversationsByFolder[folder.id] || [];
              const isCollapsed = collapsedFolders.has(folder.id);

              return (
                <div key={folder.id} className="folder-section">
                  {confirmDeleteFolder === folder.id ? (
                    <div className="delete-confirm folder-delete-confirm">
                      <span className="delete-confirm-text">Delete folder?</span>
                      <button
                        className="delete-confirm-btn yes"
                        onClick={handleConfirmDeleteFolder}
                      >
                        Yes
                      </button>
                      <button
                        className="delete-confirm-btn no"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteFolder(null);
                        }}
                      >
                        No
                      </button>
                    </div>
                  ) : editingFolderId === folder.id ? (
                    <form onSubmit={handleRenameFolder} className="folder-header editing">
                      <input
                        type="text"
                        value={editingFolderName}
                        onChange={(e) => setEditingFolderName(e.target.value)}
                        autoFocus
                        className="folder-name-input"
                      />
                      <button type="submit" className="folder-btn save">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="folder-btn cancel"
                        onClick={() => setEditingFolderId(null)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </form>
                  ) : (
                    <div
                      className="folder-header"
                      onClick={() => toggleFolder(folder.id)}
                    >
                      <svg
                        className={`folder-chevron ${isCollapsed ? 'collapsed' : ''}`}
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                      <span className="folder-name">{folder.name}</span>
                      <span className="folder-count">{folderConversations.length}</span>
                      <div className="folder-actions-btns">
                        <button
                          className="folder-btn edit"
                          onClick={(e) => startEditFolder(e, folder)}
                          title="Rename folder"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          className="folder-btn delete"
                          onClick={(e) => handleDeleteFolderClick(e, folder.id)}
                          title="Delete folder"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                  {!isCollapsed && folderConversations.length > 0 && (
                    <div className="folder-conversations">
                      {folderConversations.map(renderConversation)}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Render uncategorized conversations */}
            {uncategorized.length > 0 && (
              <div className="uncategorized-section">
                {!showArchived && folders.length > 0 && (
                  <div className="uncategorized-header">
                    <span>Uncategorized</span>
                    <span className="folder-count">{uncategorized.length}</span>
                  </div>
                )}
                {uncategorized.map(renderConversation)}
              </div>
            )}

            {/* Render archived (no folders) */}
            {showArchived && displayConversations.map(renderConversation)}
          </>
        )}
      </div>
    </div>
  );
}
