import dns from 'dns';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../core/config.js';

const execFileAsync = promisify(execFile);

export interface SubdomainDnsStatus {
    host: string;
    expectedServerIps: string[];
    resolvedA: string[];
    resolvedAAAA: string[];
    pointsToServer: boolean;
    warning?: string;
}

export interface SubdomainProvisionStep {
    key: string;
    ok: boolean;
    message: string;
    details?: string;
}

export interface ProvisionGuidance {
    errorCode: string;
    title: string;
    why: string;
    nextSteps: string[];
    commands: string[];
}

export interface SubdomainProvisionResult {
    ok: boolean;
    host: string;
    configFile: string;
    enabledFile: string;
    sslCertExists: boolean;
    dns: SubdomainDnsStatus;
    steps: SubdomainProvisionStep[];
    manualCommands: string[];
    failedStep?: string | null;
    guidance?: ProvisionGuidance | null;
}

export interface SubdomainStatusResult {
    host: string;
    configFile: string;
    enabledFile: string;
    configExists: boolean;
    enabledExists: boolean;
    sslCertExists: boolean;
    domainLinked: boolean;
    domainLinkedReason: string;
    dns: SubdomainDnsStatus;
}

export interface SubdomainPreflightResult {
    host: string;
    ok: boolean;
    checks: SubdomainProvisionStep[];
    guidance: ProvisionGuidance[];
}

function normalizeHost(rawHost: string): string {
    const host = String(rawHost || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) throw new Error('Subdomain ist erforderlich');
    if (host.includes('/')) throw new Error('Ungültige Subdomain');
    if (!/^[a-z0-9.-]+$/.test(host)) throw new Error('Subdomain enthält ungültige Zeichen');
    if (!host.includes('.')) throw new Error('Bitte vollständige Domain angeben (z. B. kunden.webdesign-hammer.de)');
    if (host.startsWith('.') || host.endsWith('.')) throw new Error('Ungültige Subdomain');
    return host;
}

function fileNameForHost(host: string): string {
    const safe = host.replace(/[^a-z0-9.-]/g, '-');
    return `mike-plugin-videoplattform-${safe}.conf`;
}

function getCertPath(host: string): string {
    return path.join('/etc/letsencrypt/live', host, 'fullchain.pem');
}

function collectLocalIps(): string[] {
    const result = new Set<string>();
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const entries = interfaces[name] || [];
        for (const entry of entries) {
            if (!entry || entry.internal) continue;
            if (entry.address) result.add(entry.address);
        }
    }
    return [...result];
}

function resolveExpectedServerIps(): string[] {
    const configured = config.subdomainProvisioning.expectedServerIps
        .map((ip) => ip.trim())
        .filter(Boolean);

    if (configured.length > 0) return Array.from(new Set(configured));
    return collectLocalIps();
}

function readOnlyHintForPath(filePath: string): string {
    return `Pfad nicht schreibbar: ${filePath}. Für lokale Entwicklung SUBDOMAIN_NGINX_SITES_AVAILABLE_DIR/SUBDOMAIN_NGINX_SITES_ENABLED_DIR auf ein beschreibbares Verzeichnis setzen.`;
}

function isPermissionWriteError(error: any): boolean {
    const code = String(error?.code || '').toUpperCase();
    const msg = String(error?.message || '').toLowerCase();
    return code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
        || msg.includes('permission denied')
        || msg.includes('read-only file system');
}

function contains(output: string, pattern: string): boolean {
    return output.toLowerCase().includes(pattern.toLowerCase());
}

function guidanceForFailure(args: {
    host: string;
    configFile: string;
    enabledFile: string;
    failedStep: string;
    details: string;
}): ProvisionGuidance {
    const { host, configFile, enabledFile, failedStep, details } = args;
    const d = details || '';

    if (failedStep === 'dns') {
        return {
            errorCode: 'E_DNS_NOT_POINTING',
            title: 'DNS zeigt nicht auf den Server',
            why: 'Die Subdomain löst nicht auf die erwartete Server-IP auf.',
            nextSteps: [
                'A/AAAA-Record der Subdomain beim DNS-Provider prüfen.',
                'Auf die Server-IP zeigen lassen und DNS-Propagation abwarten.',
                'Danach erneut „DNS/Nginx/SSL prüfen“ ausführen.',
            ],
            commands: [],
        };
    }

    if (contains(d, '/run/nginx.pid') && contains(d, 'read-only file system')) {
        return {
            errorCode: 'E_NGINX_TEST_RUN_READONLY',
            title: 'Service darf /run für nginx -t nicht schreiben',
            why: 'Systemd-Hardening blockiert Schreibzugriff auf /run beim Testlauf.',
            nextSteps: [
                'Systemd Drop-In für mike-workspace um ReadWritePaths=/run erweitern.',
                'Service neu laden und starten.',
                'Provisionierung erneut starten.',
            ],
            commands: [
                "sudo systemctl edit mike-workspace",
                "sudo systemctl daemon-reload",
                "sudo systemctl restart mike-workspace",
            ],
        };
    }

    if (contains(d, 'sudo: a password is required')) {
        return {
            errorCode: 'E_SUDO_PASSWORD_REQUIRED',
            title: 'sudo non-interactive nicht erlaubt',
            why: 'Der Service-User darf den benötigten Befehl nicht passwortlos ausführen.',
            nextSteps: [
                'sudoers-Regel für User mike mit NOPASSWD ergänzen.',
                'Syntax der sudoers-Datei prüfen.',
                'Provisionierung erneut starten.',
            ],
            commands: [
                "sudo visudo -cf /etc/sudoers.d/mike-subdomain-provisioning",
                "sudo -u mike sudo -n install -m 0644 /dev/null /tmp/mike-subdomain-check && echo OK || echo FAIL",
            ],
        };
    }

    if (contains(d, '/run/sudo/ts') && contains(d, 'read-only file system')) {
        return {
            errorCode: 'E_SUDO_TS_READONLY',
            title: 'sudo timestamp-Verzeichnis ist read-only',
            why: 'Systemd-Hardening blockiert Schreibzugriff auf /run/sudo/ts.',
            nextSteps: [
                'ReadWritePaths um /run/sudo und /run/sudo/ts erweitern.',
                'Service neu starten.',
                'Provisionierung erneut starten.',
            ],
            commands: [
                "sudo systemctl edit mike-workspace",
                "sudo systemctl daemon-reload",
                "sudo systemctl restart mike-workspace",
            ],
        };
    }

    if (failedStep === 'nginx_write') {
        return {
            errorCode: 'E_NGINX_CONFIG_WRITE',
            title: 'Nginx-Konfiguration konnte nicht geschrieben werden',
            why: 'Der Service hat keine ausreichenden Schreibrechte oder /etc ist read-only.',
            nextSteps: [
                'Schreibrechte für den Service auf sites-available prüfen.',
                'Wenn nötig sudoers und systemd ReadWritePaths ergänzen.',
                'Dann erneut provisionieren.',
            ],
            commands: [
                `sudo install -m 0644 /dev/null ${configFile}`,
                `sudo ln -sfn ${configFile} ${enabledFile}`,
            ],
        };
    }

    if (failedStep === 'nginx_test') {
        return {
            errorCode: 'E_NGINX_TEST_FAILED',
            title: 'nginx -t fehlgeschlagen',
            why: 'Die Nginx-Konfiguration ist ungültig oder Runtime-Pfade sind gesperrt.',
            nextSteps: [
                'Nginx-Fehlerausgabe prüfen.',
                'Konfiguration korrigieren.',
                'Erneut testen und provisionieren.',
            ],
            commands: [
                'sudo nginx -t',
                `sudo cat ${configFile}`,
            ],
        };
    }

    if (failedStep === 'nginx_reload') {
        return {
            errorCode: 'E_NGINX_RELOAD_FAILED',
            title: 'Nginx-Reload fehlgeschlagen',
            why: 'Nginx konnte nicht neu geladen werden (Rechte oder Service-Status).',
            nextSteps: [
                'systemd-Status und Logs prüfen.',
                'Nginx manuell reloaden.',
                'Provisionierung erneut starten.',
            ],
            commands: [
                'sudo systemctl status nginx --no-pager -l',
                'sudo systemctl reload nginx',
            ],
        };
    }

    if (failedStep === 'ssl' && contains(d, 'SSL_EMAIL')) {
        return {
            errorCode: 'E_SSL_EMAIL_MISSING',
            title: 'SSL-E-Mail fehlt',
            why: 'Für Certbot fehlt SUBDOMAIN_SSL_EMAIL oder SSL_EMAIL.',
            nextSteps: [
                'E-Mail in backend/.env setzen.',
                'Backend neu starten.',
                'Provisionierung erneut starten.',
            ],
            commands: [
                'grep -n "^SUBDOMAIN_SSL_EMAIL=\|^SSL_EMAIL=" /opt/mike-workspace/backend/.env',
            ],
        };
    }

    if (failedStep === 'ssl') {
        return {
            errorCode: 'E_CERTBOT_FAILED',
            title: 'SSL-Zertifikat konnte nicht ausgestellt werden',
            why: 'Certbot-Aufruf fehlgeschlagen (DNS, Port 80/443, Berechtigungen oder Rate-Limits).',
            nextSteps: [
                'Certbot manuell ausführen und Ausgabe prüfen.',
                'Nach erfolgreichem Lauf Status erneut prüfen.',
            ],
            commands: [
                `sudo certbot --nginx -d ${host} --email ${config.subdomainProvisioning.sslEmail || 'you@example.com'} --agree-tos --non-interactive --redirect`,
                `sudo certbot certificates -d ${host}`,
            ],
        };
    }

    return {
        errorCode: 'E_UNKNOWN',
        title: 'Provisionierung fehlgeschlagen',
        why: 'Ein nicht klassifizierter Fehler ist aufgetreten.',
        nextSteps: [
            'Fehlerdetails prüfen.',
            'Server-Logs kontrollieren.',
            'Schritt erneut ausführen.',
        ],
        commands: [
            'journalctl -u mike-workspace -n 200 --no-pager',
        ],
    };
}

function createFailureResult(args: {
    host: string;
    configFile: string;
    enabledFile: string;
    sslCertExists: boolean;
    dns: SubdomainDnsStatus;
    steps: SubdomainProvisionStep[];
    manualCommands: string[];
    failedStep: string;
    details: string;
}): SubdomainProvisionResult {
    const guidance = guidanceForFailure({
        host: args.host,
        configFile: args.configFile,
        enabledFile: args.enabledFile,
        failedStep: args.failedStep,
        details: args.details,
    });

    const mergedCommands = Array.from(new Set([...(args.manualCommands || []), ...(guidance.commands || [])]));

    return {
        ok: false,
        host: args.host,
        configFile: args.configFile,
        enabledFile: args.enabledFile,
        sslCertExists: args.sslCertExists,
        dns: args.dns,
        steps: args.steps,
        manualCommands: mergedCommands,
        failedStep: args.failedStep,
        guidance,
    };
}

async function runCommand(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
    let effectiveCommand = command;
    let effectiveArgs = [...args];

    // In gehärteten Systemd-Services ist /var/log und /run oft read-only.
    // Mit -g überschreiben wir testweise error_log/pid auf /tmp, damit nginx -t trotzdem funktioniert.
    if (command === 'nginx' && args.length > 0 && args[0] === '-t') {
        const suffix = `${process.pid}-${Date.now()}`;
        effectiveArgs = [
            '-t',
            '-g',
            `pid /tmp/mike-nginx-test-${suffix}.pid; error_log /tmp/mike-nginx-test-${suffix}.log;`,
        ];
    }

    const shouldUseSudo = config.subdomainProvisioning.useSudo;
    const cmd = shouldUseSudo ? 'sudo' : effectiveCommand;
    const fullArgs = shouldUseSudo ? ['-n', effectiveCommand, ...effectiveArgs] : effectiveArgs;

    try {
        const { stdout, stderr } = await execFileAsync(cmd, fullArgs, { timeout: 30_000 });
        const output = `${stdout || ''}${stderr || ''}`.trim();
        return { ok: true, output };
    } catch (error: any) {
        const output = `${error?.stdout || ''}${error?.stderr || ''}${error?.message || ''}`.trim();
        return { ok: false, output };
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false);
}

async function isWritableDir(dirPath: string): Promise<boolean> {
    try {
        await fs.access(dirPath, fsConstants.W_OK);
        return true;
    } catch {
        return false;
    }
}

async function backupExistingConfig(configFile: string): Promise<{ existed: boolean; backupPath?: string; previousContent?: string; warning?: string }> {
    const exists = await fileExists(configFile);
    if (!exists) return { existed: false };

    const previousContent = await fs.readFile(configFile, 'utf8');

    try {
        const backupDir = path.join(os.tmpdir(), 'mike-subdomain-backups');
        await fs.mkdir(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `${path.basename(configFile)}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`);
        await fs.writeFile(backupPath, previousContent, 'utf8');
        return { existed: true, backupPath, previousContent };
    } catch (error: any) {
        return {
            existed: true,
            previousContent,
            warning: `Backup-Datei konnte nicht geschrieben werden: ${error?.message || 'unbekannter Fehler'}`,
        };
    }
}

async function writeConfigAtomic(configFile: string, content: string): Promise<void> {
    const tempPath = `${configFile}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, configFile);
}

async function writeConfigWithPrivilegedInstall(configFile: string, content: string): Promise<{ ok: boolean; details: string }> {
    const tempPath = path.join(os.tmpdir(), `mike-vp-${Date.now()}-${process.pid}.conf`);
    try {
        await fs.writeFile(tempPath, content, 'utf8');
        const installResult = await runCommand('install', ['-m', '0644', tempPath, configFile]);
        if (!installResult.ok) {
            return { ok: false, details: installResult.output || 'install fehlgeschlagen' };
        }
        return { ok: true, details: `Privilegierter Write erfolgreich (${tempPath} -> ${configFile})` };
    } catch (error: any) {
        return { ok: false, details: error?.message || 'Privilegierter Write fehlgeschlagen' };
    } finally {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
}

async function rollbackConfig(configFile: string, previousContent: string | undefined, hadPrevious: boolean): Promise<string> {
    try {
        if (hadPrevious && previousContent !== undefined) {
            try {
                await writeConfigAtomic(configFile, previousContent);
                return 'Vorherige Konfiguration wiederhergestellt';
            } catch {
                const privileged = await writeConfigWithPrivilegedInstall(configFile, previousContent);
                if (privileged.ok) return 'Vorherige Konfiguration mit privilegiertem Fallback wiederhergestellt';
                return `Rollback fehlgeschlagen: ${privileged.details}`;
            }
        }

        await fs.rm(configFile, { force: true });
        return 'Neue Konfiguration entfernt';
    } catch (error: any) {
        return `Rollback fehlgeschlagen: ${error?.message || 'unbekannter Fehler'}`;
    }
}

function buildNginxConfig(host: string, publicPath: string): string {
    const normalizedPath = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
    const dist = config.subdomainProvisioning.frontendDistDir;
    const backendProxyUrl = config.subdomainProvisioning.backendProxyUrl.replace(/\/+$/, '');

    return `server {
    listen 80;
    server_name ${host};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 100M;

    include /etc/nginx/mime.types;

    location /api/ {
        proxy_pass ${backendProxyUrl};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    root ${dist};
    index index.html;

    location = / {
        return 302 ${normalizedPath};
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`;
}

export async function checkDnsPointsToServer(rawHost: string): Promise<SubdomainDnsStatus> {
    const host = normalizeHost(rawHost);
    const expectedServerIps = resolveExpectedServerIps();

    const [aRecords, aaaaRecords] = await Promise.all([
        dns.promises.resolve4(host).catch(() => [] as string[]),
        dns.promises.resolve6(host).catch(() => [] as string[]),
    ]);

    const resolved = [...aRecords, ...aaaaRecords];
    const expectedSet = new Set(expectedServerIps);

    const pointsToServer = expectedServerIps.length > 0
        ? resolved.some((ip) => expectedSet.has(ip))
        : resolved.length > 0;

    return {
        host,
        expectedServerIps,
        resolvedA: aRecords,
        resolvedAAAA: aaaaRecords,
        pointsToServer,
        warning: expectedServerIps.length === 0
            ? 'Keine erwarteten Server-IPs konfiguriert. DNS-Prüfung erfolgt nur auf vorhandene Auflösung.'
            : undefined,
    };
}

export async function getSubdomainStatus(rawHost: string): Promise<SubdomainStatusResult> {
    const host = normalizeHost(rawHost);
    const configFile = path.join(config.subdomainProvisioning.nginxSitesAvailableDir, fileNameForHost(host));
    const enabledFile = path.join(config.subdomainProvisioning.nginxSitesEnabledDir, fileNameForHost(host));

    const [configExists, enabledExists, sslCertExists, dnsStatus] = await Promise.all([
        fileExists(configFile),
        fileExists(enabledFile),
        fileExists(getCertPath(host)),
        checkDnsPointsToServer(host),
    ]);

    const domainLinked = dnsStatus.pointsToServer && configExists && enabledExists;
    const domainLinkedReason = domainLinked
        ? 'DNS zeigt auf den Server und Nginx-Konfiguration ist aktiv.'
        : 'Für eine Verknüpfung müssen DNS, Nginx-Konfiguration und Aktivierung vorhanden sein.';

    return {
        host,
        configFile,
        enabledFile,
        configExists,
        enabledExists,
        sslCertExists,
        domainLinked,
        domainLinkedReason,
        dns: dnsStatus,
    };
}

export async function runSubdomainPreflight(rawHost: string): Promise<SubdomainPreflightResult> {
    const host = normalizeHost(rawHost);
    const checks: SubdomainProvisionStep[] = [];
    const guidance: ProvisionGuidance[] = [];

    const configFile = path.join(config.subdomainProvisioning.nginxSitesAvailableDir, fileNameForHost(host));
    const enabledFile = path.join(config.subdomainProvisioning.nginxSitesEnabledDir, fileNameForHost(host));

    const dnsStatus = await checkDnsPointsToServer(host);
    checks.push({
        key: 'dns',
        ok: dnsStatus.pointsToServer,
        message: dnsStatus.pointsToServer ? 'DNS zeigt auf den Server' : 'DNS zeigt nicht auf den Server',
        details: `A=${dnsStatus.resolvedA.join(', ') || '-'} AAAA=${dnsStatus.resolvedAAAA.join(', ') || '-'}`,
    });

    if (!dnsStatus.pointsToServer) {
        guidance.push(guidanceForFailure({ host, configFile, enabledFile, failedStep: 'dns', details: '' }));
    }

    const [availableWritable, enabledWritable] = await Promise.all([
        isWritableDir(config.subdomainProvisioning.nginxSitesAvailableDir),
        isWritableDir(config.subdomainProvisioning.nginxSitesEnabledDir),
    ]);

    checks.push({
        key: 'nginx_paths',
        ok: availableWritable && enabledWritable,
        message: (availableWritable && enabledWritable)
            ? 'Nginx-Zielverzeichnisse sind schreibbar'
            : 'Nginx-Zielverzeichnisse nicht direkt schreibbar',
        details: `available=${config.subdomainProvisioning.nginxSitesAvailableDir}, enabled=${config.subdomainProvisioning.nginxSitesEnabledDir}`,
    });

    if (config.subdomainProvisioning.useSudo) {
        const sudoInstall = await runCommand('install', ['-m', '0644', '/dev/null', '/tmp/mike-subdomain-preflight.test']);
        checks.push({
            key: 'sudo_non_interactive',
            ok: sudoInstall.ok,
            message: sudoInstall.ok ? 'sudo -n für Service verfügbar' : 'sudo -n nicht funktionsfähig',
            details: sudoInstall.ok ? undefined : sudoInstall.output,
        });

        if (!sudoInstall.ok) {
            guidance.push(guidanceForFailure({
                host,
                configFile,
                enabledFile,
                failedStep: 'nginx_write',
                details: sudoInstall.output,
            }));
        }

        await fs.rm('/tmp/mike-subdomain-preflight.test', { force: true }).catch(() => undefined);
    }

    const nginxTest = await runCommand('nginx', ['-t']);
    checks.push({
        key: 'nginx_test',
        ok: nginxTest.ok,
        message: nginxTest.ok ? 'nginx -t erfolgreich' : 'nginx -t fehlgeschlagen',
        details: nginxTest.ok ? undefined : nginxTest.output,
    });

    if (!nginxTest.ok) {
        guidance.push(guidanceForFailure({ host, configFile, enabledFile, failedStep: 'nginx_test', details: nginxTest.output }));
    }

    if (!config.subdomainProvisioning.sslEmail) {
        checks.push({
            key: 'ssl_email',
            ok: false,
            message: 'SSL-E-Mail fehlt',
            details: 'SUBDOMAIN_SSL_EMAIL oder SSL_EMAIL setzen',
        });
        guidance.push(guidanceForFailure({ host, configFile, enabledFile, failedStep: 'ssl', details: 'SSL_EMAIL fehlt' }));
    } else {
        checks.push({
            key: 'ssl_email',
            ok: true,
            message: 'SSL-E-Mail konfiguriert',
        });

        const certbotVersion = await runCommand('certbot', ['--version']);
        checks.push({
            key: 'certbot',
            ok: certbotVersion.ok,
            message: certbotVersion.ok ? 'certbot verfügbar' : 'certbot nicht verfügbar',
            details: certbotVersion.ok ? certbotVersion.output : certbotVersion.output,
        });

        if (!certbotVersion.ok) {
            guidance.push(guidanceForFailure({ host, configFile, enabledFile, failedStep: 'ssl', details: certbotVersion.output }));
        }
    }

    return {
        host,
        ok: checks.every((item) => item.ok),
        checks,
        guidance,
    };
}

export async function provisionSubdomain(rawHost: string, publicPath = '/kundenportal-videos'): Promise<SubdomainProvisionResult> {
    if (!config.subdomainProvisioning.enabled) {
        throw new Error('Subdomain-Provisionierung ist per Konfiguration deaktiviert');
    }

    const host = normalizeHost(rawHost);
    const configFile = path.join(config.subdomainProvisioning.nginxSitesAvailableDir, fileNameForHost(host));
    const enabledFile = path.join(config.subdomainProvisioning.nginxSitesEnabledDir, fileNameForHost(host));

    const dnsStatus = await checkDnsPointsToServer(host);
    const manualCommands: string[] = [];
    const steps: SubdomainProvisionStep[] = [];

    if (!dnsStatus.pointsToServer) {
        steps.push({
            key: 'dns',
            ok: false,
            message: 'DNS zeigt nicht auf diesen Server',
            details: `A=${dnsStatus.resolvedA.join(', ') || '-'} AAAA=${dnsStatus.resolvedAAAA.join(', ') || '-'}`,
        });
        return createFailureResult({
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
            failedStep: 'dns',
            details: steps[steps.length - 1].details || '',
        });
    }

    steps.push({
        key: 'dns',
        ok: true,
        message: 'DNS-Prüfung erfolgreich',
        details: `A=${dnsStatus.resolvedA.join(', ') || '-'} AAAA=${dnsStatus.resolvedAAAA.join(', ') || '-'}`,
    });

    await fs.mkdir(config.subdomainProvisioning.nginxSitesAvailableDir, { recursive: true });
    await fs.mkdir(config.subdomainProvisioning.nginxSitesEnabledDir, { recursive: true });

    const backup = await backupExistingConfig(configFile);
    if (backup.backupPath) {
        steps.push({ key: 'nginx_backup', ok: true, message: 'Vorherige Konfiguration gesichert', details: backup.backupPath });
    }
    if (backup.warning) {
        steps.push({ key: 'nginx_backup_warning', ok: false, message: 'Backup-Hinweis', details: backup.warning });
    }

    const nginxConfig = buildNginxConfig(host, publicPath);
    try {
        await writeConfigAtomic(configFile, nginxConfig);
        steps.push({ key: 'nginx_write', ok: true, message: 'Nginx-Konfiguration atomisch geschrieben', details: configFile });
    } catch (error: any) {
        if (isPermissionWriteError(error)) {
            const privilegedWrite = await writeConfigWithPrivilegedInstall(configFile, nginxConfig);
            if (privilegedWrite.ok) {
                steps.push({
                    key: 'nginx_write',
                    ok: true,
                    message: 'Nginx-Konfiguration mit privilegiertem Fallback geschrieben',
                    details: privilegedWrite.details,
                });
            } else {
                const details = `${error?.message || 'unbekannter Fehler'} | ${privilegedWrite.details}`;
                steps.push({ key: 'nginx_write', ok: false, message: 'Nginx-Konfiguration konnte nicht geschrieben werden', details });
                manualCommands.push(`sudo install -m 0644 /dev/null ${configFile}`);
                manualCommands.push(`sudo tee ${configFile} >/dev/null <<'NGINX'\n${nginxConfig}\nNGINX`);
                manualCommands.push(`sudo -u mike sudo -n install -m 0644 /dev/null ${configFile} && echo OK || echo FAIL`);
                return createFailureResult({
                    host,
                    configFile,
                    enabledFile,
                    sslCertExists: false,
                    dns: dnsStatus,
                    steps,
                    manualCommands,
                    failedStep: 'nginx_write',
                    details,
                });
            }
        } else {
            const details = `${error?.message || 'unbekannter Fehler'} | ${readOnlyHintForPath(configFile)}`;
            steps.push({ key: 'nginx_write', ok: false, message: 'Nginx-Konfiguration konnte nicht geschrieben werden', details });
            manualCommands.push(`sudo tee ${configFile} >/dev/null <<'NGINX'\n${nginxConfig}\nNGINX`);
            return createFailureResult({
                host,
                configFile,
                enabledFile,
                sslCertExists: false,
                dns: dnsStatus,
                steps,
                manualCommands,
                failedStep: 'nginx_write',
                details,
            });
        }
    }

    const symlinkCommand = await runCommand('ln', ['-sfn', configFile, enabledFile]);
    if (!symlinkCommand.ok) {
        const rollbackMessage = await rollbackConfig(configFile, backup.previousContent, backup.existed);
        const details = `${symlinkCommand.output}\n${rollbackMessage}`;
        steps.push({ key: 'nginx_enable', ok: false, message: 'Nginx-Site konnte nicht aktiviert werden', details });
        manualCommands.push(`sudo ln -sfn ${configFile} ${enabledFile}`);
        return createFailureResult({
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
            failedStep: 'nginx_enable',
            details,
        });
    }
    steps.push({ key: 'nginx_enable', ok: true, message: 'Nginx-Site aktiviert' });

    const nginxTest = await runCommand('nginx', ['-t']);
    if (!nginxTest.ok) {
        const rollbackMessage = await rollbackConfig(configFile, backup.previousContent, backup.existed);
        const details = `${nginxTest.output}\n${rollbackMessage}`;
        steps.push({ key: 'nginx_test', ok: false, message: 'nginx -t fehlgeschlagen, Rollback ausgeführt', details });
        manualCommands.push('sudo nginx -t');
        return createFailureResult({
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
            failedStep: 'nginx_test',
            details,
        });
    }
    steps.push({ key: 'nginx_test', ok: true, message: 'nginx -t erfolgreich' });

    const reload = await runCommand('systemctl', ['reload', 'nginx']);
    if (!reload.ok) {
        const rollbackMessage = await rollbackConfig(configFile, backup.previousContent, backup.existed);
        const details = `${reload.output}\n${rollbackMessage}`;
        steps.push({ key: 'nginx_reload', ok: false, message: 'Nginx konnte nicht neu geladen werden, Rollback ausgeführt', details });
        manualCommands.push('sudo systemctl reload nginx');
        return createFailureResult({
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
            failedStep: 'nginx_reload',
            details,
        });
    }
    steps.push({ key: 'nginx_reload', ok: true, message: 'Nginx neu geladen' });

    if (!config.subdomainProvisioning.sslEmail) {
        const details = 'SSL_EMAIL/SUBDOMAIN_SSL_EMAIL fehlt';
        steps.push({ key: 'ssl', ok: false, message: 'SSL_EMAIL/SUBDOMAIN_SSL_EMAIL fehlt, Zertifikat wurde nicht beantragt', details });
        manualCommands.push(`sudo certbot --nginx -d ${host} --email you@example.com --agree-tos --non-interactive --redirect`);
        return createFailureResult({
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
            failedStep: 'ssl',
            details,
        });
    }

    const certbot = await runCommand('certbot', [
        '--nginx',
        '-d', host,
        '--email', config.subdomainProvisioning.sslEmail,
        '--agree-tos',
        '--non-interactive',
        '--redirect',
    ]);

    if (!certbot.ok) {
        const details = certbot.output;
        steps.push({ key: 'ssl', ok: false, message: 'Zertifikat konnte nicht ausgestellt werden', details });
        manualCommands.push(`sudo certbot --nginx -d ${host} --email ${config.subdomainProvisioning.sslEmail} --agree-tos --non-interactive --redirect`);
        return createFailureResult({
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
            failedStep: 'ssl',
            details,
        });
    }

    const sslCertExists = await fileExists(getCertPath(host));
    steps.push({ key: 'ssl', ok: sslCertExists, message: sslCertExists ? 'SSL-Zertifikat aktiv' : 'Certbot lief, aber Zertifikat nicht gefunden' });
    if (!sslCertExists) {
        manualCommands.push(`sudo certbot certificates -d ${host}`);
    }

    return {
        ok: sslCertExists,
        host,
        configFile,
        enabledFile,
        sslCertExists,
        dns: dnsStatus,
        steps,
        manualCommands,
        failedStep: sslCertExists ? null : 'ssl',
        guidance: sslCertExists ? null : guidanceForFailure({
            host,
            configFile,
            enabledFile,
            failedStep: 'ssl',
            details: 'Certbot lief, Zertifikat wurde aber nicht gefunden',
        }),
    };
}
