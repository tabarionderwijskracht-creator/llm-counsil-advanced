import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fixNestedCodeBlocks } from '../utils/markdown';

/**
 * Markdown component with support for:
 * - GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - Nested code blocks (automatically fixed)
 *
 * Note: LaTeX math support was removed because $-based math delimiters
 * conflict with dollar amounts in financial content (e.g., "$1,940").
 */
export default function Markdown({ children, className = 'markdown-content' }) {
  const processedContent = fixNestedCodeBlocks(children);

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
