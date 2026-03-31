import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../context/AuthContext';
import { useModal, useToast } from '../../components/ModalProvider';

type UpdateBranch = 'main' | 'experimental';

interface CommitEntry {
    message: string;
    hash: string;
    date: string;
}

interface CoreUpdate {
    branch: UpdateBranch;
    available: boolean;
    current: {
        version: string;
        commitHash?: string;
    };
    remote?: {
        version?: string;
        commitHash?: string;
        commitMessages?: CommitEntry[];
        changelog?: string;
        releaseName?: string;
        publishedAt?: string;
    };
    updateCommand: string;
}

interface PluginUpdate {
    pluginId: string;
    current: string;
    available: string;
    hasUpdate: boolean;
}

interface LocalPluginEntry {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
}

interface InstalledPlugin {
    pluginId: string;
    name: string;
    version: string;
    isActive: boolean;
    installedAt: string | null;
}

interface BackupEntry {
    fileName: string;
    branch: string;
    sizeBytes: number;
    createdAt: string;
    restoreCommand: string;
}

interface UpdateTaskLogEntry {
    at: string;
    level: 'info' | 'success' | 'error';
    message: string;
}

interface UpdateTaskPayload {
    id: string;
    type: 'core' | 'plugin-install' | 'plugin-update' | 'plugin-remove';
    target: string;
    status: 'queued' | 'running' | 'success' | 'error';
    progress: number;
    createdAt: string;
    updatedAt: string;
    version?: string;
    error?: string;
    logs: UpdateTaskLogEntry[];
}

interface ChangelogRelease {
    version: string;
    name: string;
    body: string;
    publishedAt: string;
    prerelease: boolean;
}

const branchInfo: Record<UpdateBranch, { label: string; description: string; badgeClass: string }> = {
    main: { label: 'Main', description: 'Stabil - Empfohlen für Produktivumgebungen', badgeClass: 'badge-success' },
    experimental: { label: 'Experimental', description: 'Experimentell - Neuste Commits, keine Garantie', badgeClass: 'badge-warning' },
};

const copyIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
);

const checkIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const warningIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const refreshIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
);

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    try {
        return new Date(dateStr).toLocaleDateString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

export default function UpdateManager() {
    const modal = useModal();
    const toast = useToast();

    const [core, setCore] = useState<CoreUpdate | null>(null);
    const [plugins, setPlugins] = useState<PluginUpdate[]>([]);
    const [localPlugins, setLocalPlugins] = useState<LocalPluginEntry[]>([]);
    const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);
    const [task, setTask] = useState<UpdateTaskPayload | null>(null);

    // Branch state
    const [currentBranch, setCurrentBranch] = useState<UpdateBranch>('main');
    const [selectedBranch, setSelectedBranch] = useState<UpdateBranch>('main');
    const [branchSaving, setBranchSaving] = useState(false);
    const [checkInterval, setCheckInterval] = useState(10);
    const [intervalSaving, setIntervalSaving] = useState(false);

    // Changelog history
    const [changelogHistory, setChangelogHistory] = useState<{
        releases?: ChangelogRelease[];
        commits?: CommitEntry[];
    } | null>(null);
    const [showChangelog, setShowChangelog] = useState(false);

    // Copied state for command
    const [copied, setCopied] = useState(false);

    const loadBranchSettings = useCallback(async () => {
        try {
            const res = await apiFetch('/api/admin/updates/branch');
            if (res.ok) {
                const data = await res.json();
                setCurrentBranch(data.branch || 'main');
                setSelectedBranch(data.branch || 'main');
                setCheckInterval(data.checkInterval || 10);
            }
        } catch { /* */ }
    }, []);

    const checkUpdates = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/admin/updates/check');
            if (res.ok) {
                const data = await res.json();
                setCore(data.core);
                setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
                setLocalPlugins(Array.isArray(data.catalog) ? data.catalog : []);
                setInstalledPlugins(Array.isArray(data.installedPlugins) ? data.installedPlugins : []);
                setBackups(Array.isArray(data.backups) ? data.backups : []);
            }
        } catch { /* */ }
        setLoading(false);
    }, []);

    const loadChangelogHistory = useCallback(async () => {
        try {
            const res = await apiFetch('/api/admin/updates/changelog-history');
            if (res.ok) {
                const data = await res.json();
                setChangelogHistory(data);
            }
        } catch { /* */ }
    }, []);

    useEffect(() => {
        void loadBranchSettings();
        void checkUpdates();
    }, [loadBranchSettings, checkUpdates]);

    // Branch speichern
    const saveBranch = async () => {
        if (selectedBranch === currentBranch) return;

        // Branch-Wechsel-Warnung
        const isDowngrade = currentBranch === 'experimental' && selectedBranch !== 'experimental';
        const isUpgrade = (selectedBranch === 'experimental' && currentBranch !== 'experimental');

        if (isUpgrade) {
            const ok = await modal.confirm({
                title: 'Branch-Wechsel: Experimental',
                message: 'Der Experimental-Branch enthält die neusten Commits und ist möglicherweise instabil. Fehler und Datenverlust sind möglich.\n\nSind Sie sicher?',
                confirmText: 'Wechseln',
                variant: 'warning',
            });
            if (!ok) return;
        } else if (isDowngrade) {
            const ok = await modal.confirm({
                title: 'Branch-Wechsel',
                message: 'Achtung: Ein Wechsel auf einen älteren Branch kann zu Inkompatibilitäten führen. Stellen Sie sicher, dass Sie ein Backup haben.\n\nFortfahren?',
                confirmText: 'Wechseln',
                variant: 'warning',
            });
            if (!ok) return;
        }

        setBranchSaving(true);
        try {
            const res = await apiFetch('/api/admin/updates/branch', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch: selectedBranch }),
            });
            if (res.ok) {
                setCurrentBranch(selectedBranch);
                toast.success(`Branch auf "${branchInfo[selectedBranch].label}" gewechselt`);
                await checkUpdates();
                setChangelogHistory(null);
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || 'Branch konnte nicht gespeichert werden');
            }
        } catch {
            toast.error('Netzwerkfehler');
        }
        setBranchSaving(false);
    };

    // Update-Intervall speichern
    const saveInterval = async () => {
        setIntervalSaving(true);
        try {
            const res = await apiFetch('/api/admin/updates/check-interval', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seconds: checkInterval }),
            });
            if (res.ok) {
                toast.success('Prüf-Intervall gespeichert');
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || 'Intervall konnte nicht gespeichert werden');
            }
        } catch {
            toast.error('Netzwerkfehler');
        }
        setIntervalSaving(false);
    };

    // Befehl kopieren
    const copyCommand = async (command: string) => {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback
            const el = document.createElement('textarea');
            el.value = command;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Plugin-Verwaltung
    const pollTask = async (taskId: string): Promise<UpdateTaskPayload | null> => {
        const deadline = Date.now() + 10 * 60_000;
        while (Date.now() < deadline) {
            try {
                const res = await apiFetch(`/api/admin/updates/tasks/${taskId}`);
                if (res.ok) {
                    const payload = await res.json();
                    const currentTask = payload?.task as UpdateTaskPayload | undefined;
                    if (currentTask) {
                        setTask(currentTask);
                        if (currentTask.status === 'success' || currentTask.status === 'error') {
                            return currentTask;
                        }
                    }
                }
            } catch { /* */ }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return null;
    };

    const waitForUpdatesEndpoint = async () => {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            try {
                const res = await apiFetch('/api/admin/updates/check');
                if (!res.ok) continue;
                const data = await res.json();
                setCore(data.core);
                setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
                setLocalPlugins(Array.isArray(data.catalog) ? data.catalog : []);
                setInstalledPlugins(Array.isArray(data.installedPlugins) ? data.installedPlugins : []);
                setBackups(Array.isArray(data.backups) ? data.backups : []);
                return;
            } catch { /* */ }
        }
        await checkUpdates();
    };

    const togglePlugin = async (pluginId: string, activate: boolean) => {
        const action = activate ? 'aktivieren' : 'deaktivieren';
        const ok = await modal.confirm({ title: `Plugin ${action}`, message: `Plugin "${pluginId}" ${action}? Server muss danach neu gestartet werden.`, confirmText: activate ? 'Aktivieren' : 'Deaktivieren', variant: 'warning' });
        if (!ok) return;
        setToggling(pluginId);
        try {
            const endpoint = activate ? 'activate-plugin' : 'deactivate-plugin';
            const res = await apiFetch(`/api/admin/updates/${endpoint}/${pluginId}`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                toast.error(data?.error || `Plugin ${pluginId} konnte nicht ${action === 'aktivieren' ? 'aktiviert' : 'deaktiviert'} werden`);
                return;
            }
            toast.success(data.message || `Plugin ${pluginId} ${action === 'aktivieren' ? 'aktiviert' : 'deaktiviert'}`);
            await checkUpdates();
        } finally { setToggling(null); }
    };

    const removePlugin = async (pluginId: string) => {
        const ok = await modal.confirm({ title: 'Plugin entfernen', message: `Plugin "${pluginId}" wirklich entfernen? DB-Eintraege, Permissions und Migrations-Tracking werden geloescht. Plugin-Dateien bleiben erhalten (kommen mit dem naechsten Update zurueck).`, confirmText: 'Entfernen', variant: 'danger' });
        if (!ok) return;
        setToggling(`remove-${pluginId}`);
        setTask(null);
        try {
            const res = await apiFetch(`/api/admin/updates/remove-plugin/${pluginId}`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data?.success || !data?.taskId) {
                toast.error(data?.error || `Plugin ${pluginId} konnte nicht entfernt werden`);
                return;
            }
            const finalTask = await pollTask(String(data.taskId));
            if (!finalTask) { toast.error('Status konnte nicht abgerufen werden.'); return; }
            if (finalTask.status === 'error') { toast.error(finalTask.error || `Plugin ${pluginId} fehlgeschlagen`); return; }
            toast.success(`Plugin ${pluginId} erfolgreich entfernt.`);
            await checkUpdates();
        } finally { setToggling(null); }
    };

    if (loading) return <div className="text-muted">Prüfe auf Updates...</div>;

    const pluginUpdatesById = new Map(plugins.map((entry) => [entry.pluginId, entry]));
    const installedPluginIds = new Set(installedPlugins.map((entry) => entry.pluginId));
    const unregisteredPlugins = localPlugins.filter((entry) => !installedPluginIds.has(entry.id));
    const installedPluginsSorted = [...installedPlugins].sort((a, b) => a.name.localeCompare(b.name, 'de'));

    // Neuestes Backup prüfen für Rollback-Info
    const newestBackup = backups.length > 0 ? backups[0] : null;
    const isRecentBackup = newestBackup && (Date.now() - new Date(newestBackup.createdAt).getTime() < 5 * 60 * 1000);

    const intervalOptions = [
        { value: 7200, label: '2 Stunden' },
        { value: 21600, label: '6 Stunden' },
        { value: 43200, label: '12 Stunden' },
        { value: 86400, label: '24 Stunden' },
    ];

    return (
        <div>
            <div className="flex-between">
                <div className="page-header">
                    <h1 className="page-title">Updates & Deployment</h1>
                    <p className="page-subtitle">Branch-Verwaltung, Updates und Plugins</p>
                </div>
                <button className="btn btn-secondary" onClick={checkUpdates} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {refreshIcon} Erneut prüfen
                </button>
            </div>

            {/* 1. Branch-Auswahl */}
            <div className="card mb-md">
                <div className="card-title mb-md">Branch-Auswahl</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)' }}>
                    {(Object.keys(branchInfo) as UpdateBranch[]).map((branch) => {
                        const info = branchInfo[branch];
                        const isSelected = selectedBranch === branch;
                        const isCurrent = currentBranch === branch;
                        return (
                            <button
                                key={branch}
                                onClick={() => setSelectedBranch(branch)}
                                style={{
                                    padding: 'var(--space-md)',
                                    border: isSelected
                                        ? '2px solid var(--color-primary)'
                                        : '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                    background: isSelected ? 'var(--color-primary-alpha, rgba(99, 102, 241, 0.08))' : 'var(--color-bg-card)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    transition: 'all 150ms ease',
                                    position: 'relative',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <strong>{info.label}</strong>
                                    {isCurrent && <span className={`badge ${info.badgeClass}`} style={{ fontSize: 'var(--font-size-xs)' }}>Aktiv</span>}
                                </div>
                                <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{info.description}</div>
                            </button>
                        );
                    })}
                </div>

                {selectedBranch !== currentBranch && (
                    <div style={{ marginTop: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={saveBranch}
                            disabled={branchSaving}
                        >
                            {branchSaving ? 'Speichere...' : 'Branch wechseln'}
                        </button>
                        {selectedBranch === 'experimental' && (
                            <span style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {warningIcon} Instabil - Nur für Entwicklung empfohlen
                            </span>
                        )}
                    </div>
                )}

                {/* Update-Intervall */}
                <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
                        Automatische Update-Prüfung
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <select
                            value={checkInterval}
                            onChange={(e) => setCheckInterval(Number(e.target.value))}
                            className="input"
                            style={{ maxWidth: 220 }}
                        >
                            {intervalOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={saveInterval}
                            disabled={intervalSaving}
                        >
                            {intervalSaving ? 'Speichere...' : 'Speichern'}
                        </button>
                    </div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 4 }}>
                        Wie oft automatisch nach Updates gesucht wird. Bei verfügbarem Update erhalten Admins eine Benachrichtigung.
                    </div>
                </div>
            </div>

            {/* 2. Update-Status */}
            {core && (
                <div className="card mb-md">
                    <div className="flex-between mb-md">
                        <div>
                            <div className="card-title">Update-Status</div>
                            <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginTop: 4 }}>
                                Branch: <strong>{branchInfo[core.branch]?.label || core.branch}</strong> |
                                Version: <strong>v{core.current.version}</strong>
                                {core.current.commitHash && <> | Commit: <code style={{ fontSize: 'var(--font-size-xs)' }}>{core.current.commitHash.slice(0, 8)}</code></>}
                            </p>
                        </div>
                        {core.available ? (
                            <span className="badge badge-success">Update verfügbar</span>
                        ) : (
                            <span className="badge badge-info">Aktuell</span>
                        )}
                    </div>

                    {core.available && core.remote && (
                        <>
                            {/* Neue Version Info */}
                            <div style={{
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-md)',
                                marginBottom: 'var(--space-md)',
                            }}>
                                {core.branch !== 'experimental' ? (
                                    <>
                                        <div style={{ fontWeight: 600 }}>
                                            {core.remote.releaseName || `v${core.remote.version}`}
                                        </div>
                                        {core.remote.publishedAt && (
                                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 2 }}>
                                                Veroeffentlicht: {formatDate(core.remote.publishedAt)}
                                            </div>
                                        )}
                                        {core.remote.changelog && (
                                            <div style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                                {core.remote.changelog}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <div style={{ fontWeight: 600 }}>
                                            Neuer Commit: <code style={{ fontSize: 'var(--font-size-sm)' }}>{core.remote.commitHash?.slice(0, 8)}</code>
                                        </div>
                                        {core.remote.commitMessages && core.remote.commitMessages.length > 0 && (
                                            <div style={{ marginTop: 'var(--space-sm)' }}>
                                                {core.remote.commitMessages.map((c, i) => (
                                                    <div key={i} style={{
                                                        fontSize: 'var(--font-size-sm)',
                                                        padding: '4px 0',
                                                        borderBottom: i < core.remote!.commitMessages!.length - 1 ? '1px solid var(--color-border)' : 'none',
                                                        display: 'flex',
                                                        gap: 8,
                                                    }}>
                                                        <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', flexShrink: 0 }}>{c.hash}</code>
                                                        <span style={{ flex: 1 }}>{c.message}</span>
                                                        <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)', flexShrink: 0 }}>
                                                            {formatDate(c.date)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* 3. SSH-Befehl-Box */}
                            <div style={{
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-primary)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-md)',
                            }}>
                                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)' }}>
                                    Update-Befehl (per SSH als root ausfuehren)
                                </div>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-sm)',
                                    background: 'var(--color-bg-card)',
                                    padding: 'var(--space-sm) var(--space-md)',
                                    borderRadius: 'var(--radius-sm)',
                                    fontFamily: 'monospace',
                                    fontSize: 'var(--font-size-sm)',
                                    border: '1px solid var(--color-border)',
                                }}>
                                    <code style={{ flex: 1, wordBreak: 'break-all' }}>{core.updateCommand}</code>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => copyCommand(core.updateCommand)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                                        title="Befehl kopieren"
                                    >
                                        {copied ? checkIcon : copyIcon}
                                        {copied ? 'Kopiert' : 'Kopieren'}
                                    </button>
                                </div>
                                <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-sm)' }}>
                                    Vor dem Update wird automatisch ein Backup erstellt.
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Rollback-Info */}
            {isRecentBackup && newestBackup && (
                <div className="card mb-md" style={{ borderColor: 'var(--color-warning)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-sm)' }}>
                        {warningIcon}
                        <strong style={{ fontSize: 'var(--font-size-sm)' }}>Rollback verfügbar</strong>
                    </div>
                    <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)' }}>
                        Falls nach dem Update Probleme auftreten, kann der vorherige Stand wiederhergestellt werden:
                    </p>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        background: 'var(--color-bg)',
                        padding: 'var(--space-sm) var(--space-md)',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'monospace',
                        fontSize: 'var(--font-size-xs)',
                        border: '1px solid var(--color-border)',
                    }}>
                        <code style={{ flex: 1, wordBreak: 'break-all' }}>{newestBackup.restoreCommand}</code>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => copyCommand(newestBackup.restoreCommand)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                        >
                            {copyIcon} Kopieren
                        </button>
                    </div>
                </div>
            )}


            {/* 5. Backup-Übersicht */}
            <div className="card mb-md">
                <div className="card-title mb-md">Pre-Update-Backups</div>
                {backups.length === 0 ? (
                    <p className="text-muted">Keine Backups vorhanden.</p>
                ) : (
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr><th>Datum</th><th>Branch</th><th>Größe</th><th>Restore-Befehl</th></tr>
                            </thead>
                            <tbody>
                                {backups.map((backup) => (
                                    <tr key={`${backup.branch}-${backup.fileName}`}>
                                        <td>{formatDate(backup.createdAt)}</td>
                                        <td><span className={`badge ${branchInfo[backup.branch as UpdateBranch]?.badgeClass || 'badge-info'}`}>{backup.branch}</span></td>
                                        <td>{formatBytes(backup.sizeBytes)}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <code style={{ fontSize: 'var(--font-size-xs)', wordBreak: 'break-all', flex: 1 }}>{backup.restoreCommand}</code>
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => copyCommand(backup.restoreCommand)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
                                                    title="Befehl kopieren"
                                                >
                                                    {copyIcon}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Plugin-Task-Status */}
            {task && (
                <div className="card mb-md">
                    <div className="flex-between mb-md">
                        <div className="card-title">Plugin-Task-Status</div>
                        {task.status === 'success' ? (
                            <span className="badge badge-success">Erfolgreich</span>
                        ) : task.status === 'error' ? (
                            <span className="badge badge-warning">Fehler</span>
                        ) : (
                            <span className="badge badge-info">Laeuft</span>
                        )}
                    </div>

                    <div style={{ width: '100%', height: 10, borderRadius: 999, background: 'var(--color-bg)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                        <div
                            style={{
                                width: `${Math.max(0, Math.min(100, task.progress || 0))}%`,
                                height: '100%',
                                background: task.status === 'error' ? 'var(--color-danger)' : 'var(--color-primary)',
                                transition: 'width 180ms ease',
                            }}
                        />
                    </div>

                    <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                        {task.progress}% - {
                            task.type === 'plugin-install'
                                ? `Plugin ${task.target} installieren`
                                : task.type === 'plugin-update'
                                    ? `Plugin ${task.target} aktualisieren`
                                    : `Plugin ${task.target} entfernen`
                        }
                    </p>

                    <div style={{ marginTop: 'var(--space-md)', maxHeight: 220, overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)' }}>
                        {task.logs.map((entry, index) => (
                            <div key={`${entry.at}-${index}`} style={{ fontSize: 'var(--font-size-xs)', color: entry.level === 'error' ? 'var(--color-danger)' : entry.level === 'success' ? 'var(--color-success)' : 'var(--color-text-muted)', marginBottom: 6 }}>
                                <strong style={{ color: 'var(--color-text-muted)' }}>{new Date(entry.at).toLocaleTimeString('de-DE')}</strong> {entry.message}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 6. Plugin-Verwaltung */}
            <div className="card mb-md">
                <div className="card-title mb-md">Plugins</div>
                <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}>
                    Plugins werden mit dem Core-Repository ausgeliefert und bei Updates automatisch aktualisiert.
                </p>
                {installedPluginsSorted.length === 0 && unregisteredPlugins.length === 0 ? (
                    <p className="text-muted">Keine Plugins im System vorhanden.</p>
                ) : (
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr><th>Plugin</th><th>Name</th><th>Version</th><th>Status</th><th>Aktionen</th></tr>
                            </thead>
                            <tbody>
                                {installedPluginsSorted.map((plugin) => {
                                    const updateState = pluginUpdatesById.get(plugin.pluginId);
                                    const hasUpdate = Boolean(updateState?.hasUpdate);
                                    return (
                                        <tr key={plugin.pluginId}>
                                            <td><strong>{plugin.pluginId}</strong></td>
                                            <td>{plugin.name}</td>
                                            <td>
                                                v{plugin.version}
                                                {hasUpdate && <span className="badge badge-success" style={{ marginLeft: 6, fontSize: 'var(--font-size-xs)' }}>v{updateState?.available} verfuegbar</span>}
                                            </td>
                                            <td>{plugin.isActive ? <span className="badge badge-success">Aktiv</span> : <span className="badge badge-warning">Inaktiv</span>}</td>
                                            <td style={{ display: 'flex', gap: 8 }}>
                                                <button
                                                    className={`btn btn-sm ${plugin.isActive ? 'btn-secondary' : 'btn-primary'}`}
                                                    onClick={() => togglePlugin(plugin.pluginId, !plugin.isActive)}
                                                    disabled={toggling !== null}
                                                >
                                                    {toggling === plugin.pluginId ? '...' : (plugin.isActive ? 'Deaktivieren' : 'Aktivieren')}
                                                </button>
                                                <button className="btn btn-danger btn-sm" onClick={() => removePlugin(plugin.pluginId)} disabled={toggling !== null}>
                                                    {toggling === `remove-${plugin.pluginId}` ? 'Entferne...' : 'Entfernen'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {unregisteredPlugins.map((entry) => (
                                    <tr key={entry.id}>
                                        <td><strong>{entry.id}</strong></td>
                                        <td>{entry.name}</td>
                                        <td>v{entry.version}</td>
                                        <td><span className="badge badge-info">Nicht registriert</span></td>
                                        <td>
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => togglePlugin(entry.id, true)}
                                                disabled={toggling !== null}
                                            >
                                                {toggling === entry.id ? '...' : 'Aktivieren'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
