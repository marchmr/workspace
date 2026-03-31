import dns from 'dns';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
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

export interface SubdomainProvisionResult {
    ok: boolean;
    host: string;
    configFile: string;
    enabledFile: string;
    sslCertExists: boolean;
    dns: SubdomainDnsStatus;
    steps: SubdomainProvisionStep[];
    manualCommands: string[];
}

export interface SubdomainStatusResult {
    host: string;
    configFile: string;
    enabledFile: string;
    configExists: boolean;
    enabledExists: boolean;
    sslCertExists: boolean;
    dns: SubdomainDnsStatus;
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

    if (configured.length > 0) {
        return Array.from(new Set(configured));
    }

    return collectLocalIps();
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

async function runCommand(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
    const shouldUseSudo = config.subdomainProvisioning.useSudo;
    const cmd = shouldUseSudo ? 'sudo' : command;
    const fullArgs = shouldUseSudo ? ['-n', command, ...args] : args;

    try {
        const { stdout, stderr } = await execFileAsync(cmd, fullArgs, { timeout: 30_000 });
        const output = `${stdout || ''}${stderr || ''}`.trim();
        return { ok: true, output };
    } catch (error: any) {
        const output = `${error?.stdout || ''}${error?.stderr || ''}${error?.message || ''}`.trim();
        return { ok: false, output };
    }
}

export async function getSubdomainStatus(rawHost: string): Promise<SubdomainStatusResult> {
    const host = normalizeHost(rawHost);
    const configFile = path.join(config.subdomainProvisioning.nginxSitesAvailableDir, fileNameForHost(host));
    const enabledFile = path.join(config.subdomainProvisioning.nginxSitesEnabledDir, fileNameForHost(host));

    const [configExists, enabledExists, sslCertExists, dnsStatus] = await Promise.all([
        fs.access(configFile).then(() => true).catch(() => false),
        fs.access(enabledFile).then(() => true).catch(() => false),
        fs.access(getCertPath(host)).then(() => true).catch(() => false),
        checkDnsPointsToServer(host),
    ]);

    return {
        host,
        configFile,
        enabledFile,
        configExists,
        enabledExists,
        sslCertExists,
        dns: dnsStatus,
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
        return {
            ok: false,
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
        };
    }

    steps.push({
        key: 'dns',
        ok: true,
        message: 'DNS-Prüfung erfolgreich',
        details: `A=${dnsStatus.resolvedA.join(', ') || '-'} AAAA=${dnsStatus.resolvedAAAA.join(', ') || '-'}`,
    });

    await fs.mkdir(config.subdomainProvisioning.nginxSitesAvailableDir, { recursive: true });
    await fs.mkdir(config.subdomainProvisioning.nginxSitesEnabledDir, { recursive: true });

    const nginxConfig = buildNginxConfig(host, publicPath);
    await fs.writeFile(configFile, nginxConfig, 'utf8');
    steps.push({ key: 'nginx_write', ok: true, message: 'Nginx-Konfiguration geschrieben', details: configFile });

    const symlinkCommand = await runCommand('ln', ['-sfn', configFile, enabledFile]);
    if (!symlinkCommand.ok) {
        steps.push({ key: 'nginx_enable', ok: false, message: 'Nginx-Site konnte nicht aktiviert werden', details: symlinkCommand.output });
        manualCommands.push(`sudo ln -sfn ${configFile} ${enabledFile}`);
        return {
            ok: false,
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
        };
    }
    steps.push({ key: 'nginx_enable', ok: true, message: 'Nginx-Site aktiviert' });

    const nginxTest = await runCommand('nginx', ['-t']);
    if (!nginxTest.ok) {
        steps.push({ key: 'nginx_test', ok: false, message: 'nginx -t fehlgeschlagen', details: nginxTest.output });
        manualCommands.push('sudo nginx -t');
        return {
            ok: false,
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
        };
    }
    steps.push({ key: 'nginx_test', ok: true, message: 'nginx -t erfolgreich' });

    const reload = await runCommand('systemctl', ['reload', 'nginx']);
    if (!reload.ok) {
        steps.push({ key: 'nginx_reload', ok: false, message: 'Nginx konnte nicht neu geladen werden', details: reload.output });
        manualCommands.push('sudo systemctl reload nginx');
        return {
            ok: false,
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
        };
    }
    steps.push({ key: 'nginx_reload', ok: true, message: 'Nginx neu geladen' });

    if (!config.subdomainProvisioning.sslEmail) {
        steps.push({
            key: 'ssl',
            ok: false,
            message: 'SSL_EMAIL/SUBDOMAIN_SSL_EMAIL fehlt, Zertifikat wurde nicht beantragt',
        });
        manualCommands.push(`sudo certbot --nginx -d ${host} --email you@example.com --agree-tos --non-interactive --redirect`);
        return {
            ok: false,
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
        };
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
        steps.push({ key: 'ssl', ok: false, message: 'Zertifikat konnte nicht ausgestellt werden', details: certbot.output });
        manualCommands.push(`sudo certbot --nginx -d ${host} --email ${config.subdomainProvisioning.sslEmail} --agree-tos --non-interactive --redirect`);
        return {
            ok: false,
            host,
            configFile,
            enabledFile,
            sslCertExists: false,
            dns: dnsStatus,
            steps,
            manualCommands,
        };
    }

    const sslCertExists = await fs.access(getCertPath(host)).then(() => true).catch(() => false);
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
    };
}
