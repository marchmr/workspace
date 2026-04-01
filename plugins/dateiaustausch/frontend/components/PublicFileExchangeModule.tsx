import type { FormEvent, ReactNode } from 'react';

type PortalFileItemLike = {
    id: number;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    currentVersionId: number | null;
    currentVersionNo: number | null;
    updatedAt: string | null;
};

type FolderTreeNode = {
    name: string;
    path: string;
    count: number;
    childList: FolderTreeNode[];
};

type Props = {
    available: boolean;
    filesError: string | null;
    filesLoading: boolean;
    filesSort: 'newest' | 'name' | 'folder';
    filesFolderFilter: string;
    folderOptions: string[];
    folderTreeNodes: FolderTreeNode[];
    visibleFiles: PortalFileItemLike[];
    selectedFilesCount: number;
    uploadFolderPath: string;
    newFolderName: string;
    uploadComment: string;
    uploadProgress: { done: number; total: number } | null;
    dragOverUpload: boolean;
    sessionToken: string;
    onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onFileInputChange: (fileList: FileList | null) => void;
    onDropFiles: (fileList: FileList | null) => void;
    onFolderSelectChange: (value: string) => void;
    onNewFolderChange: (value: string) => void;
    onCommentChange: (value: string) => void;
    onFolderFilterChange: (value: string) => void;
    onSortChange: (value: 'newest' | 'name' | 'folder') => void;
    onDeleteFile: (id: number) => void;
    onDragOverUploadChange: (value: boolean) => void;
    formatDate: (value: string | null | undefined) => string;
};

function formatWorkflowStatus(value: PortalFileItemLike['workflowStatus']): string {
    if (value === 'clean') return 'Geprüft';
    if (value === 'reviewed') return 'Freigegeben';
    if (value === 'rejected') return 'Gesperrt';
    return 'In Prüfung';
}

function renderFolderTree(
    nodes: FolderTreeNode[],
    depth: number,
    activePath: string,
    onSelect: (path: string) => void,
): ReactNode[] {
    return nodes.flatMap((node) => {
        const isActive = activePath === node.path;
        const row = (
            <button
                key={node.path}
                type="button"
                className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'space-between', paddingLeft: `${12 + depth * 16}px` }}
                onClick={() => onSelect(node.path)}
            >
                <span>{node.name}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>{node.count}</span>
            </button>
        );
        if (!node.childList.length) return [row];
        return [row, ...renderFolderTree(node.childList, depth + 1, activePath, onSelect)];
    });
}

export default function PublicFileExchangeModule(props: Props) {
    const {
        available,
        filesError,
        filesLoading,
        filesSort,
        filesFolderFilter,
        folderOptions,
        folderTreeNodes,
        visibleFiles,
        selectedFilesCount,
        uploadFolderPath,
        newFolderName,
        uploadComment,
        uploadProgress,
        dragOverUpload,
        sessionToken,
        onUploadSubmit,
        onFileInputChange,
        onDropFiles,
        onFolderSelectChange,
        onNewFolderChange,
        onCommentChange,
        onFolderFilterChange,
        onSortChange,
        onDeleteFile,
        onDragOverUploadChange,
        formatDate,
    } = props;

    return (
        <div className="kp-coming-soon kp-module-shell">
            <h3 className="kp-module-title">Dateiaustausch</h3>
            {!available ? (
                <p className="text-muted" style={{ marginTop: 0 }}>
                    Das Plugin <strong>Dateiaustausch</strong> ist derzeit deaktiviert. Aktivieren Sie es in der Regie/Plugin-Verwaltung.
                </p>
            ) : null}
            <p className="text-muted kp-module-subtitle" style={{ marginTop: 0 }}>Sicherer Dateiaustausch wie eine private Cloud, mit Ordnerstruktur und Versionen.</p>

            <div className="kp-cloud-layout">
                <aside className="kp-module-block kp-cloud-sidebar">
                    <div className="kp-cloud-sidebar-head">
                        <h4>Ordner</h4>
                    </div>
                    <button
                        type="button"
                        className={`btn ${filesFolderFilter ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => onFolderFilterChange('')}
                    >
                        Alle Ordner
                    </button>
                    {renderFolderTree(folderTreeNodes, 0, filesFolderFilter, onFolderFilterChange)}
                </aside>

                <div className="kp-cloud-main">
                    <form onSubmit={onUploadSubmit} className="vp-stack">
                        <div
                            className={`kp-cloud-dropzone${dragOverUpload ? ' is-dragover' : ''}`}
                            onDragOver={(event) => {
                                event.preventDefault();
                                onDragOverUploadChange(true);
                            }}
                            onDragLeave={() => onDragOverUploadChange(false)}
                            onDrop={(event) => {
                                event.preventDefault();
                                onDropFiles(event.dataTransfer?.files || null);
                            }}
                        >
                            <p className="kp-cloud-dropzone-title">Dateien hier hineinziehen oder auswaehlen</p>
                            <p className="text-muted kp-cloud-dropzone-subtitle">Mehrere Dateien gleichzeitig moeglich.</p>
                            <input
                                className="input"
                                type="file"
                                multiple
                                onChange={(event) => onFileInputChange(event.target.files)}
                                accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xlsx,.pptx,.txt,.zip"
                                disabled={!available}
                                required
                            />
                            {selectedFilesCount > 0 && (
                                <p className="text-muted kp-cloud-selected-count">
                                    {selectedFilesCount} Datei(en) ausgewählt
                                </p>
                            )}
                        </div>
                        <select className="input" value={uploadFolderPath} onChange={(event) => onFolderSelectChange(event.target.value)}>
                            <option value="">Ordner auswählen (optional)</option>
                            {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                        </select>
                        <input
                            className="input"
                            value={newFolderName}
                            onChange={(event) => onNewFolderChange(event.target.value)}
                            disabled={!available}
                            placeholder="Oder neuen Ordner anlegen, z. B. Fotos/April"
                        />
                        <textarea
                            className="input"
                            rows={3}
                            value={uploadComment}
                            onChange={(event) => onCommentChange(event.target.value)}
                            disabled={!available}
                            placeholder="Kommentar zur Datei (optional)"
                        />
                        <button className="btn btn-primary" type="submit" disabled={filesLoading || !available}>
                            {filesLoading ? (uploadProgress ? `Lade hoch... (${uploadProgress.done}/${uploadProgress.total})` : 'Lade hoch...') : 'Dateien sicher hochladen'}
                        </button>
                    </form>

                    {filesError && <p className="text-danger" style={{ marginTop: 10 }}>{filesError}</p>}

                    <div className="kp-cloud-toolbar">
                        <select className="input" value={filesFolderFilter} onChange={(event) => onFolderFilterChange(event.target.value)}>
                            <option value="">Alle Ordner</option>
                            {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                        </select>
                        <select className="input" value={filesSort} onChange={(event) => onSortChange(event.target.value as 'newest' | 'name' | 'folder')}>
                            <option value="newest">Sortierung: Neueste</option>
                            <option value="name">Sortierung: Dateiname</option>
                            <option value="folder">Sortierung: Ordner</option>
                        </select>
                    </div>

                    <div className="kp-module-table-wrap">
                        <table className="kp-module-table">
                            <thead>
                                <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                    <th style={{ padding: '10px 12px' }}>Datei</th>
                                    <th style={{ padding: '10px 12px' }}>Ordner</th>
                                    <th style={{ padding: '10px 12px' }}>Status</th>
                                    <th style={{ padding: '10px 12px' }}>Version</th>
                                    <th style={{ padding: '10px 12px' }}>Aktualisiert</th>
                                    <th style={{ padding: '10px 12px' }}>Download</th>
                                    <th style={{ padding: '10px 12px' }}>Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleFiles.map((entry) => (
                                    <tr key={entry.id} style={{ borderTop: '1px solid var(--line)' }}>
                                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{entry.displayName}</td>
                                        <td style={{ padding: '10px 12px' }}>{entry.folderPath || 'Root'}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <span className={`kp-status-badge is-${entry.workflowStatus}`}>{formatWorkflowStatus(entry.workflowStatus)}</span>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>V{entry.currentVersionNo || 0}</td>
                                        <td style={{ padding: '10px 12px' }}>{formatDate(entry.updatedAt)}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {entry.currentVersionId && (entry.workflowStatus === 'clean' || entry.workflowStatus === 'reviewed') ? (
                                                <a
                                                    href={`/api/plugins/dateiaustausch/public/files/${entry.id}/versions/${entry.currentVersionId}/download?sessionToken=${encodeURIComponent(sessionToken)}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    Laden
                                                </a>
                                            ) : <span className="text-muted">Gesperrt</span>}
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <button className="btn btn-danger" type="button" onClick={() => onDeleteFile(entry.id)} disabled={filesLoading}>
                                                Löschen
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {!filesLoading && visibleFiles.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ padding: '12px' }} className="text-muted">
                                            Keine Dateien im gewählten Ordner.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
