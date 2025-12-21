import {
  File,
  Folder,
  FileText,
  Image,
  Music,
  Video,
  Archive,
  Code,
  FileSpreadsheet,
  FileType,
  FileCode,
  Settings,
  Database,
  type LucideIcon
} from 'lucide-react';
import { FileNode } from '@shared/contracts';

/**
 * Elite Colorful File Icon System
 * 
 * Colors follow industry standards and visual hierarchy:
 * - PDF: Red (Adobe standard)
 * - Folders: Amber/Gold (classic, high visibility)
 * - Images: Purple (creative/visual)
 * - Videos: Pink/Rose (media)
 * - Audio: Violet (media variant)
 * - Code: Emerald/Green (developer)
 * - Archives: Orange (compressed)
 * - Spreadsheets: Green (Excel association)
 * - Documents: Blue (Word/professional)
 */

export interface FileIconResult {
  icon: LucideIcon;
  colorClass: string;
}

// Elite color palette for file types
const ICON_COLORS = {
  folder: 'text-amber-500',           // Gold folders - classic, high visibility
  pdf: 'text-red-500',                // Adobe red
  document: 'text-blue-500',          // Word/professional blue
  spreadsheet: 'text-emerald-500',    // Excel green
  presentation: 'text-orange-500',    // PowerPoint orange
  image: 'text-purple-500',           // Creative purple
  video: 'text-pink-500',             // Media pink
  audio: 'text-violet-500',           // Media violet
  archive: 'text-amber-600',          // Compressed amber
  code: 'text-emerald-500',           // Developer green
  config: 'text-slate-500',           // Config/settings gray
  data: 'text-cyan-500',              // Data files cyan
  text: 'text-slate-400',             // Plain text gray
  default: 'text-slate-400',          // Default gray
};

export function getFileIcon(fileNode: FileNode): LucideIcon {
  return getFileIconWithColor(fileNode).icon;
}

export function getFileIconWithColor(fileNode: FileNode): FileIconResult {
  if (fileNode.isDirectory) {
    return { icon: Folder, colorClass: ICON_COLORS.folder };
  }

  const ext = fileNode.extension.toLowerCase();

  // PDF - Red (Adobe standard)
  if (ext === 'pdf') {
    return { icon: FileType, colorClass: ICON_COLORS.pdf };
  }

  // Documents - Blue
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return { icon: FileType, colorClass: ICON_COLORS.document };
  }

  // Presentations - Orange
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return { icon: FileType, colorClass: ICON_COLORS.presentation };
  }

  // Spreadsheets - Green
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) {
    return { icon: FileSpreadsheet, colorClass: ICON_COLORS.spreadsheet };
  }

  // Images - Purple
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'ico', 'webp', 'tiff', 'raw'].includes(ext)) {
    return { icon: Image, colorClass: ICON_COLORS.image };
  }

  // Videos - Pink
  if (['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) {
    return { icon: Video, colorClass: ICON_COLORS.video };
  }

  // Audio - Violet
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff'].includes(ext)) {
    return { icon: Music, colorClass: ICON_COLORS.audio };
  }

  // Archives - Amber
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) {
    return { icon: Archive, colorClass: ICON_COLORS.archive };
  }

  // Code files - Emerald
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs',
    'php', 'rb', 'swift', 'kt', 'scala', 'r', 'm', 'h', 'hpp', 'sql',
    'sh', 'bat', 'ps1'].includes(ext)) {
    return { icon: FileCode, colorClass: ICON_COLORS.code };
  }

  // Web/Markup - Emerald variant
  if (['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte'].includes(ext)) {
    return { icon: Code, colorClass: ICON_COLORS.code };
  }

  // Config/Data files - Slate
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env'].includes(ext)) {
    return { icon: Settings, colorClass: ICON_COLORS.config };
  }

  // XML/Data - Cyan
  if (['xml', 'xsl', 'xslt'].includes(ext)) {
    return { icon: Database, colorClass: ICON_COLORS.data };
  }

  // Text files - Slate
  if (['txt', 'md', 'log', 'readme'].includes(ext)) {
    return { icon: FileText, colorClass: ICON_COLORS.text };
  }

  // Executables - Special
  if (['exe', 'msi', 'app', 'dmg', 'deb', 'rpm'].includes(ext)) {
    return { icon: Settings, colorClass: 'text-slate-600' };
  }

  // Default
  return { icon: File, colorClass: ICON_COLORS.default };
}

