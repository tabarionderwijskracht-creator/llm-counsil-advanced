import { useState, memo } from 'react';
import Markdown from './Markdown';
import './Stage0.css';

export default memo(function Stage0({ research }) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!research || !research.content) {
    return null;
  }

  const sources = research.sources || [];

  return (
    <div className={`stage stage0 ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="stage-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className="stage-title">Web Research</h3>
        <span className="stage-summary">
          {sources.length} source{sources.length !== 1 ? 's' : ''}
        </span>
        <svg
          className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isExpanded && (
        <div className="stage-content">
          <div className="research-content">
            <Markdown>{research.content}</Markdown>
          </div>

          {sources.length > 0 && (
            <div className="sources-section">
              <h4 className="sources-title">Sources</h4>
              <ul className="sources-list">
                {sources.map((source, index) => (
                  <li key={index} className="source-item">
                    <svg
                      className="source-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-link"
                    >
                      {source.title || source.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
