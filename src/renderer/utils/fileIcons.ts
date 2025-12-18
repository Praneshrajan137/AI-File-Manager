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
  type LucideIcon
} from 'lucide-react';
import { FileNode } from '@shared/contracts';

export function getFileIcon(fileNode: FileNode): LucideIcon {
  if (fileNode.isDirectory) {
    return Folder;
  }
  
  const iconMap: Record<string, LucideIcon> = {
    // Text files
    txt: FileText,
    md: FileText,
    log: FileText,
    rtf: FileText,
    
    // Images
    jpg: Image,
    jpeg: Image,
    png: Image,
    gif: Image,
    bmp: Image,
    svg: Image,
    ico: Image,
    webp: Image,
    
    // Videos
    mp4: Video,
    avi: Video,
    mov: Video,
    mkv: Video,
    wmv: Video,
    flv: Video,
    webm: Video,
    
    // Audio
    mp3: Music,
    wav: Music,
    flac: Music,
    aac: Music,
    ogg: Music,
    m4a: Music,
    wma: Music,
    
    // Archives
    zip: Archive,
    rar: Archive,
    '7z': Archive,
    tar: Archive,
    gz: Archive,
    bz2: Archive,
    xz: Archive,
    
    // Code files
    js: FileCode,
    jsx: FileCode,
    ts: FileCode,
    tsx: FileCode,
    py: FileCode,
    java: FileCode,
    c: FileCode,
    cpp: FileCode,
    cs: FileCode,
    go: FileCode,
    rs: FileCode,
    php: FileCode,
    rb: FileCode,
    swift: FileCode,
    kt: FileCode,
    scala: FileCode,
    r: FileCode,
    m: FileCode,
    h: FileCode,
    hpp: FileCode,
    sql: FileCode,
    sh: FileCode,
    bat: FileCode,
    ps1: FileCode,
    html: Code,
    htm: Code,
    xml: Code,
    json: Code,
    yaml: Code,
    yml: Code,
    toml: Code,
    ini: Code,
    cfg: Code,
    conf: Code,
    css: Code,
    scss: Code,
    sass: Code,
    less: Code,
    
    // Spreadsheets
    xlsx: FileSpreadsheet,
    xls: FileSpreadsheet,
    csv: FileSpreadsheet,
    ods: FileSpreadsheet,
    
    // Documents
    pdf: FileType,
    doc: FileType,
    docx: FileType,
    odt: FileType,
    ppt: FileType,
    pptx: FileType,
    odp: FileType,
  };
  
  return iconMap[fileNode.extension.toLowerCase()] || File;
}
