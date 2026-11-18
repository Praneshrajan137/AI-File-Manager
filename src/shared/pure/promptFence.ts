/**
 * Prompt fencing and tag-neutralization helpers isolating untrusted workspace excerpts
 * from system and wrapper context tags.
 */

export function escapePromptFenceText(value: string): string {
  return value
    .replace(/<(\/?\s*(?:untrusted_workspace_data|workspace_context|system)\b)/gi, '&lt;$1')
    .replace(/<\|([A-Za-z0-9_/-]{1,40})\|>/g, '&lt;|$1|&gt;');
}

export function neutralizeOuterContextTags(value: string): string {
  return value
    .replace(/<(\/?\s*(?:workspace_context|system)\b)/gi, '&lt;$1')
    .replace(/<\|([A-Za-z0-9_/-]{1,40})\|>/g, '&lt;|$1|&gt;');
}

export function escapePromptFenceAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'));
}

export function formatUntrustedWorkspaceData(
  source: string,
  citation: string,
  content: string,
  heading?: string
): string {
  const safeSource = escapePromptFenceAttr(source);
  const safeCitation = escapePromptFenceAttr(citation);
  const safeHeading = heading ? ` (${escapePromptFenceText(heading)})` : '';
  const safeBody = escapePromptFenceText(content);
  return `<untrusted_workspace_data source="${safeSource}" citation="${safeCitation}">
📄 **FILE: ${safeCitation}**${safeHeading}
📍 PATH: ${safeSource}
---
${safeBody}
---
</untrusted_workspace_data>`;
}
